import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { newId, type TaConfig, type Workspace } from '@ta/core';
import type { AgentEngine } from '@ta/agent-engine';
import { requirementDocs, requirements, type TaDb } from '@ta/store';

const requirementSchema = z.object({
  reqId: z.string().regex(/^[A-Z0-9-]{2,24}$/),
  title: z.string().min(3),
  description: z.string().min(10),
  acceptanceCriteria: z.array(z.string().min(5)).min(1),
  priority: z.enum(['must', 'should', 'could']),
  uiRelevant: z.boolean(),
  sourceSection: z.string(),
});
const extractResultSchema = z.object({ requirements: z.array(requirementSchema).min(1) });
export type ExtractedRequirement = z.infer<typeof requirementSchema>;

const EXTRACT_SYSTEM = `You are a business analyst converting a BRD/PRD into structured, testable requirements.
For each distinct requirement in the document:
- reqId: a stable slug like "REQ-ORDER-1" derived from the section topic (uppercase, hyphenated). Keep ids stable and unique.
- description: what the system must do, in one or two sentences.
- acceptanceCriteria: concrete, observable, testable criteria (each independently verifiable in the UI where applicable).
- priority: "must" for hard business rules, "should" for expected behaviors, "could" for nice-to-haves.
- uiRelevant: false for pure backend/API/infra requirements that cannot be observed in the UI.
- sourceSection: the heading of the section it came from.
Extract EVERY requirement — do not summarize several into one.`;

export interface RequirementsResult {
  docs: { path: string; requirementCount: number; skipped: boolean }[];
  total: number;
}

export async function ingestRequirements(params: {
  config: TaConfig;
  ws: Workspace;
  db: TaDb;
  appId: string;
  engine: AgentEngine;
  onProgress?: (msg: string) => void;
}): Promise<RequirementsResult> {
  const { config, ws, db, appId, engine } = params;
  const log = params.onProgress ?? (() => {});
  const docs: RequirementsResult['docs'] = [];
  let total = 0;

  for (const rel of config.requirements) {
    const path = isAbsolute(rel) ? rel : join(ws.root, rel);
    const content = await readFile(path, 'utf8');
    const contentHash = createHash('sha256').update(content).digest('hex');

    const existing = db.select().from(requirementDocs).where(eq(requirementDocs.path, path)).get();
    if (existing && existing.contentHash === contentHash) {
      const count = db.select().from(requirements).where(eq(requirements.docId, existing.id)).all().length;
      docs.push({ path, requirementCount: count, skipped: true });
      total += count;
      log(`unchanged: ${rel} (${count} requirements)`);
      continue;
    }

    log(`extracting: ${rel}`);
    const result = await engine.runTask<z.infer<typeof extractResultSchema>>({
      kind: 'requirements.extract',
      system: EXTRACT_SYSTEM,
      context: { document: content.slice(0, 24_000), fileName: rel },
      schema: extractResultSchema,
      budget: { timeoutMs: 5 * 60 * 1000 },
    });
    if (!result.ok || !result.data) {
      throw new Error(`requirements.extract failed for ${rel}: ${result.error?.message}`);
    }

    // Doc changed: replace its requirements (drafts referencing them keep reqIds).
    let docId: string;
    if (existing) {
      docId = existing.id;
      db.delete(requirements).where(eq(requirements.docId, docId)).run();
      db.update(requirementDocs)
        .set({ contentHash, parsedAt: Date.now() })
        .where(eq(requirementDocs.id, docId))
        .run();
    } else {
      docId = newId('rdoc');
      db.insert(requirementDocs).values({ id: docId, appId, path, contentHash, parsedAt: Date.now() }).run();
    }
    for (const req of result.data.requirements) {
      db.insert(requirements)
        .values({
          id: newId('req'),
          docId,
          reqId: req.reqId,
          title: req.title,
          description: req.description,
          acceptanceCriteriaJson: JSON.stringify(req.acceptanceCriteria),
          priority: req.priority,
          uiRelevant: req.uiRelevant,
          sourceSection: req.sourceSection,
        })
        .run();
    }
    docs.push({ path, requirementCount: result.data.requirements.length, skipped: false });
    total += result.data.requirements.length;
    log(`  ${result.data.requirements.length} requirements extracted`);
  }
  return { docs, total };
}
