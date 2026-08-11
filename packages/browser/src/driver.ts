import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { isAllowedHost } from './action-policy.js';

export interface DriverOptions {
  baseUrl: string;
  allowedHosts: string[];
  headless?: boolean;
}

/** Playwright wrapper with the safety rails always on. */
export class BrowserDriver {
  private constructor(
    private browser: Browser,
    private context: BrowserContext,
    readonly page: Page,
    private opts: DriverOptions,
  ) {}

  static async launch(opts: DriverOptions): Promise<BrowserDriver> {
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Network guard: block third-party origins entirely.
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (isAllowedHost(url, opts.baseUrl, opts.allowedHosts)) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    // Safe mode: never let a native dialog block the session or confirm anything.
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    return new BrowserDriver(browser, context, page, opts);
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await this.settle();
  }

  /** Wait for the page to quiesce after an action. */
  async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(250);
  }

  async captureAria(): Promise<string> {
    return this.page.locator('body').ariaSnapshot();
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: false }).catch(() => {});
  }

  async dispose(): Promise<void> {
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}
