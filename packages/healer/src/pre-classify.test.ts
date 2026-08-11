import { describe, expect, it } from 'vitest';
import { preClassify } from './pre-classify.js';
import { fileIssue, issueFingerprint, normalizeErrorSignature } from '@ta/issues';
import { openDb, ensureApp } from '@ta/store';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('preClassify', () => {
  it('flaky (retry-pass) → timing-flake, not ambiguous', () => {
    const r = preClassify({ errorMessage: 'anything', wasFlaky: true });
    expect(r.classification).toBe('timing-flake');
    expect(r.ambiguous).toBe(false);
  });
  it('network errors → env-error', () => {
    const r = preClassify({ errorMessage: 'page.goto: net::ERR_CONNECTION_REFUSED', wasFlaky: false });
    expect(r.classification).toBe('env-error');
  });
  it('locator timeout → broken-selector', () => {
    const r = preClassify({
      errorMessage: 'Timeout 30000ms exceeded.\nwaiting for getByTestId(\'order-ship\')',
      wasFlaky: false,
    });
    expect(r.classification).toBe('broken-selector');
    expect(r.ambiguous).toBe(false);
  });
  it('assertion failure → ambiguous, needs LLM', () => {
    const r = preClassify({
      errorMessage: "expect(locator).toHaveText expected 'Shipped' received 'Packed'",
      wasFlaky: false,
    });
    expect(r.ambiguous).toBe(true);
  });
});

describe('issue fingerprint + dedup', () => {
  it('same defect different numbers → same fingerprint', () => {
    const a = issueFingerprint({
      kind: 'app-bug',
      page: 'http://x/orders/123',
      errorSignature: "expect received 'Packed' at 1754639999999",
    });
    const b = issueFingerprint({
      kind: 'app-bug',
      page: 'http://x/orders/456',
      errorSignature: "expect received 'Packed' at 1754640000001",
    });
    expect(a).toBe(b);
  });
  it('different defect → different fingerprint', () => {
    const a = issueFingerprint({ kind: 'app-bug', page: 'http://x/a', errorSignature: 'expect visible failed' });
    const b = issueFingerprint({ kind: 'app-bug', page: 'http://x/b', errorSignature: 'expect visible failed' });
    expect(a).not.toBe(b);
  });
  it('filing twice updates the same row; fixed+seen-again reopens', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'ta-iss-')), 'test.db'));
    const app = ensureApp(db, 'x', 'http://x.test');
    const input = {
      appId: app.id,
      kind: 'app-bug' as const,
      title: 'Ship does not ship',
      description: 'status stays Packed',
      page: 'http://x.test/',
      errorSignature: "expect toHaveText 'Shipped' received 'Packed'",
      reproSteps: ['Given logged in', 'When ship clicked', 'Then status Shipped'],
    };
    const first = fileIssue(db, input);
    expect(first.outcome).toBe('created');
    const second = fileIssue(db, input);
    expect(second.outcome).toBe('recurred');
    expect(second.issueId).toBe(first.issueId);
    expect(second.occurrences).toBe(2);
  });
});

describe('normalizeErrorSignature', () => {
  it('masks digits and quoted values', () => {
    const a = normalizeErrorSignature("Timeout 30000ms waiting for 'todo-item-1754'");
    const b = normalizeErrorSignature("Timeout 45000ms waiting for 'todo-item-9821'");
    expect(a).toBe(b);
  });
});
