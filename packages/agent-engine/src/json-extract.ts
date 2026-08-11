import type { z } from 'zod';

export interface ExtractResult<T> {
  ok: boolean;
  data?: T;
  issues?: string;
}

/**
 * Extract the last JSON object from model output (bare, or inside ```json fences)
 * and validate it against the schema.
 */
export function extractAndValidate<T>(raw: string, schema: z.ZodTypeAny): ExtractResult<T> {
  const candidate = findJson(raw);
  if (candidate === undefined) return { ok: false, issues: 'No JSON object found in output.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    return { ok: false, issues: `JSON.parse failed: ${(e as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n'),
    };
  }
  return { ok: true, data: result.data as T };
}

function findJson(raw: string): string | undefined {
  // Prefer fenced blocks, last one wins.
  const fenced = [...raw.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const lastFence = fenced.at(-1)?.[1]?.trim();
  if (lastFence?.startsWith('{') || lastFence?.startsWith('[')) return lastFence;
  // Otherwise scan for the last balanced top-level {...}.
  const start = raw.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let best: string | undefined;
  let from = -1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) from = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && from !== -1) best = raw.slice(from, i + 1);
    }
  }
  return best;
}
