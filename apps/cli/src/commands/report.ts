import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { generateReport } from '@ta/report';
import { loadConfig } from '../config-loader.js';

export async function reportCommand(opts: { run?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const paths = await generateReport({
    config,
    ws,
    db,
    appId: app.id,
    ...(opts.run !== undefined ? { runId: opts.run } : {}),
  });
  console.log(pc.green('✔ Test summary report generated'));
  console.log(`  markdown: ${paths.markdownPath}`);
  console.log(`  html:     ${paths.htmlPath}`);
}
