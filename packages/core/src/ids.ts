import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Sortable unique id: millisecond timestamp base32 + 16 random chars. */
export function newId(prefix: string): string {
  const time = Date.now().toString(32).padStart(9, '0');
  const rand = Array.from(randomBytes(16), (b) => ALPHABET[b % 32]).join('');
  return `${prefix}_${time}${rand}`;
}
