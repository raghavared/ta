import type { z } from 'zod';
import type { EngineId } from '@ta/core';

export type AgentTaskKind =
  | 'explore.plan'
  | 'explore.fill-form'
  | 'design.describe'
  | 'requirements.extract'
  | 'requirements.map'
  | 'plan.testcases'
  | 'generate.name-flows'
  | 'generate.spec'
  | 'generate.fix'
  | 'heal.triage'
  | 'heal.reselect'
  | 'skill.author';

export interface AgentTaskSpec {
  kind: AgentTaskKind;
  /** Role + rules for this task kind. */
  system: string;
  /** Structured context: snapshots, selector tables, learnings, skills. */
  context: Record<string, unknown>;
  /** Required result schema; results failing validation trigger one repair round. */
  schema: z.ZodTypeAny;
  /** Vision inputs (design screenshots). Engines lacking vision must reject. */
  images?: { path: string }[];
  /** Extra files placed in the task workdir for file-capable engines. */
  files?: { path: string; content: string }[];
  budget?: { timeoutMs: number };
}

export interface AgentEvent {
  type: 'started' | 'chunk' | 'repair' | 'finished';
  detail?: string;
}

export interface AgentTaskResult<T = unknown> {
  ok: boolean;
  data?: T;
  raw: string;
  error?: { type: 'parse' | 'timeout' | 'engine' | 'refusal' | 'unsupported'; message: string };
  meta: {
    engine: EngineId;
    model?: string;
    durationMs: number;
    sessionRef?: string;
    transcriptPath?: string;
  };
}

export interface EngineCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  sessionResume: boolean;
  mcp: boolean;
  filesystemTasks: boolean;
  vision: boolean;
}

export interface AgentEngine {
  readonly id: EngineId;
  capabilities(): EngineCapabilities;
  /** Binary present, auth valid, ready to serve tasks. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
  runTask<T = unknown>(
    task: AgentTaskSpec,
    onEvent?: (e: AgentEvent) => void,
  ): Promise<AgentTaskResult<T>>;
  dispose(): Promise<void>;
}

export interface EngineOptions {
  /** Directory where per-task workdirs are created (.ta/agent-io). */
  agentIoDir: string;
  model?: string;
  defaultTimeoutMs?: number;
}
