import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentEngine,
  AgentEvent,
  AgentTaskResult,
  AgentTaskSpec,
  EngineCapabilities,
  EngineOptions,
} from '../engine.js';
import { prepareWorkdir, runWithRepair } from '../base.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface CopilotOptions extends EngineOptions {
  /** Isolated COPILOT_HOME so the platform never touches the user's Copilot config. */
  copilotHome: string;
  binary?: string;
}

/**
 * GitHub Copilot CLI adapter — stateless file protocol.
 * `copilot -p` has no JSON output mode or session resume, so each task is a
 * one-shot run instructed to write result.json in its private workdir; the
 * orchestrator carries all cross-call memory.
 */
export class CopilotCliEngine implements AgentEngine {
  readonly id = 'copilot-cli' as const;

  constructor(private opts: CopilotOptions) {}

  capabilities(): EngineCapabilities {
    return {
      structuredOutput: false,
      streaming: false,
      sessionResume: false,
      mcp: false,
      filesystemTasks: true,
      vision: false,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const bin = this.opts.binary ?? 'copilot';
    try {
      const { stdout } = await execa(bin, ['--version'], { timeout: 15_000 });
      return { ok: true, detail: `copilot ${stdout.trim()}` };
    } catch {
      return {
        ok: false,
        detail: 'Copilot CLI not found. Install: npm install -g @github/copilot, then run `copilot` once to sign in.',
      };
    }
  }

  async runTask<T>(task: AgentTaskSpec, onEvent?: (e: AgentEvent) => void): Promise<AgentTaskResult<T>> {
    if (task.images?.length) {
      return {
        ok: false,
        raw: '',
        error: { type: 'unsupported', message: 'copilot-cli engine has no vision support; route to visionFallbackEngine' },
        meta: { engine: this.id, durationMs: 0 },
      };
    }
    const workdir = await prepareWorkdir(this.opts.agentIoDir, task);
    const timeout = task.budget?.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const bin = this.opts.binary ?? 'copilot';

    const invoke = async (prompt: string): Promise<string> => {
      // File protocol: the prompt is already on disk as task.md; the instruction
      // tells Copilot to read it and write result.json. Repair rounds pass the
      // repair text inline instead.
      const isRepair = !prompt.startsWith('# Task:');
      const instruction = isRepair
        ? prompt
        : `Read ./task.md in this directory and follow it. Write your answer as a single JSON object to ./result.json. Do not modify any other files.`;
      const args = [
        '-p',
        instruction,
        '-s',
        '--no-ask-user',
        '--allow-tool',
        'write',
        '--deny-tool',
        'shell',
        '--add-dir',
        workdir.dir,
        '--share',
        workdir.transcriptPath,
      ];
      if (this.opts.model) args.push('--model', this.opts.model);
      const { stdout } = await execa(bin, args, {
        cwd: workdir.dir,
        timeout,
        env: {
          COPILOT_HOME: this.opts.copilotHome,
        },
        reject: true,
      });
      // Prefer result.json (file protocol), fall back to stdout.
      if (existsSync(workdir.resultPath)) {
        const fileResult = await readFile(workdir.resultPath, 'utf8');
        if (fileResult.trim()) return fileResult;
      }
      return stdout;
    };

    return runWithRepair<T>({
      engineId: this.id,
      task,
      workdir,
      invoke,
      ...(onEvent ? { onEvent } : {}),
      ...(this.opts.model !== undefined ? { model: this.opts.model } : {}),
    });
  }

  async dispose(): Promise<void> {}
}

export function defaultCopilotHome(enginesDir: string): string {
  return join(enginesDir, 'copilot-home');
}
