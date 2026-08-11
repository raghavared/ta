import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { openDb } from '@ta/store';
import { runExplore } from '@ta/explorer';
import { loadConfig } from '../config-loader.js';

export async function exploreCommand(opts: {
  maxStates?: string;
  maxActions?: string;
  headed?: boolean;
}): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found. Run: ta init --url <target-url>'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  if (opts.maxStates) config.budgets.maxStates = Number(opts.maxStates);
  if (opts.maxActions) config.budgets.maxActions = Number(opts.maxActions);

  console.log(pc.bold(`Exploring ${config.baseUrl}`));
  console.log(
    pc.dim(
      `budgets: ${config.budgets.maxStates} states, ${config.budgets.maxActions} actions, ${Math.round(config.budgets.wallClockMs / 1000)}s`,
    ),
  );

  const db = openDb(ws.dbPath);
  const result = await runExplore({
    config,
    ws,
    db,
    headless: !opts.headed,
    onProgress: (msg) => console.log(pc.dim(`  ${msg}`)),
  });

  console.log();
  console.log(pc.green(`✔ Exploration complete in ${(result.durationMs / 1000).toFixed(1)}s`));
  console.log(`  states discovered:    ${result.statesDiscovered}`);
  console.log(`  actions executed:     ${result.actionsExecuted}`);
  console.log(`  transitions recorded: ${result.transitionsRecorded}`);
  console.log(`  destructive blocked:  ${result.destructiveBlocked}`);
}
