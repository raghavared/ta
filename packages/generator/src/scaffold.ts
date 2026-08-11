import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SelectorStrategy, TaConfig, Workspace } from '@ta/core';

export interface SelectorEntry {
  key: string;
  strategy: SelectorStrategy;
  value: string;
  description: string;
  /** Original (strategy,value) at generation time — flow steps reference these. */
  original?: { strategy: SelectorStrategy; value: string };
}

/** Emit the code for one selector entry. */
function selectorExpr(strategy: SelectorStrategy, value: string): string {
  const q = (s: string) => JSON.stringify(s);
  switch (strategy) {
    case 'testid':
      return `page.getByTestId(${q(value)})`;
    case 'role': {
      const sep = value.indexOf('|');
      return `page.getByRole(${q(value.slice(0, sep))} as Parameters<Page['getByRole']>[0], { name: ${q(value.slice(sep + 1))}, exact: true })`;
    }
    case 'label':
      return `page.getByLabel(${q(value)}, { exact: true })`;
    case 'placeholder':
      return `page.getByPlaceholder(${q(value)}, { exact: true })`;
    case 'text':
      return `page.getByText(${q(value)}, { exact: true })`;
    case 'css':
      return `page.locator(${q(value)})`;
  }
}

/**
 * Write the self-contained generated test project: package.json,
 * playwright.config.ts, helpers.ts (scripted login), selectors.ts (the single
 * grounded selector map — the only file the healer ever patches).
 */
export async function scaffoldGenerated(
  ws: Workspace,
  config: TaConfig,
  selectorEntries: SelectorEntry[],
): Promise<void> {
  await mkdir(join(ws.generatedDir, 'specs'), { recursive: true });

  await writeFile(
    join(ws.generatedDir, 'package.json'),
    JSON.stringify(
      {
        name: 'ta-generated-tests',
        private: true,
        devDependencies: { '@playwright/test': '^1.50.0' },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    join(ws.generatedDir, 'playwright.config.ts'),
    `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  retries: 1,
  outputDir: process.env.TA_OUTPUT_DIR || './test-results',
  reporter: process.env.TA_JSON_REPORT
    ? [['json', { outputFile: process.env.TA_JSON_REPORT }], ['line']]
    : [['line']],
  use: {
    baseURL: ${JSON.stringify(config.baseUrl)},
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
`,
    'utf8',
  );

  const authSteps = (config.auth?.steps ?? [])
    .map((step) => {
      const value = step.value?.startsWith('$')
        ? `process.env[${JSON.stringify(step.value.slice(1))}] ?? ''`
        : JSON.stringify(step.value ?? '');
      if (step.action === 'fill') return `  await page.locator(${JSON.stringify(step.selector)}).fill(${value});`;
      if (step.action === 'click') return `  await page.locator(${JSON.stringify(step.selector)}).click();`;
      return `  await page.waitForURL(${value});`;
    })
    .join('\n');

  await writeFile(
    join(ws.generatedDir, 'helpers.ts'),
    `import type { Page } from '@playwright/test';

/** Scripted login from ta.config.ts. */
export async function login(page: Page): Promise<void> {
  await page.goto('/');
${authSteps || '  // no auth configured'}
  await page.waitForLoadState('domcontentloaded');
}
`,
    'utf8',
  );

  await writeSelectorsFile(ws, selectorEntries);
  // Sidecar: machine-readable map the self-healer reads and patches.
  await writeFile(
    join(ws.generatedDir, 'selectors.map.json'),
    JSON.stringify(
      selectorEntries.map((e) => ({ ...e, original: e.original ?? { strategy: e.strategy, value: e.value } })),
      null,
      2,
    ),
    'utf8',
  );
}

/** (Re)generate selectors.ts from entries — the healer calls this after patching. */
export async function writeSelectorsFile(ws: Workspace, entries: SelectorEntry[]): Promise<void> {
  const body = entries
    .map((e) => `  /** ${e.description} */\n  ${e.key}: (page: Page) => ${selectorExpr(e.strategy, e.value)},`)
    .join('\n');
  await writeFile(
    join(ws.generatedDir, 'selectors.ts'),
    `import type { Page } from '@playwright/test';

/**
 * Grounded selector map generated from the explored UI graph.
 * Specs must reference elements ONLY through this map — the self-healer
 * repairs selectors by patching this single file.
 */
export const sel = {
${body}
};
`,
    'utf8',
  );
}
