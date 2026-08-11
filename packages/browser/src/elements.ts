import { createHash } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import type { SelectorCandidate, SelectorStrategy } from '@ta/core';

export interface RawElement {
  tag: string;
  type: string;
  role: string;
  name: string;
  testId: string;
  text: string;
  placeholder: string;
  label: string;
  autocomplete: string;
  fieldName: string;
  disabled: boolean;
  formIndex: number;
  cssPath: string;
  isSubmit: boolean;
}

export interface PageElement extends RawElement {
  fingerprint: string;
  selectors: SelectorCandidate[];
}

const STRATEGY_BASE_SCORE: Record<SelectorStrategy, number> = {
  testid: 1.0,
  role: 0.9,
  label: 0.8,
  placeholder: 0.7,
  text: 0.5,
  css: 0.3,
};

/** Collect interactive elements with the metadata needed for selectors + actions. */
export async function extractElements(page: Page): Promise<PageElement[]> {
  const raw = (await page.evaluate(() => {
    const IMPLICIT_ROLES: Record<string, string> = {
      button: 'button',
      a: 'link',
      select: 'combobox',
      textarea: 'textbox',
    };
    function computeRole(el: Element): string {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.getAttribute('type') ?? 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        if (type === 'date') return 'textbox';
        return 'textbox';
      }
      return IMPLICIT_ROLES[tag] ?? tag;
    }
    function labelFor(el: Element): string {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const id = el.getAttribute('id');
      if (id) {
        const lab = document.querySelector(`label[for="${id}"]`);
        if (lab?.textContent) return lab.textContent.trim();
      }
      const wrapping = el.closest('label');
      if (wrapping) {
        const clone = wrapping.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove());
        return (clone.textContent ?? '').trim();
      }
      return '';
    }
    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.body && parts.length < 8) {
        const tag = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        const idx = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
        node = parent;
      }
      return parts.join(' > ');
    }
    const forms = Array.from(document.querySelectorAll('form'));
    const nodes = Array.from(
      document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"]',
      ),
    );
    return nodes
      .filter((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0;
      })
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        const role = computeRole(el);
        const label = labelFor(el);
        const text = (el.textContent ?? '').trim().slice(0, 120);
        const placeholder = el.getAttribute('placeholder') ?? '';
        const name = label || text || placeholder || el.getAttribute('value') || '';
        const form = el.closest('form');
        return {
          tag,
          type,
          role,
          name: name.slice(0, 120),
          testId: el.getAttribute('data-testid') ?? '',
          text,
          placeholder,
          label,
          autocomplete: el.getAttribute('autocomplete') ?? '',
          fieldName: el.getAttribute('name') ?? '',
          disabled: (el as HTMLButtonElement).disabled === true,
          formIndex: form ? forms.indexOf(form) : -1,
          cssPath: cssPath(el),
          isSubmit: tag === 'button' ? type !== 'button' && form !== null : type === 'submit',
        };
      });
  })) as RawElement[];

  const elements: PageElement[] = [];
  for (const el of raw) {
    const candidates = buildCandidates(el);
    const verified: SelectorCandidate[] = [];
    for (const cand of candidates) {
      try {
        const count = await resolveLocator(page, cand.strategy, cand.value).count();
        if (count === 1) verified.push(cand);
      } catch {
        /* invalid candidate — skip */
      }
    }
    elements.push({ ...el, fingerprint: fingerprintOf(el), selectors: verified });
  }
  return elements;
}

function buildCandidates(el: RawElement): SelectorCandidate[] {
  const out: SelectorCandidate[] = [];
  const push = (strategy: SelectorStrategy, value: string) =>
    out.push({ strategy, value, score: STRATEGY_BASE_SCORE[strategy] });
  if (el.testId && !/\d{5,}/.test(el.testId)) push('testid', el.testId);
  if (el.role && el.name) push('role', `${el.role}|${el.name}`);
  if (el.label) push('label', el.label);
  if (el.placeholder) push('placeholder', el.placeholder);
  if (el.text && el.text.length <= 60 && ['button', 'link'].includes(el.role)) push('text', el.text);
  if (el.cssPath) push('css', el.cssPath);
  return out;
}

/** Resolve a stored (strategy, value) pair into a live Playwright locator. */
export function resolveLocator(page: Page, strategy: SelectorStrategy, value: string): Locator {
  switch (strategy) {
    case 'testid':
      return page.getByTestId(value);
    case 'role': {
      const sep = value.indexOf('|');
      const role = value.slice(0, sep) as Parameters<Page['getByRole']>[0];
      const name = value.slice(sep + 1);
      return page.getByRole(role, { name, exact: true });
    }
    case 'label':
      return page.getByLabel(value, { exact: true });
    case 'placeholder':
      return page.getByPlaceholder(value, { exact: true });
    case 'text':
      return page.getByText(value, { exact: true });
    case 'css':
      return page.locator(value);
  }
}

/** Stable element identity across states: role+name+testid+text (digits masked). */
export function fingerprintOf(el: Pick<RawElement, 'role' | 'name' | 'testId' | 'text'>): string {
  const mask = (s: string) => s.replace(/\d{5,}/g, '<num>');
  return createHash('sha256')
    .update(`${el.role}|${mask(el.name)}|${mask(el.testId)}|${mask(el.text)}`)
    .digest('hex')
    .slice(0, 16);
}

/** Best available selector for driving an element right now. */
export function bestSelector(el: PageElement): SelectorCandidate | undefined {
  return [...el.selectors].sort((a, b) => b.score - a.score)[0];
}
