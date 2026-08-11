import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Paths inside a per-project `.ta/` workspace. */
export interface Workspace {
  root: string;
  configPath: string;
  dbPath: string;
  snapshotsDir: string;
  artifactsDir: string;
  agentIoDir: string;
  testcasesDir: string;
  generatedDir: string;
  designDir: string;
  skillsDir: string;
}

export function workspacePaths(dir: string): Workspace {
  const root = resolve(dir);
  return {
    root,
    configPath: join(root, 'ta.config.ts'),
    dbPath: join(root, 'ta.db'),
    snapshotsDir: join(root, 'snapshots'),
    artifactsDir: join(root, 'artifacts'),
    agentIoDir: join(root, 'agent-io'),
    testcasesDir: join(root, 'testcases'),
    generatedDir: join(root, 'generated'),
    designDir: join(root, 'design'),
    skillsDir: join(root, 'skills'),
  };
}

/** Locate the `.ta/` workspace at or above cwd. */
export function findWorkspace(startDir: string): Workspace | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, '.ta');
    if (existsSync(join(candidate, 'ta.config.ts'))) return workspacePaths(candidate);
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function ensureWorkspaceDirs(ws: Workspace): Promise<void> {
  for (const d of [
    ws.root,
    ws.snapshotsDir,
    ws.artifactsDir,
    ws.agentIoDir,
    ws.testcasesDir,
    ws.generatedDir,
    ws.designDir,
    ws.skillsDir,
  ]) {
    await mkdir(d, { recursive: true });
  }
}

/** Global home `~/.ta/`: cross-project skills, engine homes, project registry. */
export interface GlobalHome {
  root: string;
  skillsDir: string;
  standardsDir: string;
  enginesDir: string;
  projectsFile: string;
}

export function globalHome(base: string = homedir()): GlobalHome {
  const root = join(base, '.ta');
  return {
    root,
    skillsDir: join(root, 'skills'),
    standardsDir: join(root, 'standards'),
    enginesDir: join(root, 'engines'),
    projectsFile: join(root, 'projects.json'),
  };
}

export async function ensureGlobalHome(home: GlobalHome): Promise<void> {
  for (const d of [home.root, home.skillsDir, home.standardsDir, home.enginesDir]) {
    await mkdir(d, { recursive: true });
  }
}
