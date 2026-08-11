import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { newId, type TaConfig, type Workspace } from '@ta/core';
import type { AgentEngine } from '@ta/agent-engine';
import {
  conformanceGaps,
  designComponents,
  designScreens,
  designSources,
  elements,
  pageStates,
  type TaDb,
} from '@ta/store';

const describeSchema = z.object({
  screenName: z.string().min(2),
  description: z.string().min(10),
  components: z
    .array(
      z.object({
        label: z.string().min(1),
        role: z.string().min(2),
      }),
    )
    .min(1),
  expectedBehaviors: z.array(z.string().min(5)).min(1),
});

const DESCRIBE_SYSTEM = `You are a UX analyst describing a product design screenshot for QA planning.
Read the image file listed under "Image inputs" and report exactly what the design shows:
- screenName: a short name for the screen (e.g. "Login", "Dashboard").
- components: every interactive or labeled element visible — its exact label text and its role
  (button, textbox, combobox, checkbox, link, dialog, heading, status...).
- expectedBehaviors: behaviors the design implies (e.g. "Ship button appears disabled until the
  order is packed", "validation error shown under the email field").
Only describe what is visible in the image. Do not invent components.`;

export interface DesignResult {
  screens: { name: string; imagePath: string; matchedStateId?: string; confidence?: number }[];
  gaps: string[];
}

export async function ingestDesign(params: {
  config: TaConfig;
  ws: Workspace;
  db: TaDb;
  appId: string;
  engine: AgentEngine;
  onProgress?: (msg: string) => void;
}): Promise<DesignResult> {
  const { config, ws, db, appId, engine } = params;
  const log = params.onProgress ?? (() => {});

  if (!engine.capabilities().vision) {
    throw new Error(
      `Engine ${engine.id} has no vision support — configure visionFallbackEngine (e.g. claude-cli).`,
    );
  }

  const dirRel = config.design.screenshotsDir ?? 'design';
  const dir = isAbsolute(dirRel) ? dirRel : join(ws.root, dirRel);
  const images = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  if (images.length === 0) throw new Error(`No design images found in ${dir}`);

  const sourceId = newId('dsrc');
  db.insert(designSources)
    .values({ id: sourceId, appId, kind: 'screenshots', ref: dir, ingestedAt: Date.now() })
    .run();

  const result: DesignResult = { screens: [], gaps: [] };

  for (const image of images) {
    const imagePath = join(dir, image);
    log(`describing design: ${image}`);
    const described = await engine.runTask<z.infer<typeof describeSchema>>({
      kind: 'design.describe',
      system: DESCRIBE_SYSTEM,
      context: { imageFile: image },
      schema: describeSchema,
      images: [{ path: imagePath }],
      budget: { timeoutMs: 5 * 60 * 1000 },
    });
    if (!described.ok || !described.data) {
      log(`  failed: ${described.error?.message}`);
      continue;
    }
    const screen = described.data;

    // Match against runtime states: component labels vs interactive element names
    // AND the full aria snapshot text (headings/status text aren't elements).
    const states = db.select().from(pageStates).all();
    let best: { stateId: string; score: number; matchedLabels: Set<string> } | undefined;
    for (const st of states) {
      const els = db.select().from(elements).where(eq(elements.stateId, st.id)).all();
      const names = new Set(els.map((e) => e.name.toLowerCase().trim()).filter(Boolean));
      const aria = st.ariaDigest.toLowerCase();
      const matched = new Set(
        screen.components
          .map((c) => c.label.toLowerCase().trim())
          .filter((l) => names.has(l) || (l.length >= 4 && aria.includes(l))),
      );
      const score = matched.size / screen.components.length;
      if (!best || score > best.score) best = { stateId: st.id, score, matchedLabels: matched };
    }
    const matched = best && best.score >= 0.3 ? best : undefined;

    const screenId = newId('dscr');
    db.insert(designScreens)
      .values({
        id: screenId,
        sourceId,
        name: screen.screenName,
        imagePath,
        matchedPageStateId: matched?.stateId ?? null,
        matchConfidence: matched?.score ?? null,
      })
      .run();
    for (const comp of screen.components) {
      db.insert(designComponents)
        .values({ id: newId('dcmp'), screenId, label: comp.label, role: comp.role })
        .run();
      // Conformance: designed component missing from the matched runtime state.
      if (matched && !matched.matchedLabels.has(comp.label.toLowerCase().trim())) {
        const detail = `Design "${screen.screenName}" shows ${comp.role} "${comp.label}" but it was not found on the matched runtime state`;
        db.insert(conformanceGaps)
          .values({ id: newId('gap'), appId, kind: 'designed-missing', detail })
          .run();
        result.gaps.push(detail);
      }
    }
    result.screens.push({
      name: screen.screenName,
      imagePath,
      ...(matched ? { matchedStateId: matched.stateId, confidence: matched.score } : {}),
    });
    log(
      `  "${screen.screenName}": ${screen.components.length} components, ` +
        (matched ? `matched state ${matched.stateId} (${Math.round(matched.score * 100)}%)` : 'no runtime match'),
    );
  }
  return result;
}
