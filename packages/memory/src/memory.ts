import { and, eq } from 'drizzle-orm';
import { newId, type LearningKind, type LearningScope } from '@ta/core';
import { learnings, type TaDb } from '@ta/store';

const SCOPE_SPECIFICITY: Record<LearningScope, number> = {
  element: 4,
  page: 3,
  app: 2,
  engine: 1,
  global: 0,
};

export interface LearningInput {
  appId?: string;
  scope: LearningScope;
  scopeRef?: string;
  kind: LearningKind;
  content: string;
  evidence?: Record<string, unknown>;
  confidence?: number;
  createdByTaskId?: string;
}

/**
 * Write a learning with dedup: a sufficiently similar existing learning of the
 * same scope+kind is reinforced (hitCount++, confidence up) instead of duplicated.
 */
export function writeLearning(db: TaDb, input: LearningInput): { id: string; deduped: boolean } {
  const existing = db
    .select()
    .from(learnings)
    .where(and(eq(learnings.scope, input.scope), eq(learnings.kind, input.kind)))
    .all()
    .filter((l) => (input.appId ? l.appId === input.appId : true));
  for (const l of existing) {
    if (similarity(l.content, input.content) >= 0.7) {
      db.update(learnings)
        .set({
          hitCount: l.hitCount + 1,
          confidence: Math.min(1, l.confidence + 0.1),
          lastUsedAt: Date.now(),
        })
        .where(eq(learnings.id, l.id))
        .run();
      return { id: l.id, deduped: true };
    }
  }
  const id = newId('learn');
  db.insert(learnings)
    .values({
      id,
      appId: input.appId ?? null,
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      kind: input.kind,
      content: input.content,
      evidenceJson: JSON.stringify(input.evidence ?? {}),
      confidence: input.confidence ?? 0.5,
      hitCount: 0,
      createdByTaskId: input.createdByTaskId ?? null,
      createdAt: Date.now(),
    })
    .run();
  return { id, deduped: false };
}

export interface RetrievalOptions {
  appId: string;
  kinds?: LearningKind[];
  limit?: number;
  /** Approximate character budget for the rendered prompt section. */
  charBudget?: number;
}

/** Top learnings by scope specificity → confidence → recency, within budget. */
export function getLearnings(db: TaDb, opts: RetrievalOptions) {
  const rows = db
    .select()
    .from(learnings)
    .all()
    .filter((l) => l.appId === opts.appId || l.scope === 'global')
    .filter((l) => (opts.kinds ? opts.kinds.includes(l.kind as LearningKind) : true))
    .sort(
      (a, b) =>
        SCOPE_SPECIFICITY[b.scope as LearningScope] - SCOPE_SPECIFICITY[a.scope as LearningScope] ||
        b.confidence - a.confidence ||
        b.createdAt - a.createdAt,
    );
  const limit = opts.limit ?? 12;
  const budget = opts.charBudget ?? 4000;
  const kept: typeof rows = [];
  let used = 0;
  for (const row of rows) {
    if (kept.length >= limit || used + row.content.length > budget) break;
    kept.push(row);
    used += row.content.length;
  }
  // Touch lastUsedAt so decay can distinguish used from ignored learnings.
  for (const row of kept) {
    db.update(learnings).set({ lastUsedAt: Date.now() }).where(eq(learnings.id, row.id)).run();
  }
  return kept;
}

/** Render learnings as a prompt section; empty string when none. */
export function renderLearningsSection(rows: { kind: string; content: string }[]): string {
  if (rows.length === 0) return '';
  return [
    '## Learned facts about this app (from prior runs — apply them)',
    ...rows.map((l) => `- [${l.kind}] ${l.content}`),
  ].join('\n');
}

/** Cheap token-set similarity for dedup. */
export function similarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}
