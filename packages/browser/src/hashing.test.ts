import { describe, expect, it } from 'vitest';
import {
  hammingDistance,
  normalizeAria,
  normalizeUrlKey,
  simhash64,
  stateHash,
} from './hashing.js';
import { isDestructive } from './action-policy.js';
import { classifyField } from './form-synth.js';

describe('normalizeUrlKey', () => {
  it('templates numeric ids', () => {
    expect(normalizeUrlKey('http://x.test/users/123/orders/456').urlPattern).toBe(
      'http://x.test/users/:id/orders/:id',
    );
  });
  it('templates uuids', () => {
    expect(
      normalizeUrlKey('http://x.test/items/a1b2c3d4-e5f6-7890-abcd-ef1234567890').urlPattern,
    ).toBe('http://x.test/items/:uuid');
  });
  it('drops query values but keeps hash-router path', () => {
    expect(normalizeUrlKey('http://x.test/app?tab=2#/settings').urlPattern).toBe(
      'http://x.test/app#/settings',
    );
  });
});

describe('normalizeAria + stateHash', () => {
  it('same content twice → same hash', () => {
    const aria = '- button "Save"\n- textbox "Name"';
    expect(stateHash('u', normalizeAria(aria))).toBe(stateHash('u', normalizeAria(aria)));
  });
  it('timestamp/counter changes → same hash', () => {
    const a = normalizeAria('- text "Updated 2026-08-07 at 10:30 (id 1754550000123)"');
    const b = normalizeAria('- text "Updated 2026-08-08 at 11:45 (id 1754639999999)"');
    expect(a).toBe(b);
  });
  it('structural change → different hash', () => {
    const a = stateHash('u', normalizeAria('- button "Save"'));
    const b = stateHash('u', normalizeAria('- button "Save"\n- dialog "Confirm"'));
    expect(a).not.toBe(b);
  });
  it('collapses repeated list rows', () => {
    const rows = Array(10).fill('- listitem "Row <num>"').join('\n');
    expect(normalizeAria(rows)).toContain('…×10');
  });
});

describe('simhash near-duplicate detection', () => {
  it('similar snapshots are close, different ones are far', () => {
    const base = '- heading "Orders" - table - row "Widget A" - row "Widget B" - button "Refresh"';
    const similar = '- heading "Orders" - table - row "Widget A" - row "Widget C" - button "Refresh"';
    const different = '- heading "Login" - textbox "Email" - textbox "Password" - button "Sign in"';
    const d1 = hammingDistance(simhash64(base), simhash64(similar));
    const d2 = hammingDistance(simhash64(base), simhash64(different));
    expect(d1).toBeLessThan(d2);
  });
});

describe('isDestructive', () => {
  const lexicon = ['delete', 'pay', 'log out'];
  it('flags word-boundary matches', () => {
    expect(isDestructive('Delete account', lexicon)).toBe(true);
    expect(isDestructive('Pay now', lexicon)).toBe(true);
    expect(isDestructive('Log Out', lexicon)).toBe(true);
  });
  it('does not flag substrings inside words', () => {
    expect(isDestructive('Undeletable item', lexicon)).toBe(false);
    expect(isDestructive('Payment history', lexicon)).toBe(false);
  });
});

describe('classifyField', () => {
  it('classifies by type first', () => {
    expect(classifyField({ type: 'email' })).toBe('email');
    expect(classifyField({ type: 'date' })).toBe('date');
  });
  it('falls back to name/label/placeholder hints', () => {
    expect(classifyField({ name: 'user_email' })).toBe('email');
    expect(classifyField({ placeholder: 'Search products' })).toBe('search');
    expect(classifyField({ label: 'Full name' })).toBe('name');
  });
});
