import { createJiti } from 'jiti';
import { parseConfig, type TaConfig, type Workspace } from '@ta/core';

/** Load and validate ta.config.ts (TypeScript, so loaded via jiti). */
export async function loadConfig(ws: Workspace): Promise<TaConfig> {
  const jiti = createJiti(import.meta.url, {
    // Workspaces live outside the monorepo; resolve @ta/core to the CLI's copy.
    alias: { '@ta/core': import.meta.resolve('@ta/core').replace('file://', '') },
  });
  const mod = await jiti.import<{ default: unknown }>(ws.configPath);
  return parseConfig((mod as { default?: unknown }).default ?? mod);
}
