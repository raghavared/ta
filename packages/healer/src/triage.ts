import { readFileSync } from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { newId, type FailureClassification, type GwtStep } from '@ta/core';
import type { AgentEngine } from '@ta/agent-engine';
import { fileIssue, normalizeErrorSignature, type FileIssueOutcome } from '@ta/issues';
import {
  failures,
  pageStates,
  runs,
  testCaseDrafts,
  testCases,
  testResults,
  type TaDb,
} from '@ta/store';
import { preClassify } from './pre-classify.js';

const triageResultSchema = z.object({
  classification: z.enum(['app-bug', 'broken-selector', 'timing-flake', 'bad-test-logic', 'env-error', 'unknown']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(10),
  suggestedAction: z.string().min(5),
});

const TRIAGE_SYSTEM = `You are a senior QA engineer triaging an automated test failure.
Decide what actually broke:
- "app-bug": the application misbehaves — the test's expectation matches the approved, human-reviewed test case, but the app does something else. The test must NOT be changed.
- "bad-test-logic": the app is behaving correctly; the test asserts something wrong or mistimed.
- "broken-selector": the element exists but the selector no longer matches it.
- "timing-flake": the expectation is right but raced against async UI.
Weigh the approved expected results (a human signed these off) heavily against the actual error.
Return classification, confidence 0..1, rationale, suggestedAction.`;

export interface TriageOutcome {
  resultId: string;
  title: string;
  classification: FailureClassification;
  confidence: number;
  rationale: string;
  viaLlm: boolean;
  issue?: FileIssueOutcome & { title: string };
}

export async function triageRun(params: {
  db: TaDb;
  appId: string;
  runId?: string;
  engine?: AgentEngine;
  onProgress?: (msg: string) => void;
}): Promise<{ runId: string; outcomes: TriageOutcome[] }> {
  const { db, appId, engine } = params;
  const log = params.onProgress ?? (() => {});

  const run = params.runId
    ? db.select().from(runs).where(eq(runs.id, params.runId)).get()
    : db.select().from(runs).where(eq(runs.appId, appId)).orderBy(desc(runs.startedAt)).all()[0];
  if (!run) throw new Error('No runs found — run `ta run` first.');

  const results = db.select().from(testResults).where(eq(testResults.runId, run.id)).all();
  const outcomes: TriageOutcome[] = [];

  for (const result of results) {
    if (result.status === 'passed' || result.status === 'skipped') continue;
    const testCase = db.select().from(testCases).where(eq(testCases.id, result.testCaseId)).get();
    const draft = testCase?.draftId
      ? db.select().from(testCaseDrafts).where(eq(testCaseDrafts.id, testCase.draftId)).get()
      : undefined;
    const title = draft?.title ?? result.testCaseId;

    const pre = preClassify({
      errorMessage: result.errorMessage ?? '',
      ...(result.errorStack ? { errorStack: result.errorStack } : {}),
      wasFlaky: result.status === 'flaky',
    });
    let classification = pre.classification;
    let confidence = pre.confidence;
    let rationale = pre.rationale;
    let viaLlm = false;

    // Deterministic memory beats re-asking the model: an identical failure
    // signature on the same test reuses its prior triage verdict.
    const prior = pre.ambiguous
      ? findPriorTriage(db, result.testCaseId, result.errorMessage ?? '')
      : undefined;
    if (prior) {
      classification = prior.classification;
      confidence = prior.confidence;
      rationale = `Consistent with prior triage of the identical failure signature: ${prior.rationale}`;
      log(`reusing prior triage (${classification}) for: ${title}`);
    } else if (pre.ambiguous && engine) {
      log(`triaging via ${engine.id}: ${title}`);
      const specSource = testCase ? safeRead(testCase.specPath) : '';
      const triage = await engine.runTask<z.infer<typeof triageResultSchema>>({
        kind: 'heal.triage',
        system: TRIAGE_SYSTEM,
        context: {
          testTitle: title,
          approvedExpectedResults: draft?.expectedResults ?? '(unknown)',
          approvedSteps: draft ? (JSON.parse(draft.stepsJson) as GwtStep[]) : [],
          errorMessage: result.errorMessage,
          errorStack: (result.errorStack ?? '').slice(0, 2000),
          specSource: specSource.slice(0, 4000),
        },
        schema: triageResultSchema,
        budget: { timeoutMs: 5 * 60 * 1000 },
      });
      if (triage.ok && triage.data) {
        classification = triage.data.classification;
        confidence = triage.data.confidence;
        rationale = triage.data.rationale;
        viaLlm = true;
      } else {
        rationale = `${rationale} (LLM triage failed: ${triage.error?.message})`;
      }
    }

    db.insert(failures)
      .values({
        id: newId('fail'),
        testResultId: result.id,
        classification,
        confidence,
        evidenceJson: JSON.stringify({
          error: result.errorMessage,
          tracePath: result.tracePath,
          rationale,
          viaLlm,
        }),
      })
      .run();

    const outcome: TriageOutcome = { resultId: result.id, title, classification, confidence, rationale, viaLlm };

    // App bugs never modify tests — they go to the issue registry.
    if (classification === 'app-bug') {
      const coverage = draft ? (JSON.parse(draft.coverageRefsJson) as { stateId?: string }) : {};
      const state = coverage.stateId
        ? db.select().from(pageStates).where(eq(pageStates.id, coverage.stateId)).get()
        : undefined;
      const steps = draft ? (JSON.parse(draft.stepsJson) as GwtStep[]).map((s) => `${s.keyword} ${s.text}`) : [];
      const filed = fileIssue(db, {
        appId,
        kind: 'app-bug',
        title: `[app-bug] ${title}`,
        description: `${rationale}\n\nExpected (approved): ${draft?.expectedResults ?? 'n/a'}\nActual error: ${result.errorMessage ?? 'n/a'}`,
        page: state?.url ?? 'unknown',
        elementRef: title,
        errorSignature: result.errorMessage ?? '',
        reproSteps: steps,
        severity: draft?.priority === 'must' ? 'critical' : 'major',
        evidence: { tracePath: result.tracePath, runId: run.id },
        runId: run.id,
      });
      outcome.issue = { ...filed, title: `[app-bug] ${title}` };
    }
    outcomes.push(outcome);
  }
  return { runId: run.id, outcomes };
}

/** Find a prior confident triage of the same test failing with the same signature. */
function findPriorTriage(
  db: TaDb,
  testCaseId: string,
  errorMessage: string,
): { classification: FailureClassification; confidence: number; rationale: string } | undefined {
  const signature = normalizeErrorSignature(errorMessage);
  const rows = db
    .select({
      classification: failures.classification,
      confidence: failures.confidence,
      evidenceJson: failures.evidenceJson,
      id: failures.id,
    })
    .from(failures)
    .innerJoin(testResults, eq(failures.testResultId, testResults.id))
    .where(eq(testResults.testCaseId, testCaseId))
    .all();
  const matching = rows
    .filter((r) => {
      const ev = JSON.parse(r.evidenceJson) as { error?: string };
      return (
        normalizeErrorSignature(ev.error ?? '') === signature &&
        r.confidence >= 0.6 &&
        r.classification !== 'unknown'
      );
    })
    .sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? 1 : -1))[0];
  if (!matching) return undefined;
  const ev = JSON.parse(matching.evidenceJson) as { rationale?: string };
  return {
    classification: matching.classification,
    confidence: matching.confidence,
    rationale: ev.rationale ?? 'prior triage',
  };
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
