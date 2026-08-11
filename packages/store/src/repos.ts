import { eq } from 'drizzle-orm';
import { newId } from '@ta/core';
import type { TaDb } from './db.js';
import { apps } from './schema.js';

/** Get or create the single app row for this workspace. */
export function ensureApp(db: TaDb, name: string, baseUrl: string, sourceRoot?: string) {
  const existing = db.select().from(apps).where(eq(apps.baseUrl, baseUrl)).get();
  if (existing) return existing;
  const row = {
    id: newId('app'),
    name,
    baseUrl,
    sourceRoot: sourceRoot ?? null,
    createdAt: Date.now(),
  };
  db.insert(apps).values(row).run();
  return row;
}
