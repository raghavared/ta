import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentTaskSpec } from '../engine.js';
import { ReplayEngine, fixtureKey } from './replay.js';

const schema = z.object({ verdict: z.string() });

function task(context: Record<string, unknown>): AgentTaskSpec {
  return { kind: 'heal.triage', system: 'triage', context, schema };
}

describe('ReplayEngine', () => {
  it('serves a recorded fixture and validates it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ta-replay-'));
    const t = task({ error: 'TimeoutError' });
    await writeFile(join(dir, `${fixtureKey(t)}.json`), '{"verdict":"broken-selector"}', 'utf8');
    const engine = new ReplayEngine(dir);
    const result = await engine.runTask<{ verdict: string }>(t);
    expect(result.ok).toBe(true);
    expect(result.data?.verdict).toBe('broken-selector');
  });

  it('is keyed by context — different context misses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ta-replay-'));
    const t1 = task({ error: 'A' });
    await writeFile(join(dir, `${fixtureKey(t1)}.json`), '{"verdict":"x"}', 'utf8');
    const engine = new ReplayEngine(dir);
    const miss = await engine.runTask(task({ error: 'B' }));
    expect(miss.ok).toBe(false);
    expect(miss.error?.type).toBe('engine');
  });

  it('rejects fixtures that fail the schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ta-replay-'));
    const t = task({ error: 'C' });
    await writeFile(join(dir, `${fixtureKey(t)}.json`), '{"wrong":"shape"}', 'utf8');
    const engine = new ReplayEngine(dir);
    const result = await engine.runTask(t);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe('parse');
  });
});
