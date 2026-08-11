import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { startServer } from '@ta/server';
import { loadConfig } from '../config-loader.js';

export async function serveCommand(opts: { port?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const url = await startServer({
    ws,
    config,
    db,
    appId: app.id,
    ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
  });
  console.log(pc.green(`✔ Dashboard: ${url}`));
  console.log(pc.dim('  Ctrl+C to stop'));
}
