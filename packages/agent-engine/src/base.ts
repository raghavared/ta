import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, type EngineId } from '@ta/core';
import type { AgentEvent, AgentTaskResult, AgentTaskSpec } from './engine.js';
import { extractAndValidate } from './json-extract.js';
import { renderPrompt, renderRepairPrompt } from './prompt.js';

export interface TaskWorkdir {
  taskId: string;
  dir: string;
  promptPath: string;
  resultPath: string;
  transcriptPath: string;
}

export async function prepareWorkdir(agentIoDir: string, task: AgentTaskSpec): Promise<TaskWorkdir> {
  const taskId = newId('task');
  const dir = join(agentIoDir, taskId);
  await mkdir(dir, { recursive: true });
  const promptPath = join(dir, 'task.md');
  await writeFile(promptPath, renderPrompt(task), 'utf8');
  await writeFile(join(dir, 'context.json'), JSON.stringify(task.context, null, 2), 'utf8');
  for (const f of task.files ?? []) {
    const p = join(dir, 'files', f.path);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, f.content, 'utf8');
  }
  return {
    taskId,
    dir,
    promptPath,
    resultPath: join(dir, 'result.json'),
    transcriptPath: join(dir, 'transcript.md'),
  };
}

/**
 * Shared run loop: invoke the engine once, validate; on validation failure run
 * exactly one repair round; persist the final raw output next to the task.
 */
export async function runWithRepair<T>(params: {
  engineId: EngineId;
  task: AgentTaskSpec;
  workdir: TaskWorkdir;
  invoke: (prompt: string) => Promise<string>;
  onEvent?: (e: AgentEvent) => void;
  model?: string;
  sessionRef?: string;
}): Promise<AgentTaskResult<T>> {
  const { engineId, task, workdir, invoke, onEvent } = params;
  const started = Date.now();
  const meta = {
    engine: engineId,
    durationMs: 0,
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.sessionRef !== undefined ? { sessionRef: params.sessionRef } : {}),
    transcriptPath: workdir.transcriptPath,
  };
  onEvent?.({ type: 'started', detail: task.kind });
  let raw: string;
  try {
    raw = await invoke(renderPrompt(task));
  } catch (e) {
    meta.durationMs = Date.now() - started;
    return {
      ok: false,
      raw: '',
      error: { type: classifyInvokeError(e), message: (e as Error).message },
      meta,
    };
  }
  let extracted = extractAndValidate<T>(raw, task.schema);
  if (!extracted.ok) {
    onEvent?.({ type: 'repair', detail: extracted.issues ?? 'validation failed' });
    try {
      raw = await invoke(renderRepairPrompt(extracted.issues ?? 'unknown', raw));
      extracted = extractAndValidate<T>(raw, task.schema);
    } catch (e) {
      meta.durationMs = Date.now() - started;
      return {
        ok: false,
        raw,
        error: { type: classifyInvokeError(e), message: (e as Error).message },
        meta,
      };
    }
  }
  meta.durationMs = Date.now() - started;
  await writeFile(workdir.resultPath, raw, 'utf8').catch(() => {});
  onEvent?.({ type: 'finished' });
  if (!extracted.ok) {
    return {
      ok: false,
      raw,
      error: { type: 'parse', message: extracted.issues ?? 'schema validation failed' },
      meta,
    };
  }
  return { ok: true, data: extracted.data as T, raw, meta };
}

function classifyInvokeError(e: unknown): 'timeout' | 'engine' {
  const msg = (e as Error).message ?? '';
  return /timed? ?out/i.test(msg) ? 'timeout' : 'engine';
}
