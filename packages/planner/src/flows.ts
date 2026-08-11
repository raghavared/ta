import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { pageStates, type TaDb } from '@ta/store';
import type { SelectorStrategy } from '@ta/core';

export interface FlowStep {
  strategy: SelectorStrategy;
  value: string;
  action: 'click' | 'fill' | 'select';
  fillValue?: string;
}

/** A candidate flow = the recorded path to a discovered state. */
export interface CandidateFlow {
  stateId: string;
  stateHash: string;
  url: string;
  preAuth: boolean;
  steps: FlowStep[];
  /** Human-readable step descriptions for the planning prompt. */
  readableSteps: string[];
  /** Normalized aria digest of the final state (assertion source). */
  finalAria: string;
}

/**
 * Derive candidate flows from the explored graph. Each non-trivial state's
 * replay path (recorded in its snapshot file) is a flow candidate.
 */
export function deriveFlows(db: TaDb, appId: string): CandidateFlow[] {
  void appId;
  const states = db.select().from(pageStates).all();
  const flows: CandidateFlow[] = [];
  for (const st of states) {
    let snapshot: { path?: FlowStep[]; preAuth?: boolean; normalized?: string };
    try {
      snapshot = JSON.parse(readFileSync(st.snapshotPath, 'utf8'));
    } catch {
      continue;
    }
    const steps = snapshot.path ?? [];
    if (steps.length === 0) continue; // seed states aren't flows
    flows.push({
      stateId: st.id,
      stateHash: st.stateHash,
      url: st.url,
      preAuth: snapshot.preAuth ?? false,
      steps,
      readableSteps: steps.map(describeStep),
      finalAria: (snapshot.normalized ?? st.ariaDigest).slice(0, 1500),
    });
  }
  // Longest, most distinctive flows first; drop pure prefixes of longer flows.
  flows.sort((a, b) => b.steps.length - a.steps.length);
  const kept: CandidateFlow[] = [];
  for (const flow of flows) {
    const sig = JSON.stringify(flow.steps);
    const isPrefix = kept.some((k) => JSON.stringify(k.steps.slice(0, flow.steps.length)) === sig);
    if (!isPrefix) kept.push(flow);
  }
  return kept;
}

function describeStep(step: FlowStep): string {
  const target =
    step.strategy === 'role' ? step.value.replace('|', ' "') + '"' : `${step.strategy}=${step.value}`;
  switch (step.action) {
    case 'fill':
      return `fill ${target} with "${step.fillValue ?? ''}"`;
    case 'select':
      return `select option "${step.fillValue ?? ''}" in ${target}`;
    case 'click':
      return `click ${target}`;
  }
}

export function stateById(db: TaDb, stateId: string) {
  return db.select().from(pageStates).where(eq(pageStates.id, stateId)).get();
}
