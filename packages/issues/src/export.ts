import { writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { issues, type TaDb } from '@ta/store';

/**
 * Export all issues to the "separate sheet" — a CSV keyed by fingerprint so
 * re-exports update the same logical rows (Google Sheets adapter in Phase 2).
 */
export async function exportIssuesCsv(db: TaDb, appId: string, path: string): Promise<number> {
  const rows = db.select().from(issues).where(eq(issues.appId, appId)).all();
  const header = [
    'Fingerprint',
    'Status',
    'Severity',
    'Kind',
    'Title',
    'Page',
    'Repro steps',
    'Occurrences',
    'First seen run',
    'Last seen run',
    'Trace',
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [header.map(escape).join(',')];
  for (const row of rows) {
    const evidence = JSON.parse(row.evidenceJson) as { page?: string; tracePath?: string };
    const repro = (JSON.parse(row.reproStepsJson) as string[]).join(' → ');
    lines.push(
      [
        row.fingerprint,
        row.status,
        row.severity,
        row.kind,
        row.title,
        evidence.page ?? '',
        repro,
        String(row.occurrences),
        row.firstSeenRunId ?? '',
        row.lastSeenRunId ?? '',
        evidence.tracePath ?? '',
      ]
        .map(escape)
        .join(','),
    );
  }
  await writeFile(path, lines.join('\n') + '\n', 'utf8');
  return rows.length;
}
