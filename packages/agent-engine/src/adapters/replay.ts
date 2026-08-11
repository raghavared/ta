import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentEngine,
  AgentEvent,
  AgentTaskResult,
  AgentTaskSpec,
  EngineCapabilities,
} from '../engine.js';
import { extractAndValidate } from '../json-extract.js';

/** Stable key over task kind + canonical context (sorted object keys). */
export function fixtureKey(task: Pick<AgentTaskSpec, 'kind' | 'context'>): string {
  const canonical = JSON.stringify(task.context, Object.keys(flatten(task.context)).sort());
  return createHash('sha256').update(`${task.kind}\n${canonical}`).digest('hex').slice(0, 24);
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Replay engine: serves recorded task→result fixtures. Deterministic and
 * LLM-free — the engine CI and self-e2e tests run on this.
 */
export class ReplayEngine implements AgentEngine {
  readonly id = 'replay' as const;

  constructor(private fixturesDir: string) {}

  capabilities(): EngineCapabilities {
    return {
      structuredOutput: true,
      streaming: false,
      sessionResume: false,
      mcp: false,
      filesystemTasks: false,
      vision: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return existsSync(this.fixturesDir)
      ? { ok: true, detail: `replay fixtures at ${this.fixturesDir}` }
      : { ok: false, detail: `fixtures directory missing: ${this.fixturesDir}` };
  }

  async runTask<T>(task: AgentTaskSpec, onEvent?: (e: AgentEvent) => void): Promise<AgentTaskResult<T>> {
    onEvent?.({ type: 'started', detail: task.kind });
    const key = fixtureKey(task);
    const path = join(this.fixturesDir, `${key}.json`);
    const started = Date.now();
    if (!existsSync(path)) {
      return {
        ok: false,
        raw: '',
        error: { type: 'engine', message: `No recorded fixture for ${task.kind} (key ${key})` },
        meta: { engine: this.id, durationMs: Date.now() - started },
      };
    }
    const raw = await readFile(path, 'utf8');
    const extracted = extractAndValidate<T>(raw, task.schema);
    onEvent?.({ type: 'finished' });
    if (!extracted.ok) {
      return {
        ok: false,
        raw,
        error: { type: 'parse', message: extracted.issues ?? 'fixture failed schema' },
        meta: { engine: this.id, durationMs: Date.now() - started },
      };
    }
    return { ok: true, data: extracted.data as T, raw, meta: { engine: this.id, durationMs: Date.now() - started } };
  }

  async dispose(): Promise<void> {}
}

/** Wrap any engine so successful results are recorded as replay fixtures. */
export function withRecorder(engine: AgentEngine, fixturesDir: string): AgentEngine {
  return {
    id: engine.id,
    capabilities: () => engine.capabilities(),
    healthCheck: () => engine.healthCheck(),
    dispose: () => engine.dispose(),
    async runTask<T>(task: AgentTaskSpec, onEvent?: (e: AgentEvent) => void) {
      const result = await engine.runTask<T>(task, onEvent);
      if (result.ok) {
        await mkdir(fixturesDir, { recursive: true });
        await writeFile(join(fixturesDir, `${fixtureKey(task)}.json`), result.raw, 'utf8');
      }
      return result;
    },
  };
}
