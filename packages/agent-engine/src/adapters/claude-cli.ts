import { execa } from 'execa';
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

/**
 * Claude Code headless adapter: `claude -p --output-format json`.
 * Supports vision (image paths referenced in the prompt) and real structured
 * output; kept subprocess-based so no SDK dependency is required in Phase 0.
 */
export class ClaudeCliEngine implements AgentEngine {
  readonly id = 'claude-cli' as const;

  constructor(private opts: EngineOptions & { binary?: string }) {}

  capabilities(): EngineCapabilities {
    return {
      structuredOutput: true,
      streaming: true,
      sessionResume: true,
      mcp: true,
      filesystemTasks: true,
      vision: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const bin = this.opts.binary ?? 'claude';
    try {
      const { stdout } = await execa(bin, ['--version'], { timeout: 15_000 });
      return { ok: true, detail: `claude ${stdout.trim()}` };
    } catch {
      return {
        ok: false,
        detail: 'Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code',
      };
    }
  }

  async runTask<T>(task: AgentTaskSpec, onEvent?: (e: AgentEvent) => void): Promise<AgentTaskResult<T>> {
    const workdir = await prepareWorkdir(this.opts.agentIoDir, task);
    const timeout = task.budget?.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const bin = this.opts.binary ?? 'claude';

    const invoke = async (prompt: string): Promise<string> => {
      const fullPrompt = task.images?.length
        ? `${prompt}\n\n## Image inputs\nRead and analyze these image files:\n${task.images.map((i) => `- ${i.path}`).join('\n')}`
        : prompt;
      const args = ['-p', fullPrompt, '--output-format', 'json'];
      if (this.opts.model) args.push('--model', this.opts.model);
      if (task.images?.length) args.push('--allowedTools', 'Read');
      const { stdout } = await execa(bin, args, {
        cwd: workdir.dir,
        timeout,
        reject: true,
      });
      // --output-format json wraps the response in an envelope with a `result` field.
      try {
        const envelope = JSON.parse(stdout) as { result?: string };
        if (typeof envelope.result === 'string') return envelope.result;
      } catch {
        /* not an envelope — treat stdout as the raw response */
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
