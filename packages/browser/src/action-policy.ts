/** Destructive-action guard: match accessible names against the deny lexicon. */
export function isDestructive(accessibleName: string, lexicon: string[]): boolean {
  const name = accessibleName.toLowerCase();
  return lexicon.some((word) => {
    const w = word.toLowerCase();
    // Word-boundary match so "delete" hits "Delete account" but not "undeletable".
    const re = new RegExp(`(^|\\b)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i');
    return re.test(name);
  });
}

/** Hosts the explorer may contact: target origin + explicit allowlist + localhost. */
export function isAllowedHost(url: string, targetOrigin: string, allowedHosts: string[]): boolean {
  try {
    const u = new URL(url);
    const target = new URL(targetOrigin);
    if (u.host === target.host) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return allowedHosts.some((h) => u.host === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
