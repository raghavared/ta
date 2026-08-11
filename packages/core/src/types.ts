/** Shared domain types. DB rows live in @ta/store; these are the cross-package shapes. */

export type SelectorStrategy = 'testid' | 'role' | 'label' | 'placeholder' | 'text' | 'css';

export type ActionType = 'click' | 'fill' | 'select' | 'submit' | 'navigate' | 'keypress' | 'hover';

export type FailureClassification =
  | 'app-bug'
  | 'broken-selector'
  | 'timing-flake'
  | 'bad-test-logic'
  | 'env-error'
  | 'unknown';

export type DraftStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'needs_changes';

export type IssueKind = 'app-bug' | 'conformance-gap' | 'requirement-gap' | 'accessibility';
export type IssueStatus = 'open' | 'known' | 'fixed' | 'reopened';

export type JobKind = 'explore' | 'analyze' | 'design' | 'requirements' | 'plan' | 'generate' | 'run' | 'heal';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type LearningScope = 'global' | 'app' | 'page' | 'element' | 'engine';
export type LearningKind =
  | 'selector-pref'
  | 'timing'
  | 'form-data'
  | 'auth'
  | 'app-quirk'
  | 'triage-rule'
  | 'codegen-style'
  | 'testcase-style';

export interface SelectorCandidate {
  strategy: SelectorStrategy;
  value: string;
  score: number;
}

export interface ElementInfo {
  fingerprint: string;
  role: string;
  name: string;
  testId?: string;
  text?: string;
  tagName?: string;
  selectors: SelectorCandidate[];
}

export interface GwtStep {
  keyword: 'Given' | 'When' | 'Then' | 'And';
  text: string;
}
