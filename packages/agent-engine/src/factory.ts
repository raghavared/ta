import { join } from 'node:path';
import type { EngineId } from '@ta/core';
import type { AgentEngine, EngineOptions } from './engine.js';
import { ClaudeCliEngine } from './adapters/claude-cli.js';
import { CopilotCliEngine, defaultCopilotHome } from './adapters/copilot-cli.js';
import { ReplayEngine } from './adapters/replay.js';

export interface FactoryOptions extends EngineOptions {
  /** Global engines dir (~/.ta/engines) for isolated engine homes. */
  enginesDir: string;
  /** Fixtures dir for the replay engine. */
  replayFixturesDir?: string;
}

export function createEngine(id: EngineId, opts: FactoryOptions): AgentEngine {
  switch (id) {
    case 'copilot-cli':
      return new CopilotCliEngine({ ...opts, copilotHome: defaultCopilotHome(opts.enginesDir) });
    case 'claude-cli':
    case 'claude-agent-sdk': // SDK adapter lands in Phase 1; CLI adapter is behavior-compatible
      return new ClaudeCliEngine(opts);
    case 'replay':
      return new ReplayEngine(opts.replayFixturesDir ?? join(opts.agentIoDir, '..', 'recordings'));
  }
}
