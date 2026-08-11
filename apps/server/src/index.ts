import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { desc, eq } from 'drizzle-orm';
import type { DraftStatus, TaConfig, Workspace } from '@ta/core';
import {
  conformanceGaps,
  designScreens,
  elements,
  issues,
  pageStates,
  pages,
  requirementCoverage,
  requirements,
  runs,
  selectors,
  testCaseDrafts,
  testCases,
  testResults,
  transitions,
  type TaDb,
} from '@ta/store';

const VALID_STATUSES: DraftStatus[] = ['pending_review', 'approved', 'rejected', 'needs_changes'];

export async function startServer(params: {
  ws: Workspace;
  config: TaConfig;
  db: TaDb;
  appId: string;
  port?: number;
}): Promise<string> {
  const { ws, config, db, appId } = params;
  const app = Fastify({ logger: false });
  await app.register(fastifyCors, { origin: true });

  // Artifacts + snapshots (screenshots) — CORS open so trace.playwright.dev can fetch.
  await app.register(fastifyStatic, {
    root: ws.snapshotsDir,
    prefix: '/snapshots/',
    decorateReply: true,
    setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
  });
  await app.register(fastifyStatic, {
    root: ws.artifactsDir,
    prefix: '/artifacts/',
    decorateReply: false,
    setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
  });

  // Dashboard SPA (built by apps/dashboard).
  const dashboardDist = join(dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist');
  if (existsSync(dashboardDist)) {
    await app.register(fastifyStatic, { root: dashboardDist, prefix: '/', decorateReply: false });
  }

  app.get('/api/overview', async () => {
    const states = db.select().from(pageStates).all();
    const trans = db.select().from(transitions).where(eq(transitions.appId, appId)).all();
    const drafts = db.select().from(testCaseDrafts).where(eq(testCaseDrafts.appId, appId)).all();
    const allRuns = db.select().from(runs).where(eq(runs.appId, appId)).orderBy(desc(runs.startedAt)).all();
    const allIssues = db.select().from(issues).where(eq(issues.appId, appId)).all();
    const reqs = db.select().from(requirements).all();
    return {
      app: { name: config.name, baseUrl: config.baseUrl },
      states: states.length,
      transitions: trans.length,
      destructiveBlocked: trans.filter((t) => t.destructive).length,
      drafts: {
        total: drafts.length,
        pending: drafts.filter((d) => d.status === 'pending_review').length,
        approved: drafts.filter((d) => d.status === 'approved').length,
        rejected: drafts.filter((d) => d.status === 'rejected').length,
      },
      runs: allRuns.length,
      latestRun: allRuns[0] ? { id: allRuns[0].id, summary: JSON.parse(allRuns[0].summaryJson ?? '{}') } : null,
      issues: {
        total: allIssues.length,
        open: allIssues.filter((i) => i.status === 'open' || i.status === 'reopened').length,
      },
      requirements: reqs.length,
    };
  });

  app.get('/api/graph', async () => {
    const allPages = db.select().from(pages).all();
    const pageById = new Map(allPages.map((p) => [p.id, p]));
    const states = db.select().from(pageStates).all();
    const trans = db.select().from(transitions).where(eq(transitions.appId, appId)).all();
    const allElements = db.select().from(elements).all();
    const elementById = new Map(allElements.map((e) => [e.id, e]));
    return {
      nodes: states.map((s) => ({
        id: s.id,
        label: pageById.get(s.pageId)?.title || pageById.get(s.pageId)?.urlPattern || s.id,
        url: s.url,
        screenshot: s.screenshotPath ? `/snapshots/${s.stateHash}.png` : null,
        visitCount: s.visitCount,
      })),
      edges: trans.map((t) => ({
        id: t.id,
        source: t.fromStateId,
        target: t.toStateId,
        action: t.actionType,
        element: t.elementId ? (elementById.get(t.elementId)?.name ?? '') : '',
        destructive: t.destructive,
        executed: t.executed,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/states/:id', async (req, reply) => {
    const state = db.select().from(pageStates).where(eq(pageStates.id, req.params.id)).get();
    if (!state) return reply.code(404).send({ error: 'not found' });
    const els = db.select().from(elements).where(eq(elements.stateId, state.id)).all();
    return {
      ...state,
      screenshot: `/snapshots/${state.stateHash}.png`,
      elements: els.map((el) => ({
        ...el,
        selectors: db.select().from(selectors).where(eq(selectors.elementId, el.id)).all(),
      })),
    };
  });

  app.get('/api/drafts', async () => {
    return db
      .select()
      .from(testCaseDrafts)
      .where(eq(testCaseDrafts.appId, appId))
      .all()
      .map((d) => ({
        ...d,
        steps: JSON.parse(d.stepsJson),
        tags: JSON.parse(d.tagsJson),
        coverage: JSON.parse(d.coverageRefsJson),
        requirementIds: db
          .select()
          .from(requirementCoverage)
          .where(eq(requirementCoverage.testCaseDraftId, d.id))
          .all()
          .map((c) => {
            const r = db.select().from(requirements).where(eq(requirements.id, c.requirementId)).get();
            return r?.reqId ?? c.requirementId;
          }),
      }));
  });

  app.post<{ Params: { id: string }; Body: { status: DraftStatus; comment?: string } }>(
    '/api/drafts/:id/status',
    async (req, reply) => {
      const { status, comment } = req.body ?? {};
      if (!VALID_STATUSES.includes(status)) return reply.code(400).send({ error: 'invalid status' });
      const draft = db.select().from(testCaseDrafts).where(eq(testCaseDrafts.id, req.params.id)).get();
      if (!draft) return reply.code(404).send({ error: 'not found' });
      db.update(testCaseDrafts)
        .set({
          status,
          reviewedAt: Date.now(),
          reviewedBy: 'dashboard',
          ...(comment !== undefined ? { reviewerComments: comment } : {}),
        })
        .where(eq(testCaseDrafts.id, req.params.id))
        .run();
      // Keep the reviewable markdown in sync with the dashboard decision.
      const mdPath = join(ws.testcasesDir, `${draft.id}.md`);
      if (existsSync(mdPath)) {
        const md = await readFile(mdPath, 'utf8');
        await writeFile(mdPath, md.replace(/^status: .*$/m, `status: ${status}`), 'utf8');
      }
      return { ok: true, id: draft.id, status };
    },
  );

  app.get('/api/runs', async () => {
    return db
      .select()
      .from(runs)
      .where(eq(runs.appId, appId))
      .orderBy(desc(runs.startedAt))
      .all()
      .map((r) => ({ ...r, summary: JSON.parse(r.summaryJson ?? '{}') }));
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/results', async (req) => {
    const results = db.select().from(testResults).where(eq(testResults.runId, req.params.id)).all();
    return results.map((r) => {
      const tc = db.select().from(testCases).where(eq(testCases.id, r.testCaseId)).get();
      const draft = tc?.draftId
        ? db.select().from(testCaseDrafts).where(eq(testCaseDrafts.id, tc.draftId)).get()
        : undefined;
      return { ...r, title: draft?.title ?? r.testCaseId };
    });
  });

  app.get('/api/issues', async () => {
    return db
      .select()
      .from(issues)
      .where(eq(issues.appId, appId))
      .all()
      .map((i) => ({ ...i, evidence: JSON.parse(i.evidenceJson), reproSteps: JSON.parse(i.reproStepsJson) }));
  });

  app.get('/api/requirements', async () => {
    const coverage = db.select().from(requirementCoverage).all();
    const drafts = db.select().from(testCaseDrafts).where(eq(testCaseDrafts.appId, appId)).all();
    const draftById = new Map(drafts.map((d) => [d.id, d]));
    return db
      .select()
      .from(requirements)
      .all()
      .map((r) => ({
        ...r,
        acceptanceCriteria: JSON.parse(r.acceptanceCriteriaJson),
        coveredBy: coverage
          .filter((c) => c.requirementId === r.id)
          .map((c) => draftById.get(c.testCaseDraftId))
          .filter((d) => d && d.status !== 'rejected')
          .map((d) => ({ id: d!.id, title: d!.title, status: d!.status })),
      }));
  });

  app.get('/api/design', async () => {
    const screens = db.select().from(designScreens).all();
    const gaps = db.select().from(conformanceGaps).where(eq(conformanceGaps.appId, appId)).all();
    return { screens, gaps };
  });

  const port = params.port ?? 4700;
  await app.listen({ port, host: '127.0.0.1' });
  return `http://127.0.0.1:${port}`;
}
