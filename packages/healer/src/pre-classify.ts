import type { FailureClassification } from '@ta/core';

export interface PreClassification {
  classification: FailureClassification;
  confidence: number;
  /** True when the LLM should make the final call. */
  ambiguous: boolean;
  rationale: string;
}

/** Deterministic first pass — no LLM for the clear-cut cases. */
export function preClassify(params: {
  errorMessage: string;
  errorStack?: string;
  wasFlaky: boolean;
}): PreClassification {
  const { errorMessage, wasFlaky } = params;
  const msg = errorMessage.toLowerCase();

  if (wasFlaky) {
    return {
      classification: 'timing-flake',
      confidence: 0.9,
      ambiguous: false,
      rationale: 'Test passed on retry — alternating outcome is the signature of a timing flake.',
    };
  }
  if (/net::err|econnrefused|enotfound|socket hang up|502|503|504/.test(msg)) {
    return {
      classification: 'env-error',
      confidence: 0.9,
      ambiguous: false,
      rationale: 'Network/infrastructure error — the environment, not the app or test.',
    };
  }
  if (/timeout.*exceeded/.test(msg) && /(waiting for|locator|getby)/.test(msg)) {
    return {
      classification: 'broken-selector',
      confidence: 0.75,
      ambiguous: false,
      rationale: 'Locator wait timed out — the element the selector points at was not found.',
    };
  }
  if (/expect\(|tohavetext|tobevisible|tobeenabled|tobedisabled|tohavevalue|assertion/.test(msg)) {
    return {
      classification: 'unknown',
      confidence: 0.4,
      ambiguous: true,
      rationale: 'Assertion failed — could be a real app bug or wrong test expectations; needs triage.',
    };
  }
  return {
    classification: 'unknown',
    confidence: 0.2,
    ambiguous: true,
    rationale: 'No deterministic signature matched.',
  };
}
