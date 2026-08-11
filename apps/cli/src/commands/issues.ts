import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import pc from 'picocolors';
import { findWorkspace } from '@ta/core';
import { ensureApp, issues, openDb } from '@ta/store';
import { exportIssuesCsv } from '@ta/issues';
import { loadConfig } from '../config-loader.js';

export async function issuesCommand(opts: { sync?: boolean }): Promise<void> {
  const ws = findWorkspace(process.cwd());
  if (!ws) {
    console.error(pc.red('No .ta workspace found.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(ws);
  const db = openDb(ws.dbPath);
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const rows = db.select().from(issues).where(eq(issues.appId, app.id)).all();

  if (opts.sync) {
    const csvPath = join(ws.root, 'issues.csv');
    const count = await exportIssuesCsv(db, app.id, csvPath);
    console.log(pc.green(`✔ Exported ${count} issues to ${csvPath}`));
    return;
  }

  if (rows.length === 0) {
    console.log('No issues on file.');
    return;
  }
  for (const issue of rows) {
    const badge =
      issue.status === 'open' || issue.status === 'reopened' ? pc.red(issue.status.toUpperCase()) : pc.green(issue.status.toUpperCase());
    console.log(`${badge} [${issue.severity}] ${issue.title} ${pc.dim(`×${issue.occurrences} (${issue.id})`)}`);
  }
}
