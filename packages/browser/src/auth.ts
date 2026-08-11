import type { Page } from 'playwright';
import type { TaConfig } from '@ta/core';

/** Resolve $ENV_VAR references in auth step values. */
function resolveValue(value: string): string {
  if (value.startsWith('$')) {
    const env = process.env[value.slice(1)];
    if (env === undefined) throw new Error(`Auth step references unset env var ${value}`);
    return env;
  }
  return value;
}

/** Run the scripted login from ta.config.ts. Credentials never reach any LLM. */
export async function runAuthSteps(page: Page, auth: NonNullable<TaConfig['auth']>): Promise<void> {
  if (auth.loginUrl) await page.goto(auth.loginUrl, { waitUntil: 'domcontentloaded' });
  for (const step of auth.steps) {
    switch (step.action) {
      case 'fill':
        if (!step.selector || step.value === undefined) throw new Error('fill step needs selector+value');
        await page.locator(step.selector).fill(resolveValue(step.value));
        break;
      case 'click':
        if (!step.selector) throw new Error('click step needs selector');
        await page.locator(step.selector).click();
        break;
      case 'waitForURL':
        if (!step.value) throw new Error('waitForURL step needs value');
        await page.waitForURL(step.value, { timeout: 15_000 });
        break;
    }
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(300);
}
