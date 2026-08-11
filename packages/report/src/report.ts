import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { TaConfig, Workspace } from '@ta/core';
import {
  failures,
  issues,
  pageStates,
  requirementCoverage,
  requirements,
  runs,
  testCaseDrafts,
  testCases,
  testResults,
  transitions,
  type TaDb,
} from '@ta/store';

export interface ReportPaths {
  markdownPath: string;
  htmlPath: string;
}

/** Deterministic Test Summary Report (IEEE-829 style) rendered from the DB. */
export async function generateReport(params: {
  config: TaConfig;
  ws: Workspace;
  db: TaDb;
  appId: string;
  runId?: string;
}): Promise<ReportPaths> {
  const { config, ws, db, appId } = params;
  const run = params.runId
    ? db.select().from(runs).where(eq(runs.id, params.runId)).get()
    : db.select().from(runs).where(eq(runs.appId, appId)).orderBy(desc(runs.startedAt)).all()[0];
  if (!run) throw new Error('No runs to report on — run `ta run` first.');

  const results = db.select().from(testResults).where(eq(testResults.runId, run.id)).all();
  const allCases = db.select().from(testCases).where(eq(testCases.appId, appId)).all();
  const drafts = db.select().from(testCaseDrafts).where(eq(testCaseDrafts.appId, appId)).all();
  const allIssues = db.select().from(issues).where(eq(issues.appId, appId)).all();
  const states = db.select().from(pageStates).all();
  const trans = db.select().from(transitions).where(eq(transitions.appId, appId)).all();
  const failureRows = db.select().from(failures).all();

  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const caseById = new Map(allCases.map((c) => [c.id, c]));
  const resultByCaseId = new Map(results.map((r) => [r.testCaseId, r]));

  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const r of results) counts[r.status]++;
  const total = results.length;
  const passRate = total ? Math.round(((counts.passed + counts.flaky) / total) * 100) : 0;
  const verdict = counts.failed === 0 ? 'PASS' : 'FAIL';

  const approvedNotExecuted = drafts.filter(
    (d) =>
      d.status === 'approved' &&
      !allCases.some((c) => c.draftId === d.id && resultByCaseId.has(c.id)),
  );

  const executedTransitions = trans.filter((t) => t.executed).length;
  const destructiveMapped = trans.filter((t) => t.destructive).length;

  const resultRows = results.map((r) => {
    const tc = caseById.get(r.testCaseId);
    const draft = tc?.draftId ? draftById.get(tc.draftId) : undefined;
    const failure = failureRows.find((f) => f.testResultId === r.id);
    return {
      title: draft?.title ?? r.testCaseId,
      priority: draft?.priority ?? '-',
      tags: draft ? (JSON.parse(draft.tagsJson) as string[]).join(', ') : '-',
      status: r.status,
      durationMs: r.durationMs,
      error: r.errorMessage?.split('\n')[0] ?? '',
      classification: failure?.classification ?? '',
      trace: r.tracePath ?? '',
    };
  });

  const generatedAt = new Date().toISOString();
  const md = [
    `# Test Summary Report — ${config.name}`,
    '',
    `Generated: ${generatedAt} · Run: \`${run.id}\` · Engine target: ${config.baseUrl}`,
    '',
    '## 1. Executive summary',
    '',
    `**Verdict: ${verdict}** — ${counts.passed} passed, ${counts.failed} failed, ${counts.flaky} flaky, ${counts.skipped} skipped of ${total} executed (pass rate ${passRate}%).`,
    allIssues.length > 0
      ? `Open issues: ${allIssues.filter((i) => i.status === 'open' || i.status === 'reopened').length} (${allIssues.filter((i) => i.status === 'reopened').length} reopened regressions).`
      : 'No product issues on file.',
    '',
    '## 2. Scope & environment',
    '',
    `- Target: ${config.baseUrl}`,
    `- Explored graph: ${states.length} UI states, ${trans.length} transitions (${executedTransitions} exercised, ${destructiveMapped} destructive actions mapped-but-never-executed)`,
    `- Test cases: ${drafts.length} planned, ${drafts.filter((d) => d.status === 'approved').length} approved by review, ${allCases.length} scripted`,
    `- Browsers: Chromium (Playwright) · Engine: ${config.engine}`,
    '',
    '## 3. Test case results',
    '',
    '| Test case | Priority | Tags | Status | Duration | Failure classification | Error |',
    '|---|---|---|---|---|---|---|',
    ...resultRows.map(
      (r) =>
        `| ${r.title} | ${r.priority} | ${r.tags} | ${r.status.toUpperCase()} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.classification} | ${r.error.replace(/\|/g, '\\|').slice(0, 80)} |`,
    ),
    ...(approvedNotExecuted.length
      ? [
          '',
          '### Approved but not executed',
          '',
          ...approvedNotExecuted.map((d) => `- ${d.title} — no spec generated/run yet`),
        ]
      : []),
    '',
    '## 4. Coverage',
    '',
    `- UI states discovered: ${states.length}; transitions discovered: ${trans.length}; exercised during exploration: ${executedTransitions}`,
    '',
    ...renderRtm(db, drafts, resultByCaseId, allCases),
    '',
    '## 5. Issues',
    '',
    ...(allIssues.length === 0
      ? ['None filed.']
      : [
          '| Status | Severity | Kind | Title | Occurrences | Page |',
          '|---|---|---|---|---|---|',
          ...allIssues.map((i) => {
            const ev = JSON.parse(i.evidenceJson) as { page?: string };
            return `| ${i.status.toUpperCase()} | ${i.severity} | ${i.kind} | ${i.title.replace(/\|/g, '\\|')} | ${i.occurrences} | ${ev.page ?? ''} |`;
          }),
        ]),
    '',
    '## 6. Quality notes',
    '',
    `- Failure triage on record: ${failureRows.length} (classifications: ${summarize(failureRows.map((f) => f.classification))})`,
    `- Flaky tests this run: ${counts.flaky}`,
    '',
  ].join('\n');

  const reportsDir = join(ws.root, 'reports');
  await mkdir(reportsDir, { recursive: true });
  const markdownPath = join(reportsDir, `report-${run.id}.md`);
  const htmlPath = join(reportsDir, `report-${run.id}.html`);
  await writeFile(markdownPath, md, 'utf8');
  await writeFile(htmlPath, renderHtml(config.name, verdict, md), 'utf8');
  return { markdownPath, htmlPath };
}

type DraftRow = typeof testCaseDrafts.$inferSelect;
type CaseRow = typeof testCases.$inferSelect;
type ResultRow = typeof testResults.$inferSelect;

/** Requirements Traceability Matrix — requirement × covering test cases × latest outcome. */
function renderRtm(
  db: TaDb,
  drafts: DraftRow[],
  resultByCaseId: Map<string, ResultRow>,
  allCases: CaseRow[],
): string[] {
  const reqRows = db.select().from(requirements).all();
  if (reqRows.length === 0) return ['Requirements traceability: no BRD/PRD configured for this project.'];
  const coverage = db.select().from(requirementCoverage).all();
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const lines = [
    '### Requirements Traceability Matrix',
    '',
    '| Requirement | Priority | Covered by | Latest result |',
    '|---|---|---|---|',
  ];
  const uncoveredMust: string[] = [];
  for (const req of reqRows) {
    if (!req.uiRelevant) continue;
    const covering = coverage
      .filter((c) => c.requirementId === req.id)
      .map((c) => draftById.get(c.testCaseDraftId))
      .filter((d): d is DraftRow => d !== undefined && d.status !== 'rejected');
    const outcomes = covering.map((d) => {
      const tc = allCases.find((c) => c.draftId === d.id);
      const result = tc ? resultByCaseId.get(tc.id) : undefined;
      return result?.status ?? (d.status === 'approved' ? 'not-run' : d.status);
    });
    const covered = covering.length > 0;
    if (!covered && req.priority === 'must') uncoveredMust.push(req.reqId);
    lines.push(
      `| ${req.reqId} — ${req.title.replace(/\|/g, '\\|')} | ${req.priority} | ${
        covered ? covering.map((d) => d.title.slice(0, 50)).join('; ') : '**UNCOVERED**'
      } | ${outcomes.join(', ') || '—'} |`,
    );
  }
  if (uncoveredMust.length > 0) {
    lines.push('', `⚠ **Uncovered must-have requirements:** ${uncoveredMust.join(', ')} — planning gap.`);
  }
  return lines;
}

function summarize(items: string[]): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || 'none';
}

function renderHtml(name: string, verdict: string, markdown: string): string {
  const rows = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const color = verdict === 'PASS' ? '#15803d' : '#b91c1c';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Test Report — ${name}</title>
<style>
body{font-family:ui-monospace,Menlo,monospace;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#111}
pre{white-space:pre-wrap;word-break:break-word}
.verdict{display:inline-block;padding:.2rem .6rem;border-radius:4px;color:#fff;background:${color};font-weight:bold}
@media (prefers-color-scheme: dark){body{background:#0b0e14;color:#d5dbe5}}
</style></head>
<body><p class="verdict">${verdict}</p><pre>${rows}</pre></body></html>`;
}
