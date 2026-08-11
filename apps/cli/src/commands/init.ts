import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pc from 'picocolors';
import {
  ensureGlobalHome,
  ensureWorkspaceDirs,
  globalHome,
  workspacePaths,
} from '@ta/core';
import { ensureApp, openDb } from '@ta/store';

const CONFIG_TEMPLATE = (name: string, baseUrl: string) => `import { defineConfig } from '@ta/core';

export default defineConfig({
  name: '${name}',
  baseUrl: '${baseUrl}',
  // sourceRoot: '../',                       // optional: target app source for static analysis
  // requirements: ['docs/prd.md'],           // optional: BRD/PRD documents
  // design: { screenshotsDir: 'design' },    // optional: design screenshots (or figmaFileKey)
  engine: 'copilot-cli',                      // 'copilot-cli' | 'claude-cli' | 'replay'
  visionFallbackEngine: 'claude-cli',
  // auth: {
  //   loginUrl: '${baseUrl}/login',
  //   steps: [
  //     { action: 'fill', selector: '[data-testid=login-email]', value: '$TA_LOGIN_EMAIL' },
  //     { action: 'fill', selector: '[data-testid=login-password]', value: '$TA_LOGIN_PASSWORD' },
  //     { action: 'click', selector: '[data-testid=login-submit]' },
  //   ],
  // },
});
`;

export async function initCommand(opts: { url: string; name?: string; dir?: string }): Promise<void> {
  const wsDir = join(process.cwd(), opts.dir ?? '.ta');
  const ws = workspacePaths(wsDir);
  if (existsSync(ws.configPath)) {
    console.log(pc.yellow(`Workspace already exists at ${ws.root} — leaving it untouched.`));
    return;
  }
  const name = opts.name ?? new URL(opts.url).hostname;
  await ensureWorkspaceDirs(ws);
  await writeFile(ws.configPath, CONFIG_TEMPLATE(name, opts.url), 'utf8');
  const db = openDb(ws.dbPath);
  ensureApp(db, name, opts.url);

  const home = globalHome();
  await ensureGlobalHome(home);
  // Register the workspace in the global project registry.
  let projects: { name: string; path: string }[] = [];
  if (existsSync(home.projectsFile)) {
    const { readFile } = await import('node:fs/promises');
    projects = JSON.parse(await readFile(home.projectsFile, 'utf8'));
  }
  if (!projects.some((p) => p.path === ws.root)) {
    projects.push({ name, path: ws.root });
    await writeFile(home.projectsFile, JSON.stringify(projects, null, 2), 'utf8');
  }

  console.log(pc.green(`✔ Initialized workspace at ${ws.root}`));
  console.log(`  config:  ${ws.configPath}`);
  console.log(`  db:      ${ws.dbPath} (migrated)`);
  console.log(`\nNext: ${pc.bold('ta doctor')} to verify engines, then ${pc.bold('ta explore')}.`);
}
