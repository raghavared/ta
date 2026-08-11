import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { eq } from 'drizzle-orm';
import type { DraftStatus, GwtStep, Workspace } from '@ta/core';
import { testCaseDrafts, type TaDb } from '@ta/store';
import { writeLearning } from '@ta/memory';

export interface DraftDoc {
  id: string;
  title: string;
  status: DraftStatus;
  priority: 'must' | 'should' | 'could';
  tags: string[];
  preconditions?: string | undefined;
  steps: GwtStep[];
  expectedResults: string;
}

/** Write a draft as reviewable markdown. Reviewers flip `status` in the frontmatter. */
export async function writeDraftMarkdown(ws: Workspace, draft: DraftDoc): Promise<string> {
  const frontmatter = stringifyYaml({
    id: draft.id,
    status: draft.status,
    priority: draft.priority,
    tags: draft.tags,
  }).trim();
  const body = [
    '---',
    frontmatter,
    '---',
    '',
    `# ${draft.title}`,
    '',
    ...(draft.preconditions ? [`**Preconditions:** ${draft.preconditions}`, ''] : []),
    '## Steps',
    ...draft.steps.map((s) => `- **${s.keyword}** ${s.text}`),
    '',
    `**Expected results:** ${draft.expectedResults}`,
    '',
    '<!-- Review: set status to approved | rejected | needs_changes in the frontmatter above. -->',
    '',
  ].join('\n');
  const path = join(ws.testcasesDir, `${draft.id}.md`);
  await writeFile(path, body, 'utf8');
  return path;
}

export interface SyncResult {
  updated: { id: string; from: string; to: string }[];
  unchanged: number;
}

/** Import reviewer decisions from the markdown files back into the DB. */
export async function syncDraftStatuses(ws: Workspace, db: TaDb): Promise<SyncResult> {
  const files = (await readdir(ws.testcasesDir)).filter((f) => f.endsWith('.md'));
  const updated: SyncResult['updated'] = [];
  let unchanged = 0;
  const valid: DraftStatus[] = ['draft', 'pending_review', 'approved', 'rejected', 'needs_changes'];
  for (const file of files) {
    const raw = await readFile(join(ws.testcasesDir, file), 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;
    const front = parseYaml(match[1]!) as { id?: string; status?: string };
    if (!front.id || !front.status) continue;
    if (!valid.includes(front.status as DraftStatus)) continue;
    const row = db.select().from(testCaseDrafts).where(eq(testCaseDrafts.id, front.id)).get();
    if (!row) continue;
    if (row.status === front.status) {
      unchanged++;
      continue;
    }
    db.update(testCaseDrafts)
      .set({
        status: front.status as DraftStatus,
        reviewedAt: Date.now(),
        reviewedBy: process.env.USER ?? 'reviewer',
      })
      .where(eq(testCaseDrafts.id, front.id))
      .run();
    // Reviewer taste feeds back into future planning.
    if (front.status === 'rejected') {
      writeLearning(db, {
        appId: row.appId,
        scope: 'app',
        kind: 'testcase-style',
        content: `Reviewer rejected the test case "${row.title}" — avoid proposing similar cases unless requirements change.`,
        confidence: 0.6,
      });
    }
    updated.push({ id: front.id, from: row.status, to: front.status });
  }
  return { updated, unchanged };
}
