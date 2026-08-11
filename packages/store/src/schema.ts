import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------- UI knowledge graph ----------

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  sourceRoot: text('source_root'),
  createdAt: integer('created_at').notNull(),
});

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    urlPattern: text('url_pattern').notNull(),
    title: text('title'),
    firstSeenAt: integer('first_seen_at').notNull(),
  },
  (t) => [uniqueIndex('pages_app_pattern').on(t.appId, t.urlPattern)],
);

export const pageStates = sqliteTable(
  'page_states',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id),
    stateHash: text('state_hash').notNull(),
    url: text('url').notNull(),
    ariaDigest: text('aria_digest').notNull(),
    snapshotPath: text('snapshot_path').notNull(),
    screenshotPath: text('screenshot_path'),
    discoveredVia: text('discovered_via'),
    visitCount: integer('visit_count').notNull().default(1),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [uniqueIndex('page_states_hash').on(t.stateHash), index('page_states_page').on(t.pageId)],
);

export const elements = sqliteTable(
  'elements',
  {
    id: text('id').primaryKey(),
    stateId: text('state_id')
      .notNull()
      .references(() => pageStates.id),
    fingerprint: text('fingerprint').notNull(),
    role: text('role').notNull(),
    name: text('name').notNull(),
    testId: text('test_id'),
    text: text('text'),
    tagName: text('tag_name'),
    boundsJson: text('bounds_json'),
    sourceComponentId: text('source_component_id'),
  },
  (t) => [index('elements_state').on(t.stateId), index('elements_fingerprint').on(t.fingerprint)],
);

export const selectors = sqliteTable(
  'selectors',
  {
    id: text('id').primaryKey(),
    elementId: text('element_id')
      .notNull()
      .references(() => elements.id),
    strategy: text('strategy', {
      enum: ['testid', 'role', 'label', 'placeholder', 'text', 'css'],
    }).notNull(),
    value: text('value').notNull(),
    score: real('score').notNull(),
    verifiedAt: integer('verified_at'),
    brokenCount: integer('broken_count').notNull().default(0),
    healedCount: integer('healed_count').notNull().default(0),
  },
  (t) => [index('selectors_element').on(t.elementId)],
);

export const transitions = sqliteTable(
  'transitions',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    fromStateId: text('from_state_id')
      .notNull()
      .references(() => pageStates.id),
    toStateId: text('to_state_id').references(() => pageStates.id),
    actionType: text('action_type', {
      enum: ['click', 'fill', 'select', 'submit', 'navigate', 'keypress', 'hover'],
    }).notNull(),
    elementId: text('element_id').references(() => elements.id),
    inputValueClass: text('input_value_class'),
    destructive: integer('destructive', { mode: 'boolean' }).notNull().default(false),
    executed: integer('executed', { mode: 'boolean' }).notNull().default(false),
    weight: real('weight').notNull().default(1),
  },
  (t) => [index('transitions_from').on(t.fromStateId), index('transitions_app').on(t.appId)],
);

export const sourceComponents = sqliteTable('source_components', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  filePath: text('file_path').notNull(),
  exportName: text('export_name').notNull(),
  framework: text('framework').notNull(),
  testIdsJson: text('test_ids_json').notNull().default('[]'),
  classNamesJson: text('class_names_json').notNull().default('[]'),
  routePath: text('route_path'),
  propsSummary: text('props_summary'),
});

// ---------- Design ----------

export const designSources = sqliteTable('design_sources', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  kind: text('kind', { enum: ['figma', 'screenshots'] }).notNull(),
  ref: text('ref').notNull(),
  ingestedAt: integer('ingested_at').notNull(),
});

export const designScreens = sqliteTable('design_screens', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => designSources.id),
  name: text('name').notNull(),
  imagePath: text('image_path'),
  figmaNodeId: text('figma_node_id'),
  matchedPageStateId: text('matched_page_state_id').references(() => pageStates.id),
  matchConfidence: real('match_confidence'),
});

export const designComponents = sqliteTable('design_components', {
  id: text('id').primaryKey(),
  screenId: text('screen_id')
    .notNull()
    .references(() => designScreens.id),
  label: text('label').notNull(),
  role: text('role'),
  matchedElementId: text('matched_element_id').references(() => elements.id),
});

export const designFlows = sqliteTable('design_flows', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => designSources.id),
  name: text('name').notNull(),
  screenIdsJson: text('screen_ids_json').notNull().default('[]'),
});

export const conformanceGaps = sqliteTable('conformance_gaps', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  kind: text('kind', { enum: ['designed-missing', 'undesigned', 'text-mismatch'] }).notNull(),
  detail: text('detail').notNull(),
  status: text('status', { enum: ['open', 'accepted', 'resolved'] }).notNull().default('open'),
});

// ---------- Requirements (BRD/PRD) ----------

export const requirementDocs = sqliteTable('requirement_docs', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  path: text('path').notNull(),
  contentHash: text('content_hash').notNull(),
  parsedAt: integer('parsed_at').notNull(),
});

export const requirements = sqliteTable(
  'requirements',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => requirementDocs.id),
    reqId: text('req_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    acceptanceCriteriaJson: text('acceptance_criteria_json').notNull().default('[]'),
    priority: text('priority', { enum: ['must', 'should', 'could'] }).notNull(),
    uiRelevant: integer('ui_relevant', { mode: 'boolean' }).notNull().default(true),
    linkedPageIdsJson: text('linked_page_ids_json').notNull().default('[]'),
    linkedFlowIdsJson: text('linked_flow_ids_json').notNull().default('[]'),
    sourceSection: text('source_section'),
  },
  (t) => [uniqueIndex('requirements_doc_req').on(t.docId, t.reqId)],
);

export const requirementCoverage = sqliteTable(
  'requirement_coverage',
  {
    id: text('id').primaryKey(),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => requirements.id),
    testCaseDraftId: text('test_case_draft_id').notNull(),
  },
  (t) => [uniqueIndex('req_coverage_pair').on(t.requirementId, t.testCaseDraftId)],
);

// ---------- Test planning (human gate) ----------

export const testCaseDrafts = sqliteTable(
  'test_case_drafts',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    title: text('title').notNull(),
    priority: text('priority', { enum: ['must', 'should', 'could'] }).notNull().default('should'),
    preconditions: text('preconditions'),
    stepsJson: text('steps_json').notNull(),
    expectedResults: text('expected_results').notNull(),
    coverageRefsJson: text('coverage_refs_json').notNull().default('{}'),
    tagsJson: text('tags_json').notNull().default('[]'),
    status: text('status', {
      enum: ['draft', 'pending_review', 'approved', 'rejected', 'needs_changes'],
    })
      .notNull()
      .default('draft'),
    version: integer('version').notNull().default(1),
    reviewerComments: text('reviewer_comments'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: integer('reviewed_at'),
    markdownPath: text('markdown_path'),
    contentHash: text('content_hash'),
  },
  (t) => [index('drafts_app_status').on(t.appId, t.status)],
);

// ---------- Test lifecycle ----------

export const flows = sqliteTable('flows', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  name: text('name').notNull(),
  description: text('description'),
  stateIdsJson: text('state_ids_json').notNull().default('[]'),
  transitionIdsJson: text('transition_ids_json').notNull().default('[]'),
  importanceScore: real('importance_score').notNull().default(0),
  status: text('status', { enum: ['candidate', 'generated', 'validated', 'quarantined'] })
    .notNull()
    .default('candidate'),
});

export const testCases = sqliteTable('test_cases', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  draftId: text('draft_id').references(() => testCaseDrafts.id),
  draftVersion: integer('draft_version'),
  flowId: text('flow_id').references(() => flows.id),
  specPath: text('spec_path').notNull(),
  pageObjectPathsJson: text('page_object_paths_json').notNull().default('[]'),
  generatedByTaskId: text('generated_by_task_id'),
  version: integer('version').notNull().default(1),
  status: text('status', { enum: ['active', 'quarantined', 'retired'] }).notNull().default('active'),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  trigger: text('trigger', { enum: ['cli', 'api', 'heal-rerun'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  playwrightVersion: text('playwright_version'),
  gitSha: text('git_sha'),
  summaryJson: text('summary_json'),
});

export const testResults = sqliteTable(
  'test_results',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    testCaseId: text('test_case_id')
      .notNull()
      .references(() => testCases.id),
    status: text('status', { enum: ['passed', 'failed', 'flaky', 'skipped'] }).notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    tracePath: text('trace_path'),
    videoPath: text('video_path'),
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
  },
  (t) => [index('results_run').on(t.runId)],
);

export const failures = sqliteTable('failures', {
  id: text('id').primaryKey(),
  testResultId: text('test_result_id')
    .notNull()
    .references(() => testResults.id),
  classification: text('classification', {
    enum: ['app-bug', 'broken-selector', 'timing-flake', 'bad-test-logic', 'env-error', 'unknown'],
  }).notNull(),
  confidence: real('confidence').notNull().default(0),
  evidenceJson: text('evidence_json').notNull().default('{}'),
  triagedByTaskId: text('triaged_by_task_id'),
});

export const healingAttempts = sqliteTable('healing_attempts', {
  id: text('id').primaryKey(),
  failureId: text('failure_id')
    .notNull()
    .references(() => failures.id),
  action: text('action', { enum: ['reselect', 'add-wait', 'regenerate', 'report-bug'] }).notNull(),
  diffJson: text('diff_json'),
  rerunResultId: text('rerun_result_id'),
  outcome: text('outcome', { enum: ['fixed', 'not-fixed', 'made-worse'] }),
});

// ---------- Issues ----------

export const issues = sqliteTable(
  'issues',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    fingerprint: text('fingerprint').notNull(),
    kind: text('kind', {
      enum: ['app-bug', 'conformance-gap', 'requirement-gap', 'accessibility'],
    }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    reproStepsJson: text('repro_steps_json').notNull().default('[]'),
    severity: text('severity', { enum: ['blocker', 'critical', 'major', 'minor'] })
      .notNull()
      .default('major'),
    evidenceJson: text('evidence_json').notNull().default('{}'),
    status: text('status', { enum: ['open', 'known', 'fixed', 'reopened'] })
      .notNull()
      .default('open'),
    occurrences: integer('occurrences').notNull().default(1),
    firstSeenRunId: text('first_seen_run_id'),
    lastSeenRunId: text('last_seen_run_id'),
    externalRef: text('external_ref'),
  },
  (t) => [uniqueIndex('issues_fingerprint').on(t.fingerprint), index('issues_app_status').on(t.appId, t.status)],
);

export const issueEvents = sqliteTable('issue_events', {
  id: text('id').primaryKey(),
  issueId: text('issue_id')
    .notNull()
    .references(() => issues.id),
  event: text('event', { enum: ['created', 'recurred', 'fixed', 'reopened', 'exported'] }).notNull(),
  runId: text('run_id'),
  at: integer('at').notNull(),
});

// ---------- Learning + ops ----------

export const learnings = sqliteTable(
  'learnings',
  {
    id: text('id').primaryKey(),
    appId: text('app_id').references(() => apps.id),
    scope: text('scope', { enum: ['global', 'app', 'page', 'element', 'engine'] }).notNull(),
    scopeRef: text('scope_ref'),
    kind: text('kind', {
      enum: [
        'selector-pref',
        'timing',
        'form-data',
        'auth',
        'app-quirk',
        'triage-rule',
        'codegen-style',
        'testcase-style',
      ],
    }).notNull(),
    content: text('content').notNull(),
    evidenceJson: text('evidence_json').notNull().default('{}'),
    confidence: real('confidence').notNull().default(0.5),
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
    createdByTaskId: text('created_by_task_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('learnings_scope').on(t.appId, t.scope, t.kind)],
);

export const agentTasks = sqliteTable(
  'agent_tasks',
  {
    id: text('id').primaryKey(),
    appId: text('app_id').references(() => apps.id),
    engine: text('engine').notNull(),
    taskKind: text('task_kind').notNull(),
    promptPath: text('prompt_path'),
    resultPath: text('result_path'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    durationMs: integer('duration_ms').notNull().default(0),
    status: text('status', { enum: ['ok', 'parse-error', 'timeout', 'engine-error', 'refusal'] }).notNull(),
    sessionRef: text('session_ref'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('agent_tasks_kind').on(t.taskKind)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind', {
      enum: ['explore', 'analyze', 'design', 'requirements', 'plan', 'generate', 'run', 'heal'],
    }).notNull(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    payloadJson: text('payload_json').notNull().default('{}'),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed', 'cancelled'] })
      .notNull()
      .default('queued'),
    progressJson: text('progress_json'),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    error: text('error'),
  },
  (t) => [index('jobs_status').on(t.status)],
);

export const coverageSnapshots = sqliteTable('coverage_snapshots', {
  id: text('id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  at: integer('at').notNull(),
  statesTotal: integer('states_total').notNull(),
  statesCoveredByTests: integer('states_covered_by_tests').notNull(),
  transitionsTotal: integer('transitions_total').notNull(),
  transitionsCovered: integer('transitions_covered').notNull(),
  flakyTestCount: integer('flaky_test_count').notNull(),
  avgSelectorScore: real('avg_selector_score').notNull(),
});

export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    path: text('path').notNull(),
    triggersJson: text('triggers_json').notNull().default('{}'),
    origin: text('origin', { enum: ['built-in', 'authored'] }).notNull().default('built-in'),
    appId: text('app_id'),
    confidence: real('confidence').notNull().default(0.5),
    usageCount: integer('usage_count').notNull().default(0),
    successRate: real('success_rate').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('skills_name_app').on(t.name, t.appId)],
);
