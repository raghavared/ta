import { useCallback, useEffect, useState } from 'react';
import { GraphView } from './GraphView';

type Tab = 'overview' | 'graph' | 'review' | 'runs' | 'issues' | 'requirements';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'graph', label: 'UI Graph' },
  { id: 'review', label: 'Review Queue' },
  { id: 'runs', label: 'Runs' },
  { id: 'issues', label: 'Issues' },
  { id: 'requirements', label: 'Requirements' },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api<Record<string, unknown>>('/api/overview').then(setOverview).catch(() => setOverview(null));
  }, [tab]);

  const appInfo = overview?.app as { name?: string; baseUrl?: string } | undefined;
  return (
    <div className="app">
      <header>
        <h1>TA</h1>
        <span className="sub">
          {appInfo?.name ?? '…'} · {appInfo?.baseUrl ?? ''}
        </span>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'overview' && <Overview data={overview} />}
        {tab === 'graph' && <GraphView />}
        {tab === 'review' && <ReviewQueue />}
        {tab === 'runs' && <Runs />}
        {tab === 'issues' && <Issues />}
        {tab === 'requirements' && <Requirements />}
      </main>
    </div>
  );
}

function Overview({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <div className="empty">Loading…</div>;
  const drafts = data.drafts as { total: number; pending: number; approved: number };
  const issues = data.issues as { total: number; open: number };
  const latest = data.latestRun as { id: string; summary: { passed?: number; failed?: number } } | null;
  return (
    <div>
      <div className="cards">
        <div className="card"><div className="num">{String(data.states)}</div><div className="label">UI states</div></div>
        <div className="card"><div className="num">{String(data.transitions)}</div><div className="label">transitions</div></div>
        <div className="card"><div className="num">{String(data.destructiveBlocked)}</div><div className="label">destructive blocked</div></div>
        <div className="card"><div className="num">{drafts.approved}/{drafts.total}</div><div className="label">test cases approved</div></div>
        <div className="card"><div className="num">{drafts.pending}</div><div className="label">awaiting review</div></div>
        <div className="card"><div className="num">{issues.open}</div><div className="label">open issues</div></div>
        <div className="card"><div className="num">{String(data.requirements)}</div><div className="label">requirements</div></div>
      </div>
      {latest && (
        <p className="sub">
          Latest run <code>{latest.id}</code>: {latest.summary.passed ?? 0} passed, {latest.summary.failed ?? 0} failed
        </p>
      )}
    </div>
  );
}

interface Draft {
  id: string;
  title: string;
  status: string;
  priority: string;
  tags: string[];
  preconditions?: string;
  steps: { keyword: string; text: string }[];
  expectedResults: string;
  requirementIds: string[];
}

function ReviewQueue() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const load = useCallback(() => {
    api<Draft[]>('/api/drafts').then(setDrafts).catch(() => setDrafts([]));
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, status: string) => {
    await api(`/api/drafts/${id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const pending = drafts.filter((d) => d.status === 'pending_review' || d.status === 'needs_changes');
  const decided = drafts.filter((d) => !pending.includes(d));
  if (drafts.length === 0) return <div className="empty">No test case drafts yet — run `ta plan`.</div>;
  return (
    <div>
      {pending.length === 0 && <p className="sub">Nothing awaiting review.</p>}
      {[...pending, ...decided].map((d) => (
        <div className="draft" key={d.id}>
          <h3>{d.title}</h3>
          <div className="meta">
            <span className={`badge ${d.status}`}>{d.status}</span>
            <span className={`badge ${d.priority}`}>{d.priority}</span>
            {d.tags.map((t) => (
              <span key={t} className="badge">{t}</span>
            ))}
            {d.requirementIds.map((r) => (
              <span key={r} className="badge must">{r}</span>
            ))}
          </div>
          {d.preconditions && <div className="expected">Preconditions: {d.preconditions}</div>}
          <ul>
            {d.steps.map((s, i) => (
              <li key={i}>
                <b>{s.keyword}</b> {s.text}
              </li>
            ))}
          </ul>
          <div className="expected">
            <b>Expected:</b> {d.expectedResults}
          </div>
          {(d.status === 'pending_review' || d.status === 'needs_changes') && (
            <div className="actions">
              <button className="approve" onClick={() => act(d.id, 'approved')}>Approve</button>
              <button className="reject" onClick={() => act(d.id, 'rejected')}>Reject</button>
              <button onClick={() => act(d.id, 'needs_changes')}>Needs changes</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Runs() {
  const [runs, setRuns] = useState<{ id: string; startedAt: number; summary: Record<string, number> }[]>([]);
  const [results, setResults] = useState<Record<string, { title: string; status: string; durationMs: number; tracePath?: string; errorMessage?: string }[]>>({});
  useEffect(() => {
    api<typeof runs>('/api/runs').then(setRuns).catch(() => setRuns([]));
  }, []);
  const expand = async (id: string) => {
    if (results[id]) return;
    const r = await api<(typeof results)[string]>(`/api/runs/${id}/results`);
    setResults((prev) => ({ ...prev, [id]: r }));
  };
  if (runs.length === 0) return <div className="empty">No runs yet — run `ta run`.</div>;
  return (
    <table>
      <thead>
        <tr><th>Run</th><th>Started</th><th>Summary</th><th>Results</th></tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} onClick={() => expand(r.id)} style={{ cursor: 'pointer' }}>
            <td><code>{r.id.slice(0, 18)}…</code></td>
            <td>{new Date(r.startedAt).toLocaleString()}</td>
            <td>
              <span className="badge passed">{r.summary.passed ?? 0} ✓</span>{' '}
              <span className="badge failed">{r.summary.failed ?? 0} ✗</span>{' '}
              <span className="badge flaky">{r.summary.flaky ?? 0} ~</span>
            </td>
            <td>
              {results[r.id]?.map((res, i) => (
                <div key={i}>
                  <span className={`badge ${res.status}`}>{res.status}</span> {res.title}
                  {res.errorMessage && <div className="gap">{res.errorMessage.split('\n')[0]}</div>}
                  {res.tracePath && <div><code>npx playwright show-trace "{res.tracePath}"</code></div>}
                </div>
              )) ?? <span className="sub">click to load</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Issues() {
  const [issues, setIssues] = useState<{ id: string; status: string; severity: string; kind: string; title: string; occurrences: number; reproSteps: string[]; evidence: { page?: string; tracePath?: string } }[]>([]);
  useEffect(() => {
    api<typeof issues>('/api/issues').then(setIssues).catch(() => setIssues([]));
  }, []);
  if (issues.length === 0) return <div className="empty">No issues on file.</div>;
  return (
    <table>
      <thead>
        <tr><th>Status</th><th>Severity</th><th>Kind</th><th>Title</th><th>×</th><th>Repro</th></tr>
      </thead>
      <tbody>
        {issues.map((i) => (
          <tr key={i.id}>
            <td><span className={`badge ${i.status}`}>{i.status}</span></td>
            <td>{i.severity}</td>
            <td>{i.kind}</td>
            <td>{i.title}<br /><span className="sub">{i.evidence.page}</span></td>
            <td>{i.occurrences}</td>
            <td><ul>{i.reproSteps.slice(0, 4).map((s, idx) => <li key={idx}>{s}</li>)}</ul></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Requirements() {
  const [reqs, setReqs] = useState<{ id: string; reqId: string; title: string; priority: string; uiRelevant: boolean; acceptanceCriteria: string[]; coveredBy: { title: string; status: string }[] }[]>([]);
  useEffect(() => {
    api<typeof reqs>('/api/requirements').then(setReqs).catch(() => setReqs([]));
  }, []);
  if (reqs.length === 0) return <div className="empty">No requirements — configure BRD/PRD docs and run `ta requirements`.</div>;
  return (
    <table>
      <thead>
        <tr><th>Req</th><th>Priority</th><th>Acceptance criteria</th><th>Covered by</th></tr>
      </thead>
      <tbody>
        {reqs.map((r) => (
          <tr key={r.id}>
            <td><b>{r.reqId}</b><br />{r.title}{!r.uiRelevant && <div className="sub">(not UI-testable)</div>}</td>
            <td><span className={`badge ${r.priority}`}>{r.priority}</span></td>
            <td><ul>{r.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}</ul></td>
            <td>
              {r.coveredBy.length === 0 && r.uiRelevant ? (
                <span className="badge open">UNCOVERED</span>
              ) : (
                r.coveredBy.map((c, i) => (
                  <div key={i}>
                    <span className={`badge ${c.status}`}>{c.status}</span> {c.title}
                  </div>
                ))
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
