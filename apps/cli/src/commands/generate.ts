import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { runGenerate } from '@ta/generator';
import { loadConfig } from '../config-loader.js';
import { engineFor } from '../engine.js';

export async function generateCommand(opts: { engine?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found. Run: ta init --url <target-url>'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const engine = engineFor(config, ws, opts.engine);
  const health = await engine.healthCheck();
  if (!health.ok) {
    console.error(pc.red(`Engine ${engine.id} unavailable: ${health.detail}`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.bold(`Generating specs from approved test cases (engine ${engine.id})…`));
  const result = await runGenerate({
    config,
    ws,
    db,
    appId: app.id,
    engine,
    onProgress: (m) => console.log(pc.dim(`  ${m}`)),
  });
  console.log(pc.green(`✔ ${result.generated.length} specs generated`));
  for (const g of result.generated) console.log(`  ${g.specPath}`);
  for (const s of result.skipped) console.log(pc.yellow(`  skipped ${s.draftId}: ${s.reason}`));
  if (result.generated.length > 0) console.log(`\nRun them with ${pc.bold('ta run')}.`);
}
