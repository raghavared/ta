import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { newId, type IssueKind } from '@ta/core';
import { issueEvents, issues, type TaDb } from '@ta/store';

export interface IssueInput {
  appId: string;
  kind: IssueKind;
  title: string;
  description: string;
  /** Page URL or pattern where it occurred. */
  page: string;
  /** Element/selector context, when applicable. */
  elementRef?: string;
  /** Raw error message; normalized into the fingerprint. */
  errorSignature?: string;
  reproSteps: string[];
  severity?: 'blocker' | 'critical' | 'major' | 'minor';
  evidence?: Record<string, unknown>;
  runId?: string;
}

export interface FileIssueOutcome {
  issueId: string;
  outcome: 'created' | 'recurred' | 'reopened';
  occurrences: number;
}

/** Strip volatile parts so the same defect always fingerprints identically. */
export function normalizeErrorSignature(error: string): string {
  return (
    error
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')[0]!
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/["'`][^"'`]*["'`]/g, (m) => m.replace(/[a-z0-9@.]/gi, 'x'))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}

export function issueFingerprint(input: Pick<IssueInput, 'kind' | 'page' | 'elementRef' | 'errorSignature'>): string {
  const page = input.page.replace(/\d{3,}/g, '#');
  const sig = input.errorSignature ? normalizeErrorSignature(input.errorSignature) : '';
  return createHash('sha256')
    .update(`${input.kind}\n${page}\n${input.elementRef ?? ''}\n${sig}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * File an issue with existence-checking: an existing fingerprint updates the
 * same issue (occurrences++, possible reopen) instead of creating a duplicate.
 */
export function fileIssue(db: TaDb, input: IssueInput): FileIssueOutcome {
  const fingerprint = issueFingerprint(input);
  const existing = db.select().from(issues).where(eq(issues.fingerprint, fingerprint)).get();
  const now = Date.now();

  if (existing) {
    const reopen = existing.status === 'fixed';
    db.update(issues)
      .set({
        occurrences: existing.occurrences + 1,
        lastSeenRunId: input.runId ?? existing.lastSeenRunId,
        status: reopen ? 'reopened' : existing.status,
      })
      .where(eq(issues.id, existing.id))
      .run();
    db.insert(issueEvents)
      .values({
        id: newId('iev'),
        issueId: existing.id,
        event: reopen ? 'reopened' : 'recurred',
        runId: input.runId ?? null,
        at: now,
      })
      .run();
    return {
      issueId: existing.id,
      outcome: reopen ? 'reopened' : 'recurred',
      occurrences: existing.occurrences + 1,
    };
  }

  const id = newId('iss');
  db.insert(issues)
    .values({
      id,
      appId: input.appId,
      fingerprint,
      kind: input.kind,
      title: input.title,
      description: input.description,
      reproStepsJson: JSON.stringify(input.reproSteps),
      severity: input.severity ?? 'major',
      evidenceJson: JSON.stringify({ ...input.evidence, page: input.page, elementRef: input.elementRef }),
      status: 'open',
      occurrences: 1,
      firstSeenRunId: input.runId ?? null,
      lastSeenRunId: input.runId ?? null,
    })
    .run();
  db.insert(issueEvents)
    .values({ id: newId('iev'), issueId: id, event: 'created', runId: input.runId ?? null, at: now })
    .run();
  return { issueId: id, outcome: 'created', occurrences: 1 };
}
