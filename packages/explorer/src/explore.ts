import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import {
  BrowserDriver,
  FormSynth,
  bestSelector,
  classifyField,
  extractElements,
  fingerprintOf,
  hammingDistance,
  isDestructive,
  normalizeAria,
  normalizeUrlKey,
  resolveLocator,
  runAuthSteps,
  simhash64,
  stateHash,
  type PageElement,
} from '@ta/browser';
import { newId, type SelectorStrategy, type TaConfig, type Workspace } from '@ta/core';
import {
  elements as elementsTable,
  ensureApp,
  pageStates,
  pages,
  selectors as selectorsTable,
  transitions,
  type TaDb,
} from '@ta/store';

interface PathStep {
  strategy: SelectorStrategy;
  value: string;
  action: 'click' | 'fill' | 'select';
  fillValue?: string;
}

interface KnownState {
  id: string;
  hash: string;
  sim: bigint;
  url: string;
  preAuth: boolean;
  path: PathStep[];
  enabledFingerprints: Set<string>;
  elementIds: Map<string, string>; // fingerprint -> element row id
}

interface PendingAction {
  stateHash: string;
  kind: 'click' | 'select' | 'submit-form';
  element: PageElement;
  formElements?: PageElement[];
}

export interface ExploreResult {
  appId: string;
  statesDiscovered: number;
  actionsExecuted: number;
  transitionsRecorded: number;
  destructiveBlocked: number;
  durationMs: number;
}

const MAX_PATH_LEN = 10;
const PER_ACTION_CAP = 2; // max executions of the same (kind+element) across the run

export async function runExplore(params: {
  config: TaConfig;
  ws: Workspace;
  db: TaDb;
  headless?: boolean;
  onProgress?: (message: string) => void;
}): Promise<ExploreResult> {
  const { config, ws, db } = params;
  const log = params.onProgress ?? (() => {});
  const startedAt = Date.now();
  const deadline = startedAt + config.budgets.wallClockMs;
  const app = ensureApp(db, config.name, config.baseUrl, config.sourceRoot);
  const synth = new FormSynth(config.fakerSeed);

  const known = new Map<string, KnownState>();
  const queue: PendingAction[] = [];
  const actionRuns = new Map<string, number>();
  let actionsExecuted = 0;
  let transitionsRecorded = 0;
  let destructiveBlocked = 0;
  let currentHash: string | undefined;

  const driver = await BrowserDriver.launch({
    baseUrl: config.baseUrl,
    allowedHosts: config.allowedHosts,
    headless: params.headless ?? true,
  });

  const upsertPage = (urlPattern: string, title: string): string => {
    const existing = db
      .select()
      .from(pages)
      .where(and(eq(pages.appId, app.id), eq(pages.urlPattern, urlPattern)))
      .get();
    if (existing) return existing.id;
    const id = newId('page');
    db.insert(pages)
      .values({ id, appId: app.id, urlPattern, title, firstSeenAt: Date.now() })
      .run();
    return id;
  };

  /** Capture the live page; register it as a state if unseen. Returns the state. */
  const captureState = async (
    preAuth: boolean,
    path: PathStep[],
    discoveredVia: string,
  ): Promise<{ state: KnownState; isNew: boolean }> => {
    const aria = await driver.captureAria();
    const normalized = normalizeAria(aria);
    const url = driver.page.url();
    const { urlKey, urlPattern } = normalizeUrlKey(url);
    const hash = stateHash(urlKey, normalized);
    currentHash = hash;

    const exact = known.get(hash);
    if (exact) {
      db.update(pageStates)
        .set({ visitCount: sql`${pageStates.visitCount} + 1`, lastSeenAt: Date.now() })
        .where(eq(pageStates.id, exact.id))
        .run();
      return { state: exact, isNew: false };
    }

    const els = await extractElements(driver.page);
    const enabledFingerprints = new Set(els.filter((e) => !e.disabled).map((e) => e.fingerprint));
    const sim = simhash64(normalized);

    // Near-duplicate merge: same logical page, tiny text drift, identical
    // actionable surface. Never merges states whose enabled elements differ
    // (that is exactly what status-gated UI looks like).
    for (const st of known.values()) {
      if (
        st.url.split('#')[0] === url.split('#')[0] &&
        hammingDistance(st.sim, sim) <= 2 &&
        setsEqual(st.enabledFingerprints, enabledFingerprints)
      ) {
        currentHash = st.hash;
        return { state: st, isNew: false };
      }
    }

    const title = await driver.page.title();
    const pageId = upsertPage(urlPattern, title);
    const stateId = newId('state');
    const snapshotPath = join(ws.snapshotsDir, `${hash}.json`);
    const screenshotPath = join(ws.snapshotsDir, `${hash}.png`);
    await writeFile(
      snapshotPath,
      JSON.stringify({ url, aria, normalized, path, preAuth, capturedAt: Date.now() }, null, 2),
      'utf8',
    );
    await driver.screenshot(screenshotPath);

    db.insert(pageStates)
      .values({
        id: stateId,
        pageId,
        stateHash: hash,
        url,
        ariaDigest: normalized.slice(0, 2000),
        snapshotPath,
        screenshotPath,
        discoveredVia,
        visitCount: 1,
        lastSeenAt: Date.now(),
      })
      .run();

    const elementIds = new Map<string, string>();
    for (const el of els) {
      const elId = newId('el');
      elementIds.set(el.fingerprint, elId);
      db.insert(elementsTable)
        .values({
          id: elId,
          stateId,
          fingerprint: el.fingerprint,
          role: el.role,
          name: el.name,
          testId: el.testId || null,
          text: el.text || null,
          tagName: el.tag,
        })
        .run();
      for (const cand of el.selectors) {
        db.insert(selectorsTable)
          .values({
            id: newId('sel'),
            elementId: elId,
            strategy: cand.strategy,
            value: cand.value,
            score: cand.score,
            verifiedAt: Date.now(),
          })
          .run();
      }
    }

    const state: KnownState = {
      id: stateId,
      hash,
      sim,
      url,
      preAuth,
      path,
      enabledFingerprints,
      elementIds,
    };
    known.set(hash, state);
    log(`state ${known.size}: ${title || urlPattern} (${els.length} elements) via ${discoveredVia}`);

    if (known.size < config.budgets.maxStates && path.length < MAX_PATH_LEN) {
      enumerateActions(state, els);
    }
    return { state, isNew: true };
  };

  const enumerateActions = (state: KnownState, els: PageElement[]): void => {
    const forms = new Map<number, PageElement[]>();
    for (const el of els) {
      if (el.formIndex >= 0) {
        const list = forms.get(el.formIndex) ?? [];
        list.push(el);
        forms.set(el.formIndex, list);
      }
    }
    for (const el of els) {
      if (el.disabled || el.selectors.length === 0) continue;
      const destructive = isDestructive(el.name, config.denyLexicon);
      if (destructive) {
        const elementId = state.elementIds.get(el.fingerprint);
        db.insert(transitions)
          .values({
            id: newId('tr'),
            appId: app.id,
            fromStateId: state.id,
            toStateId: null,
            actionType: 'click',
            elementId: elementId ?? null,
            destructive: true,
            executed: false,
          })
          .run();
        transitionsRecorded++;
        destructiveBlocked++;
        log(`  blocked destructive action: "${el.name}"`);
        continue;
      }
      if (el.formIndex >= 0 && el.isSubmit) {
        queue.push({
          stateHash: state.hash,
          kind: 'submit-form',
          element: el,
          formElements: forms.get(el.formIndex) ?? [],
        });
      } else if (el.tag === 'select') {
        queue.push({ stateHash: state.hash, kind: 'select', element: el });
      } else if (
        ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem'].includes(el.role) &&
        !el.isSubmit
      ) {
        queue.push({ stateHash: state.hash, kind: 'click', element: el });
      }
    }
  };

  /** Reset the browser to a state by replaying its recorded path from the root. */
  const ensureAt = async (state: KnownState): Promise<boolean> => {
    if (currentHash === state.hash) return true;
    await driver.goto(config.baseUrl);
    if (!state.preAuth && config.auth) await runAuthSteps(driver.page, config.auth);
    for (const step of state.path) {
      const locator = resolveLocator(driver.page, step.strategy, step.value);
      try {
        if (step.action === 'fill') await locator.fill(step.fillValue ?? '', { timeout: 5000 });
        else if (step.action === 'select')
          await locator.selectOption(step.fillValue ?? '', { timeout: 5000 });
        else await locator.click({ timeout: 5000 });
        await driver.settle();
      } catch {
        return false;
      }
    }
    const aria = await driver.captureAria();
    const { urlKey } = normalizeUrlKey(driver.page.url());
    currentHash = stateHash(urlKey, normalizeAria(aria));
    return currentHash === state.hash;
  };

  const executeAction = async (action: PendingAction, from: KnownState): Promise<void> => {
    const steps: PathStep[] = [];
    const sel = bestSelector(action.element);
    if (!sel) return;

    if (action.kind === 'submit-form') {
      for (const field of action.formElements ?? []) {
        if (field === action.element || field.disabled) continue;
        const fieldSel = bestSelector(field);
        if (!fieldSel) continue;
        if (field.tag === 'input' && !['checkbox', 'radio', 'submit', 'button'].includes(field.type)) {
          const kind = classifyField({
            type: field.type,
            name: field.fieldName,
            placeholder: field.placeholder,
            label: field.label,
          });
          const value = synth.valueFor(kind);
          await resolveLocator(driver.page, fieldSel.strategy, fieldSel.value).fill(value, {
            timeout: 5000,
          });
          steps.push({ strategy: fieldSel.strategy, value: fieldSel.value, action: 'fill', fillValue: value });
        } else if (field.tag === 'select') {
          const locator = resolveLocator(driver.page, fieldSel.strategy, fieldSel.value);
          const option = await firstRealOption(locator);
          if (option) {
            await locator.selectOption(option, { timeout: 5000 });
            steps.push({ strategy: fieldSel.strategy, value: fieldSel.value, action: 'select', fillValue: option });
          }
        }
      }
      await resolveLocator(driver.page, sel.strategy, sel.value).click({ timeout: 5000 });
      steps.push({ strategy: sel.strategy, value: sel.value, action: 'click' });
    } else if (action.kind === 'select') {
      const locator = resolveLocator(driver.page, sel.strategy, sel.value);
      const option = await firstRealOption(locator);
      if (!option) return;
      await locator.selectOption(option, { timeout: 5000 });
      steps.push({ strategy: sel.strategy, value: sel.value, action: 'select', fillValue: option });
    } else {
      await resolveLocator(driver.page, sel.strategy, sel.value).click({ timeout: 5000 });
      steps.push({ strategy: sel.strategy, value: sel.value, action: 'click' });
    }

    await driver.settle();
    actionsExecuted++;
    const { state: to } = await captureState(
      from.preAuth,
      [...from.path, ...steps],
      `${action.kind} "${action.element.name}"`,
    );
    db.insert(transitions)
      .values({
        id: newId('tr'),
        appId: app.id,
        fromStateId: from.id,
        toStateId: to.id,
        actionType: action.kind === 'submit-form' ? 'submit' : action.kind === 'select' ? 'select' : 'click',
        elementId: from.elementIds.get(action.element.fingerprint) ?? null,
        destructive: false,
        executed: true,
      })
      .run();
    transitionsRecorded++;
  };

  try {
    // Pre-auth root (login page etc.) — captured but its actions only queue if no auth is configured.
    await driver.goto(config.baseUrl);
    if (config.auth) {
      const aria = await driver.captureAria();
      const { urlKey } = normalizeUrlKey(driver.page.url());
      const preHash = stateHash(urlKey, normalizeAria(aria));
      if (!known.has(preHash)) await captureState(true, [], 'seed (pre-auth)');
      await runAuthSteps(driver.page, config.auth);
    }
    await captureState(false, [], 'seed');

    while (queue.length > 0) {
      if (Date.now() > deadline || actionsExecuted >= config.budgets.maxActions) {
        log('budget reached — stopping');
        break;
      }
      // Prefer an action on the state we're already at; avoids replays.
      let idx = queue.findIndex((a) => a.stateHash === currentHash);
      if (idx === -1) idx = 0;
      const action = queue.splice(idx, 1)[0]!;
      const capKey = `${action.kind}:${action.element.fingerprint}`;
      if ((actionRuns.get(capKey) ?? 0) >= PER_ACTION_CAP) continue;
      const from = known.get(action.stateHash);
      if (!from) continue;
      if (!(await ensureAt(from))) continue;
      actionRuns.set(capKey, (actionRuns.get(capKey) ?? 0) + 1);
      try {
        await executeAction(action, from);
      } catch (e) {
        log(`  action failed on "${action.element.name}": ${(e as Error).message.split('\n')[0]}`);
        currentHash = undefined; // force replay next time
      }
    }
  } finally {
    await driver.dispose();
  }

  return {
    appId: app.id,
    statesDiscovered: known.size,
    actionsExecuted,
    transitionsRecorded,
    destructiveBlocked,
    durationMs: Date.now() - startedAt,
  };
}

async function firstRealOption(locator: ReturnType<typeof resolveLocator>): Promise<string | undefined> {
  try {
    return await locator.evaluate((el: HTMLSelectElement) => {
      const opt = Array.from(el.options).find((o) => o.value !== '');
      return opt?.value;
    });
  } catch {
    return undefined;
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
