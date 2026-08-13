# TA — Agentic UI Testing Platform

Point it at a web app. It **explores** the UI with Playwright, **plans** human-readable test
cases, waits for **your approval**, **generates** and **runs** Playwright specs, **self-heals**
broken selectors, files deduplicated **issues** to a sheet, and produces a standard **test
report** — learning from every failure and review along the way.

```
EXPLORE (runtime graph)   ─┐
ANALYZE source (optional)  ┼─▶ merged knowledge ─▶ PLAN TEST CASES ─▶ [HUMAN REVIEW GATE]
INGEST design (optional)   ┤  (graph + source +     (Given/When/Then,     approve / reject
INGEST BRD/PRD (optional) ─┘   design + reqs)        requirement-traced)     │ approved only
                                                                             ▼
                                                     GENERATE specs ─▶ RUN ─▶ HEAL / LEARN
                                                                              │
                                              issues.csv ◀── app-bugs   learnings + skills
Source-of-truth precedence on conflict: BRD/PRD > design > implementation
```

**Core principle:** a deterministic orchestrator drives the browser; the LLM is consulted only
at decision points (rank actions, write test cases, triage failures) and must return
schema-validated JSON. Engines are pluggable: **GitHub Copilot CLI**, **Claude Code CLI**, or a
**replay** engine for deterministic CI.

## Highlights

- **UI knowledge graph** — pages, states, elements, verified selectors, transitions. States are
  deduplicated by normalized accessibility-snapshot hash; a modal or a status change is a state,
  not a URL.
- **Safety by default** — destructive actions (`delete`, `pay`, `send`, …) are discovered and
  mapped but **never executed**; third-party hosts are network-blocked; credentials come from
  config/env and are never sent to any LLM.
- **Human-in-the-loop gate** — test cases are reviewable markdown (or dashboard buttons);
  **only approved cases become code**. Healing may fix selectors/timing, never assertions.
- **Self-healing** — when a refactor renames a selector, `ta heal` re-locates the element by its
  remembered identity (role + name from the graph), patches the single `selectors.ts` map,
  re-runs the spec, and records a learning. Specs are never edited.
- **Issue registry with existence-checking** — app bugs are fingerprinted; the same defect
  updates one row (`created → recurred → reopened`) instead of duplicating, exported to CSV.
- **Recursive learning** — triage verdicts are reused deterministically for identical failure
  signatures; reviewer rejections, healed drifts, and app quirks are injected into future
  prompts; a seeded, growable **skills library** (`~/.ta/skills/`) supplies testing playbooks.
- **Sources of truth** — optional BRD/PRD docs become structured requirements with a
  **Requirements Traceability Matrix** (uncovered must-haves are flagged); optional design
  screenshots are vision-analyzed and diffed against reality (conformance gaps); optional source
  code grounds selectors via static analysis.

## Requirements

- Node.js ≥ 22, pnpm ≥ 9
- Playwright Chromium (`npx playwright install chromium`)
- At least one engine:
  - **Claude Code CLI** — `npm i -g @anthropic-ai/claude-code` (also used for vision tasks)
  - **GitHub Copilot CLI** — `npm i -g @github/copilot`, then run `copilot` once to sign in

## Install

```bash
git clone https://github.com/raghavared/ta.git
cd ta
pnpm install
pnpm build
npx playwright install chromium
cd apps/cli && pnpm link --global   # makes the `ta` command available everywhere
ta doctor                            # verify environment + engines
```

## Quick start

> ⚠️ Always target a **disposable/test environment**, never production data.

```bash
cd ~/your-project                    # anywhere; state lives in a self-contained .ta/ folder
ta init --url http://localhost:3000
```

Edit `.ta/ta.config.ts`:

```ts
import { defineConfig } from '@ta/core';

export default defineConfig({
  name: 'my-app',
  baseUrl: 'http://localhost:3000',
  engine: 'claude-cli',                     // 'copilot-cli' | 'claude-cli' | 'replay'
  visionFallbackEngine: 'claude-cli',       // used for design screenshots if engine lacks vision
  // sourceRoot: '../src',                  // optional: app source → selector grounding + gaps
  // requirements: ['prd.md'],              // optional: BRD/PRD markdown in .ta/
  // design: { screenshotsDir: 'design' },  // optional: design PNGs in .ta/design/
  auth: {                                   // only if the app has a login
    steps: [
      { action: 'fill', selector: '#email',    value: '$TA_LOGIN_EMAIL' },  // $VAR = env var
      { action: 'fill', selector: '#password', value: '$TA_LOGIN_PASSWORD' },
      { action: 'click', selector: 'button[type=submit]' },
    ],
  },
});
```

Run the pipeline:

```bash
ta explore                # crawl the UI → knowledge graph (safe mode)
ta analyze                # optional: static-analyze source, ground selectors
ta requirements           # optional: PRD → structured requirements (drives RTM)
ta design                 # optional: design screenshots → expectations + conformance
ta plan                   # LLM drafts test cases → .ta/testcases/*.md
```

**Review** (the human gate): open `.ta/testcases/*.md`, read each case, set
`status: approved` (or `rejected` / `needs_changes`) in the frontmatter — or use the dashboard's
Review Queue buttons. Then:

```bash
ta plan --sync            # import your decisions
ta generate               # Playwright specs — approved cases ONLY
ta run                    # execute; traces on, videos on failure
ta heal                   # self-heal broken selectors after app refactors
ta triage                 # classify failures; app-bugs → issue registry
ta issues --sync          # export the issue sheet (.ta/issues.csv)
ta report                 # standard test summary report (md + HTML) with RTM
```

## Dashboard

```bash
ta serve                  # → http://127.0.0.1:4700
```

Views: **Overview** (stats), **UI Graph** (click states → screenshot + elements + selectors;
destructive edges dashed red), **Review Queue** (approve/reject — syncs with the markdown
files), **Runs** (results + trace commands), **Issues**, **Requirements** (RTM with uncovered
must-haves flagged).

The dashboard currently *reviews and monitors*; pipeline jobs are started from the CLI.
Browser-triggered jobs (Explore/Run buttons with live progress) are on the roadmap.

## Try it on the built-in demo app

```bash
cd fixtures/demo-app-testids && pnpm preview   # serves on :4173
# in another terminal:
mkdir /tmp/ta-demo && cd /tmp/ta-demo
ta init --url http://localhost:4173
# add auth steps: demo@example.com / demo123 (see fixture source)
ta explore && ta plan
```

The fixture includes a status-gated Ship button, a modal, dynamic todos — and a booby-trapped
**"Delete account"** button that the explorer must never click (it never does; that's part of
the platform's own test suite).

## Architecture

```
                               ┌─────────────────────────────────────────────┐
                               │                INTERFACES                   │
                               │   CLI (`ta`)              Web Dashboard     │
                               │   explore/plan/run…       graph • review •  │
                               │                           runs • issues •RTM│
                               └───────────┬───────────────────┬─────────────┘
                                           │ runs handlers     │ HTTP
                                           ▼                   ▼
                               ┌─────────────────────────────────────────────┐
                               │        API SERVER (Fastify)                 │
                               │  REST • artifacts/traces • review actions   │
                               └───────────────────┬─────────────────────────┘
                                                   ▼
      ┌─────────────────────────────────────────────────────────────────────────┐
      │              ORCHESTRATION CORE (deterministic TypeScript)              │
      │                                                                         │
      │   EXPLORER ──▶ PLANNER ──▶ [HUMAN GATE] ──▶ GENERATOR ──▶ RUNNER ─┐     │
      │      ▲                                                            │     │
      │      │              ┌── HEALER / TRIAGE ◀───────────────────────┘─┘     │
      │      │              │        │                                          │
      │      ▼              ▼        ▼                                          │
      │   ┌──────────────────────────────────────────────────────────────┐      │
      │   │  UI KNOWLEDGE GRAPH + MEMORY (SQLite per project + files)    │◀──┐  │
      │   │  pages • states • elements • selectors • transitions •       │   │  │
      │   │  drafts • runs • failures • issues • learnings • RTM         │   │  │
      │   └──────────────────────────────────────────────────────────────┘   │  │
      │                                                          feedback loop┘  │
      └───────┬───────────────────────────────────────┬─────────────────────────┘
              ▼                                       ▼
   ┌────────────────────────┐          ┌──────────────────────────────────┐
   │  BROWSER LAYER         │          │  AGENT ENGINE (pluggable LLM)    │
   │  Playwright driver     │          │  AgentEngine interface           │
   │  aria-snapshot hashing │          │  ├─ Copilot CLI (file protocol)  │
   │  selector generation   │          │  ├─ Claude CLI (vision, resume)  │
   │  action policy (safety)│          │  └─ Replay (recorded, for CI)    │
   │  form synthesis        │          │  schema-validated JSON + repair  │
   └───────────┬────────────┘          └──────────────────────────────────┘
               ▼                        ┌──────────────────────────────────┐
   ┌────────────────────────┐          │  OPTIONAL SOURCES OF TRUTH       │
   │  TARGET WEB APP (URL)  │          │  source code • design imgs • PRD │
   └────────────────────────┘          └──────────────────────────────────┘
```

Dependency direction: `core ← store ← (browser, memory, skills) ← (explorer, planner,
generator, runner, healer, analyzer, design, requirements, issues, report) ← (cli, server)`.
`agent-engine` depends only on `core`, so engines stay swappable.

## Working model

**1. Deterministic orchestrator, LLM at decision points.** Our TypeScript code drives
Playwright, computes hashes, enforces safety, and persists state. The LLM is called only for
judgment tasks — each call is a typed task (`plan.testcases`, `generate.spec`, `heal.triage`,
`design.describe`, `requirements.extract`, …) with structured context in and **zod-validated
JSON out** (one automatic repair round on schema failure). This is why Copilot CLI (no JSON
mode, no session resume) works: the orchestrator is the memory; every call is self-contained.

**2. The explore loop.** Frontier crawl under budgets (`maxStates`/`maxActions`/wall-clock):
capture `ariaSnapshot()` → normalize (mask timestamps/ids, collapse repeated rows, template
URLs like `/users/123 → /users/:id`) → `sha256` state hash → dedupe (plus simhash near-dup
merge that *never* merges states whose enabled controls differ — that's what a status-gated
button looks like). Each new state persists its elements with uniqueness-verified selector
candidates (`data-testid → role+name → label → placeholder → text → css`, scored). SPA states
with no unique URL are reached by **path replay** from the seed. Destructive actions are
recorded as graph edges with `executed=false` — mapped, never clicked.

**3. Plan → human gate → generate.** Flows (maximal replay paths) + requirements + design
expectations + learnings + matched skills go into `plan.testcases`, which returns
Given/When/Then drafts with `requirementIds`. Drafts are markdown files with a `status`
frontmatter (state machine: `draft → pending_review → approved | rejected | needs_changes`);
the dashboard's buttons edit the same state. **Codegen refuses anything unapproved.** Specs
reference elements only through the generated `sel.*` map — a grounding check rejects any spec
using raw selectors or unknown keys.

**4. Run → triage → heal.** Runs execute with `trace: on`, `retries: 1` (retry-pass ⇒ flaky).
Failures hit a deterministic pre-classifier (locator timeout ⇒ broken-selector; net errors ⇒
env-error; retry-pass ⇒ timing-flake); only ambiguous assertion failures go to LLM triage —
and an identical failure signature **reuses its prior verdict** instead of re-asking the model.
`app-bug` never modifies the test: it files a fingerprinted issue (same defect ⇒ same row,
`occurrences++`, `reopened` on regression) exported to the sheet. `broken-selector` triggers
self-healing: replay the flow, re-locate the missing element by its identity remembered in the
graph (role + name + old testid, fuzzy-matched), patch **only** `selectors.ts`, re-run the one
spec, record the outcome and a learning.

**5. Memory tiers (all platform-owned — nothing relies on LLM session state).**

| Tier | Where | What | Lifecycle |
|---|---|---|---|
| UI knowledge graph | project DB | structural memory of the app | grows every explore |
| Learnings | project DB | app-specific facts (quirks, timing, selector drift, reviewer taste) | dedup on write, confidence reinforcement, decay when unused |
| Skills | `~/.ta/skills/` (+ project overrides) | transferable testing playbooks | trigger-matched into prompts; user-editable; cross-project |
| Episodic record | `.ta/agent-io/` | every LLM call's prompt + result | audit, replay fixtures, debugging |

**6. Storage model.** One self-contained `.ta/` workspace per target project (SQLite DB +
snapshots + artifacts + testcases + generated specs) — delete the folder, the project is
forgotten. Cross-project state lives only in `~/.ta/` (skills, engine homes, project registry).
Rule of thumb: DB = anything queried/scored; files = anything big (traces) or human-edited
(test cases, skills). Recommended VCS policy: commit `ta.config.ts`, `testcases/*.md`,
`generated/**`; ignore `ta.db`, `snapshots/`, `artifacts/`, `agent-io/`.

**7. Evidence & reporting.** Every test: full Playwright trace, video on failure, screenshots.
Every failure: expected-vs-actual snapshot context, network tail, environment metadata. Every
issue: repro steps from the approved case + trace link, pinned against pruning while open.
`ta report` renders a deterministic IEEE-829-style summary — executive verdict, scope, every
case including approved-but-not-executed, coverage, the RTM with uncovered must-haves, issues,
and quality trends.

## How each piece works

| Package | Responsibility |
|---|---|
| `@ta/core` | Config schema, domain types, workspace/global-home layout |
| `@ta/store` | SQLite (drizzle) — graph, drafts, runs, failures, issues, learnings, RTM |
| `@ta/browser` | Playwright driver, aria-snapshot normalize/hash, simhash near-dup merge, selector candidates, destructive-action policy, seeded form synthesis |
| `@ta/explorer` | Budgeted frontier crawl with SPA path replay (state = snapshot hash, not URL) |
| `@ta/agent-engine` | `AgentEngine` interface + adapters: Copilot CLI (file protocol), Claude CLI (vision, structured output), replay (recorded fixtures for CI); JSON extraction + one repair round |
| `@ta/planner` | Flow derivation → `plan.testcases` → markdown drafts + review-gate state machine |
| `@ta/generator` | Grounded `sel.*` selector map (specs may not invent selectors), spec generation, `selectors.map.json` sidecar for the healer |
| `@ta/runner` | Playwright execution, rich error ingestion, traces/videos per run |
| `@ta/healer` | Deterministic pre-classifier → LLM triage (with prior-verdict reuse) → self-heal: re-locate by graph identity, patch `selectors.ts`, re-run |
| `@ta/issues` | Fingerprint-deduplicated registry (`created/recurred/reopened`), CSV sheet export |
| `@ta/requirements` | PRD/BRD markdown → structured requirements + acceptance criteria → RTM |
| `@ta/design` | Screenshot vision ingestion, design↔runtime matching, conformance gaps |
| `@ta/analyzer` | ts-morph static analysis: testids (incl. template patterns), element linking, selector score boosts, source-only coverage gaps |
| `@ta/memory` | Learnings: dedup on write, scope/confidence/recency retrieval, prompt injection |
| `@ta/skills` | Seeded testing playbooks with trigger matching, injected into prompts; extend via `~/.ta/skills/` |
| `@ta/report` | IEEE-829-style Test Summary Report (md + self-contained HTML) incl. RTM |
| `apps/cli` | The `ta` binary |
| `apps/server` | Fastify REST + artifact serving + review API |
| `apps/dashboard` | React SPA (graph, review queue, runs, issues, RTM) |

## Development

```bash
pnpm build        # build all packages (TypeScript project references)
pnpm test         # vitest unit suites (hashing, policy, dedup, classifiers, replay engine)
```

Engine-dependent steps can run LLM-free in CI via `engine: 'replay'` (recorded task→result
fixtures keyed by context hash).

## Roadmap

- Dashboard-triggered jobs (explore/run buttons, SSE progress)
- Figma REST adapter (design ingestion beyond screenshots) — needs a Figma token
- Google Sheets issue exporter with row-update sync — needs a service account
- PDF/docx requirements parsing; skill self-authoring loop; Claude MCP deep-exploration mode;
  Vue/Angular source analyzers; multi-actor tests; engine benchmarking harness

## License

MIT — see [LICENSE](LICENSE).
