import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { analyzeSource } from '@ta/analyzer';
import { loadConfig } from '../config-loader.js';

export async function analyzeCommand(): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  if (!config.sourceRoot) {
    console.log(pc.yellow('No sourceRoot configured — add `sourceRoot` to ta.config.ts to enable static analysis.'));
    return;
  }
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  console.log(pc.bold(`Analyzing source at ${config.sourceRoot}…`));
  const result = await analyzeSource({
    sourceRoot: config.sourceRoot,
    ws,
    db,
    appId: app.id,
    onProgress: (m) => console.log(pc.dim(`  ${m}`)),
  });
  console.log(pc.green(`✔ ${result.components} components, ${result.testIds.length} testids in source`));
  console.log(`  linked to runtime elements: ${result.linkedElements}`);
  console.log(`  selector scores boosted:    ${result.boostedSelectors}`);
  if (result.unseenTestIds.length > 0) {
    console.log(pc.yellow(`\n  testids in source never observed at runtime (coverage gaps):`));
    for (const t of result.unseenTestIds) {
      console.log(pc.yellow(`    ${t.value}${t.isPattern ? ' (pattern)' : ''} — ${t.component} in ${t.filePath}`));
    }
  }
}
