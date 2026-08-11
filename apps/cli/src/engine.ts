import { globalHome, type TaConfig, type Workspace } from '@ta/core';
import { createEngine, type AgentEngine } from '@ta/agent-engine';

export function engineFor(config: TaConfig, ws: Workspace, override?: string): AgentEngine {
  const home = globalHome();
  const id = (override ?? config.engine) as TaConfig['engine'];
  return createEngine(id, {
    agentIoDir: ws.agentIoDir,
    enginesDir: home.enginesDir,
    ...(config.model !== undefined ? { model: config.model } : {}),
  });
}
