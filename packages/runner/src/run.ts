import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { eq } from 'drizzle-orm';
import { newId, type Workspace } from '@ta/core';
import { runs, testCases, testResults, type TaDb } from '@ta/store';

interface PwReportTestResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  error?: { message?: string; stack?: string };
  /** Rich per-error detail (locator context lives here, not in error.message). */
  errors?: { message?: string }[];
  attachments?: { name: string; path?: string }[];
  retry: number;
}

interface PwReport {
  suites: PwSuite[];
  stats?: { expected: number; unexpected: number; flaky: number; skipped: number };
}
interface PwSuite {
  title: string;
  file?: string;
  suites?: PwSuite[];
  specs?: { title: string; file: string; tests: { results: PwReportTestResult[] }[] }[];
}

export interface RunSummary {
  runId: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
  reportPath: string;
  results: { title: string; specFile: string; status: string; error?: string; tracePath?: string }[];
}

/** Playwright error strings carry terminal color codes — strip before storing. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export async function runTests(params: {
  ws: Workspace;
  db: TaDb;
  appId: string;
  /** Run only this spec file (basename), e.g. for heal re-runs. */
  specFile?: string;
  trigger?: 'cli' | 'api' | 'heal-rerun';
  onProgress?: (line: string) => void;
}): Promise<RunSummary> {
  const { ws, db, appId } = params;
  const log = params.onProgress ?? (() => {});
  const startedAt = Date.now();
  const runId = newId('run');
  const outputDir = join(ws.artifactsDir, runId);
  await mkdir(outputDir, { recursive: true });
  const reportPath = join(outputDir, 'report.json');

  // Generated project is self-contained; install its @playwright/test once.
  if (!existsSync(join(ws.generatedDir, 'node_modules'))) {
    log('installing @playwright/test in generated project (one-time)…');
    await execa('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: ws.generatedDir,
      timeout: 5 * 60 * 1000,
    });
  }

  db.insert(runs).values({ id: runId, appId, trigger: params.trigger ?? 'cli', startedAt }).run();

  const pwArgs = ['playwright', 'test', '--config', 'playwright.config.ts'];
  if (params.specFile) pwArgs.push(params.specFile);
  const proc = execa('npx', pwArgs, {
    cwd: ws.generatedDir,
    env: { TA_OUTPUT_DIR: outputDir, TA_JSON_REPORT: reportPath },
    timeout: 10 * 60 * 1000,
    reject: false,
  });
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) if (line.trim()) log(line.trimEnd());
  });
  await proc;

  if (!existsSync(reportPath)) {
    db.update(runs).set({ finishedAt: Date.now(), summaryJson: '{"error":"no report"}' }).where(eq(runs.id, runId)).run();
    throw new Error('Playwright produced no JSON report — check generated/playwright.config.ts');
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as PwReport;

  const cases = db.select().from(testCases).where(eq(testCases.appId, appId)).all();
  const caseBySpecName = new Map(cases.map((c) => [basename(c.specPath), c]));

  const summary: RunSummary = {
    runId,
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: 0,
    reportPath,
    results: [],
  };

  const walk = (suite: PwSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const results = t.results;
        const last = results[results.length - 1];
        if (!last) continue;
        summary.total++;
        const passedEventually = last.status === 'passed';
        const hadRetry = results.length > 1;
        const status: 'passed' | 'failed' | 'flaky' | 'skipped' =
          last.status === 'skipped' ? 'skipped' : passedEventually ? (hadRetry ? 'flaky' : 'passed') : 'failed';
        summary[status === 'flaky' ? 'flaky' : status === 'passed' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed']++;
        const trace = results.flatMap((r) => r.attachments ?? []).find((a) => a.name === 'trace' && a.path);
        const video = results.flatMap((r) => r.attachments ?? []).find((a) => a.name === 'video' && a.path);
        const tc = caseBySpecName.get(basename(spec.file));
        const richError = (last.errors ?? [])
          .map((e) => e.message ?? '')
          .filter(Boolean)
          .join('\n\n');
        const errorMessage = passedEventually
          ? undefined
          : stripAnsi(richError || last.error?.message || 'unknown failure');
        db.insert(testResults)
          .values({
            id: newId('res'),
            runId,
            testCaseId: tc?.id ?? 'unmapped',
            status,
            durationMs: results.reduce((s, r) => s + r.duration, 0),
            tracePath: trace?.path ?? null,
            videoPath: video?.path ?? null,
            errorMessage: errorMessage ?? null,
            errorStack: passedEventually ? null : stripAnsi(last.error?.stack ?? '') || null,
          })
          .run();
        summary.results.push({
          title: spec.title,
          specFile: basename(spec.file),
          status,
          ...(errorMessage !== undefined ? { error: errorMessage.split('\n')[0] } : {}),
          ...(trace?.path !== undefined ? { tracePath: trace.path } : {}),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);

  summary.durationMs = Date.now() - startedAt;
  db.update(runs)
    .set({
      finishedAt: Date.now(),
      summaryJson: JSON.stringify({
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        flaky: summary.flaky,
        skipped: summary.skipped,
      }),
    })
    .where(eq(runs.id, runId))
    .run();
  return summary;
}
