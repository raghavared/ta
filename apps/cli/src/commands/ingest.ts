import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { ingestRequirements } from '@ta/requirements';
import { ingestDesign } from '@ta/design';
import { loadConfig } from '../config-loader.js';
import { engineFor } from '../engine.js';

export async function requirementsCommand(opts: { engine?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  if (config.requirements.length === 0) {
    console.log(pc.yellow('No requirement docs configured — add `requirements: [...]` to ta.config.ts'));
    return;
  }
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const engine = engineFor(config, ws, opts.engine);
  const health = await engine.healthCheck();
  if (!health.ok) {
    console.error(pc.red(`Engine ${engine.id} unavailable: ${health.detail}`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.bold(`Ingesting BRD/PRD documents (engine ${engine.id})…`));
  const result = await ingestRequirements({
    config,
    ws,
    db,
    appId: app.id,
    engine,
    onProgress: (m) => console.log(pc.dim(`  ${m}`)),
  });
  console.log(pc.green(`✔ ${result.total} requirements across ${result.docs.length} doc(s)`));
  console.log(`Requirements now drive ${pc.bold('ta plan')} — re-plan to get requirement-traceable test cases.`);
}

export async function designCommand(opts: { engine?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);

  // Vision routing: primary engine unless it lacks vision, then the fallback.
  let engine = engineFor(config, ws, opts.engine);
  if (!engine.capabilities().vision && config.visionFallbackEngine) {
    console.log(pc.dim(`engine ${engine.id} lacks vision — routing to ${config.visionFallbackEngine}`));
    engine = engineFor(config, ws, config.visionFallbackEngine);
  }
  const health = await engine.healthCheck();
  if (!health.ok) {
    console.error(pc.red(`Engine ${engine.id} unavailable: ${health.detail}`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.bold(`Ingesting design screenshots (engine ${engine.id})…`));
  const result = await ingestDesign({
    config,
    ws,
    db,
    appId: app.id,
    engine,
    onProgress: (m) => console.log(pc.dim(`  ${m}`)),
  });
  console.log(pc.green(`✔ ${result.screens.length} design screens ingested`));
  for (const gap of result.gaps) console.log(pc.yellow(`  conformance gap: ${gap}`));
  console.log(`Design expectations now feed ${pc.bold('ta plan')}.`);
}
