import { execa } from 'execa';
import pc from 'picocolors';
import { findWorkspace, globalHome } from '@ta/core';
import { createEngine } from '@ta/agent-engine';
import { join } from 'node:path';

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

export async function doctorCommand(): Promise<void> {
  const home = globalHome();
  const ws = findWorkspace(process.cwd());
  const agentIoDir = ws?.agentIoDir ?? join(home.root, 'agent-io');

  const engineOpts = {
    agentIoDir,
    enginesDir: home.enginesDir,
  };

  const checks: Check[] = [
    {
      name: 'Node.js >= 22',
      run: async () => {
        const major = Number(process.versions.node.split('.')[0]);
        return { ok: major >= 22, detail: `v${process.versions.node}` };
      },
    },
    {
      name: 'Playwright browsers',
      run: async () => {
        try {
          const { stdout } = await execa('npx', ['playwright', '--version'], { timeout: 60_000 });
          return { ok: true, detail: stdout.trim() };
        } catch {
          return { ok: false, detail: 'Run: pnpm add -D playwright && npx playwright install chromium' };
        }
      },
    },
    {
      name: 'Engine: copilot-cli',
      run: () => createEngine('copilot-cli', engineOpts).healthCheck(),
    },
    {
      name: 'Engine: claude-cli',
      run: () => createEngine('claude-cli', engineOpts).healthCheck(),
    },
    {
      name: 'Workspace',
      run: async () =>
        ws
          ? { ok: true, detail: ws.root }
          : { ok: false, detail: 'No .ta workspace found. Run: ta init --url <target-url>' },
    },
  ];

  let failures = 0;
  for (const check of checks) {
    const result = await check.run();
    const icon = result.ok ? pc.green('✔') : pc.red('✘');
    if (!result.ok) failures++;
    console.log(`${icon} ${check.name.padEnd(24)} ${pc.dim(result.detail)}`);
  }
  console.log();
  if (failures === 0) {
    console.log(pc.green('All checks passed.'));
  } else {
    console.log(pc.yellow(`${failures} check(s) need attention. The platform runs with any one healthy engine.`));
  }
}
