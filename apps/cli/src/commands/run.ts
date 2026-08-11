import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { runTests } from '@ta/runner';
import { loadConfig } from '../config-loader.js';

export async function runCommand(): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found. Run: ta init --url <target-url>'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  console.log(pc.bold('Running generated Playwright tests…'));
  const summary = await runTests({
    ws,
    db,
    appId: app.id,
    onProgress: (line) => console.log(pc.dim(`  ${line}`)),
  });
  console.log();
  const statusIcon = (s: string) =>
    s === 'passed' ? pc.green('✔') : s === 'flaky' ? pc.yellow('~') : s === 'skipped' ? pc.dim('-') : pc.red('✘');
  for (const r of summary.results) {
    console.log(`${statusIcon(r.status)} ${r.title} ${pc.dim(`(${r.specFile})`)}${r.error ? pc.red(` — ${r.error}`) : ''}`);
    if (r.tracePath) console.log(pc.dim(`    trace: npx playwright show-trace "${r.tracePath}"`));
  }
  console.log();
  const verdict = summary.failed === 0 ? pc.green('PASS') : pc.red('FAIL');
  console.log(
    `${verdict} — ${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped (${(summary.durationMs / 1000).toFixed(1)}s)`,
  );
  console.log(pc.dim(`run id: ${summary.runId}`));
  if (summary.failed > 0) process.exitCode = 1;
}
