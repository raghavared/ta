import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { healRun } from '@ta/healer';
import { loadConfig } from '../config-loader.js';

export async function healCommand(opts: { run?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  console.log(pc.bold('Self-healing broken selectors…'));
  const outcomes = await healRun({
    config,
    ws,
    db,
    appId: app.id,
    ...(opts.run !== undefined ? { runId: opts.run } : {}),
    onProgress: (m) => console.log(pc.dim(`  ${m}`)),
  });
  if (outcomes.length === 0) {
    console.log(pc.green('✔ Nothing to heal.'));
    return;
  }
  for (const o of outcomes) {
    const badge = o.rerun === 'fixed' ? pc.green('FIXED') : o.rerun === 'not-fixed' ? pc.red('NOT FIXED') : pc.yellow('SKIPPED');
    console.log(`\n${badge} ${o.title} ${pc.dim(`(${o.specFile})`)}`);
    for (const p of o.patches) console.log(`  sel.${p.key}: ${pc.dim(p.from)} → ${p.to}`);
  }
}
