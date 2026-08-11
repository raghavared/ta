import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { runPlan, syncDraftStatuses } from '@ta/planner';
import { loadConfig } from '../config-loader.js';
import { engineFor } from '../engine.js';

export async function planCommand(opts: { sync?: boolean; engine?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found. Run: ta init --url <target-url>'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);

  if (opts.sync) {
    const result = await syncDraftStatuses(ws, db);
    if (result.updated.length === 0) {
      console.log(pc.yellow(`No status changes found (${result.unchanged} drafts unchanged).`));
      return;
    }
    for (const u of result.updated) {
      const color = u.to === 'approved' ? pc.green : u.to === 'rejected' ? pc.red : pc.yellow;
      console.log(`${color('●')} ${u.id}: ${u.from} → ${color(u.to)}`);
    }
    const approvedNow = result.updated.filter((u) => u.to === 'approved').length;
    if (approvedNow > 0) console.log(`\n${pc.bold(`${approvedNow} approved`)} — run ${pc.bold('ta generate')} next.`);
    return;
  }

  const engine = engineFor(config, ws, opts.engine);
  const health = await engine.healthCheck();
  if (!health.ok) {
    console.error(pc.red(`Engine ${engine.id} unavailable: ${health.detail}`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.bold(`Planning test cases with engine ${engine.id}…`));
  const result = await runPlan({ config, ws, db, appId: app.id, engine });
  console.log(pc.green(`✔ ${result.drafts.length} test case drafts from ${result.flowsConsidered} flows`));
  for (const d of result.drafts) console.log(`  ${pc.dim(d.id)} ${d.title}`);
  console.log(`\nReview the drafts in ${pc.bold(ws.testcasesDir)}`);
  console.log(`Set ${pc.bold('status: approved')} in the frontmatter, then run ${pc.bold('ta plan --sync')}.`);
}
