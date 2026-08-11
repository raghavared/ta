import { createHash } from 'node:crypto';

/** Template dynamic URL segments so /users/123 and /users/456 share a page. */
export function normalizeUrlKey(rawUrl: string): { urlKey: string; urlPattern: string } {
  const url = new URL(rawUrl);
  const segments = url.pathname.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid';
    if (/^[0-9a-z]{20,}$/i.test(seg) && /\d/.test(seg)) return ':token';
    return seg;
  });
  const pattern = segments.join('/') || '/';
  // Hash-router aware: keep the templated hash path, drop query values.
  const hashPath = url.hash.startsWith('#/') ? url.hash : '';
  const urlPattern = `${url.origin}${pattern}${hashPath}`;
  return { urlKey: urlPattern, urlPattern };
}

const VOLATILE_PATTERNS: [RegExp, string][] = [
  // ISO dates/times
  [/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, '<date>'],
  [/\d{1,2}[:.]\d{2}(\s?[AP]M)?/gi, '<time>'],
  // uuids
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
  // currency / large counters
  [/[$€£₹]\s?[\d,.]+/g, '<amount>'],
  // long digit runs (timestamps, ids)
  [/\d{5,}/g, '<num>'],
];

/**
 * Normalize an aria snapshot (Playwright YAML) so volatile content doesn't
 * produce spurious new states.
 */
export function normalizeAria(aria: string): string {
  let out = aria;
  for (const [re, repl] of VOLATILE_PATTERNS) out = out.replace(re, repl);
  // Collapse runs of identical list items (feeds/tables).
  const lines = out.split('\n');
  const collapsed: string[] = [];
  let prev = '';
  let repeat = 0;
  for (const line of lines) {
    if (line === prev) {
      repeat++;
      continue;
    }
    if (repeat > 0) collapsed.push(`${prev} …×${repeat + 1}`);
    else if (prev) collapsed.push(prev);
    prev = line;
    repeat = 0;
  }
  if (repeat > 0) collapsed.push(`${prev} …×${repeat + 1}`);
  else if (prev) collapsed.push(prev);
  return collapsed.join('\n').trim();
}

export function stateHash(urlKey: string, normalizedAria: string): string {
  return createHash('sha256').update(`${urlKey}\n${normalizedAria}`).digest('hex');
}

/** 64-bit simhash over whitespace tokens, for near-duplicate state merging. */
export function simhash64(text: string): bigint {
  const weights = new Array<number>(64).fill(0);
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const h = fnv1a64(token);
    for (let bit = 0; bit < 64; bit++) {
      weights[bit]! += (h >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit]! > 0) result |= 1n << BigInt(bit);
  }
  return result;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}
