import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { newId, type GwtStep, type TaConfig, type Workspace } from '@ta/core';
import type { AgentEngine } from '@ta/agent-engine';
import {
  designComponents,
  designScreens,
  elements,
  requirementCoverage,
  requirements,
  testCaseDrafts,
  type TaDb,
} from '@ta/store';
import { getLearnings, renderLearningsSection } from '@ta/memory';
import { loadSkills, matchSkills, renderSkillsSection, seedGlobalSkills } from '@ta/skills';
import { globalHome } from '@ta/core';
import { deriveFlows, type CandidateFlow } from './flows.js';
import { writeDraftMarkdown } from './markdown.js';

const gwtStepSchema = z.object({
  keyword: z.enum(['Given', 'When', 'Then', 'And']),
  text: z.string().min(3),
});

const draftSchema = z.object({
  flowRef: z.string().min(1),
  title: z.string().min(5),
  priority: z.enum(['must', 'should', 'could']),
  preconditions: z.string().optional(),
  steps: z.array(gwtStepSchema).min(2),
  expectedResults: z.string().min(5),
  tags: z.array(z.enum(['happy-path', 'negative', 'edge', 'conformance'])).min(1),
  /** reqIds (e.g. REQ-ORDER-1) this case verifies; empty if none apply. */
  requirementIds: z.array(z.string()).default([]),
});

const planResultSchema = z.object({ testCases: z.array(draftSchema).min(1) });
export type PlannedDraft = z.infer<typeof draftSchema>;

const PLAN_SYSTEM = `You are a senior QA engineer planning test cases for a web application.
You are given candidate flows discovered by an automated explorer: each flow has a flowRef id,
the literal UI steps that were executed, and an accessibility snapshot of the resulting screen.

Write human-readable test cases for the most valuable flows:
- One test case per meaningful flow; skip redundant near-duplicates of flows you already covered.
- Steps must be Given/When/Then, concrete, and follow the actual flow steps provided — do not invent UI that is not in the snapshots.
- expectedResults must describe observable outcomes visible in the final snapshot.
- Flows that exercise validation errors get the tag "negative"; normal user journeys get "happy-path".
- Set flowRef to the exact flow id you are covering. Every test case must reference a real flowRef.
- If business requirements are provided, they are the source of truth: expectedResults must reflect their
  acceptance criteria, and requirementIds must list every reqId the case verifies. Prioritize covering
  every "must" requirement that maps to an available flow.
- If design expectations are provided and they conflict with what the snapshots show, still describe the
  designed/required behavior and add the tag "conformance".`;

export interface PlanResult {
  drafts: { id: string; title: string; markdownPath: string }[];
  flowsConsidered: number;
}

export async function runPlan(params: {
  config: TaConfig;
  ws: Workspace;
  db: TaDb;
  appId: string;
  engine: AgentEngine;
}): Promise<PlanResult> {
  const { ws, db, appId, engine } = params;
  const flows = deriveFlows(db, appId);
  if (flows.length === 0) throw new Error('No flows in the graph — run `ta explore` first.');

  // Optional sources of truth: business requirements and design expectations.
  const reqRows = db.select().from(requirements).all().filter((r) => r.uiRelevant);
  const screens = db.select().from(designScreens).all();
  const designExpectations = screens.map((s) => ({
    screen: s.name,
    components: db
      .select()
      .from(designComponents)
      .where(eq(designComponents.screenId, s.id))
      .all()
      .map((c) => c.label),
  }));

  // Compounding intelligence: prior learnings + matched skills enter the prompt.
  const home = globalHome();
  await seedGlobalSkills(home.skillsDir);
  const allSkills = await loadSkills([home.skillsDir, ws.skillsDir]);
  const rolesPresent = [
    ...new Set(db.select().from(elements).all().map((e) => e.role)),
  ];
  const matchedSkills = matchSkills(allSkills, {
    taskKind: 'plan.testcases',
    roles: rolesPresent,
    urls: flows.map((f) => f.url),
  });
  const learned = getLearnings(db, { appId, kinds: ['testcase-style', 'app-quirk', 'timing', 'selector-pref'] });

  const result = await engine.runTask<z.infer<typeof planResultSchema>>({
    kind: 'plan.testcases',
    system: [PLAN_SYSTEM, renderSkillsSection(matchedSkills), renderLearningsSection(learned)]
      .filter(Boolean)
      .join('\n\n'),
    context: {
      app: { name: params.config.name, baseUrl: params.config.baseUrl },
      ...(reqRows.length > 0
        ? {
            requirements: reqRows.map((r) => ({
              reqId: r.reqId,
              title: r.title,
              priority: r.priority,
              acceptanceCriteria: JSON.parse(r.acceptanceCriteriaJson) as string[],
            })),
          }
        : {}),
      ...(designExpectations.length > 0 ? { designExpectations } : {}),
      flows: flows.map((f) => ({
        flowRef: f.stateId,
        requiresLogin: !f.preAuth,
        steps: f.readableSteps,
        finalScreen: f.finalAria,
      })),
    },
    schema: planResultSchema,
    budget: { timeoutMs: 5 * 60 * 1000 },
  });
  if (!result.ok || !result.data) {
    throw new Error(`plan.testcases failed (${result.error?.type}): ${result.error?.message}`);
  }

  const flowById = new Map<string, CandidateFlow>(flows.map((f) => [f.stateId, f]));
  const drafts: PlanResult['drafts'] = [];
  for (const tc of result.data.testCases) {
    if (!flowById.has(tc.flowRef)) continue; // hallucinated flowRef — drop
    const id = newId('draft');
    const row = {
      id,
      appId,
      title: tc.title,
      priority: tc.priority,
      preconditions: tc.preconditions ?? null,
      stepsJson: JSON.stringify(tc.steps satisfies GwtStep[]),
      expectedResults: tc.expectedResults,
      coverageRefsJson: JSON.stringify({ stateId: tc.flowRef }),
      tagsJson: JSON.stringify(tc.tags),
      status: 'pending_review' as const,
      version: 1,
    };
    db.insert(testCaseDrafts).values(row).run();
    // RTM: link the draft to every requirement it claims to verify.
    for (const reqId of tc.requirementIds) {
      const req = reqRows.find((r) => r.reqId === reqId);
      if (!req) continue;
      db.insert(requirementCoverage)
        .values({ id: newId('rcov'), requirementId: req.id, testCaseDraftId: id })
        .run();
    }
    const markdownPath = await writeDraftMarkdown(ws, {
      id,
      title: tc.title,
      status: 'pending_review',
      priority: tc.priority,
      tags: tc.tags,
      preconditions: tc.preconditions,
      steps: tc.steps,
      expectedResults: tc.expectedResults,
    });
    drafts.push({ id, title: tc.title, markdownPath });
  }
  return { drafts, flowsConsidered: flows.length };
}
