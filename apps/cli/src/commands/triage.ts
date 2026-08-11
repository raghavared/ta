import { join } from 'node:path';
import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, openDb } from '@ta/store';
import { triageRun } from '@ta/healer';
import { exportIssuesCsv } from '@ta/issues';
import { loadConfig } from '../config-loader.js';
import { engineFor } from '../engine.js';

export async function triageCommand(opts: { run?: string; engine?: string }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const engine = engineFor(config, ws, opts.engine);
  const health = await engine.healthCheck();

  console.log(pc.bold('Triaging failures…'));
  const { runId, outcomes } = await triageRun({
    db,
    appId: app.id,
    ...(opts.run !== undefined ? { runId: opts.run } : {}),
    ...(health.ok ? { engine } : {}),
    onProgress: (m) => console.log(pc.dim(`  ${m}`)),
  });
  if (!health.ok) console.log(pc.yellow(`  (engine ${engine.id} unavailable — deterministic classification only)`));

  if (outcomes.length === 0) {
    console.log(pc.green(`✔ No failures in run ${runId} — nothing to triage.`));
    return;
  }
  for (const o of outcomes) {
    const badge =
      o.classification === 'app-bug'
        ? pc.red(o.classification)
        : o.classification === 'broken-selector'
          ? pc.yellow(o.classification)
          : pc.cyan(o.classification);
    console.log(`\n${badge} (${Math.round(o.confidence * 100)}%${o.viaLlm ? ', via LLM' : ''}) — ${o.title}`);
    console.log(pc.dim(`  ${o.rationale}`));
    if (o.issue) {
      const verb =
        o.issue.outcome === 'created' ? pc.red('issue filed') : o.issue.outcome === 'reopened' ? pc.red('issue REOPENED') : pc.yellow(`issue recurred (×${o.issue.occurrences})`);
      console.log(`  ${verb}: ${o.issue.title} [${o.issue.issueId}]`);
    }
  }

  const csvPath = join(ws.root, 'issues.csv');
  const count = await exportIssuesCsv(db, app.id, csvPath);
  if (count > 0) console.log(`\n${pc.bold('Issue sheet updated:')} ${csvPath} (${count} issues)`);
}
