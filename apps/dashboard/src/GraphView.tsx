import cytoscape from 'cytoscape';
import { useEffect, useRef, useState } from 'react';

interface GraphData {
  nodes: { id: string; label: string; url: string; screenshot: string | null; visitCount: number }[];
  edges: { id: string; source: string; target: string | null; action: string; element: string; destructive: boolean; executed: boolean }[];
}

interface StateDetail {
  id: string;
  url: string;
  screenshot: string;
  elements: { role: string; name: string; testId: string | null; selectors: { strategy: string; value: string; score: number }[] }[];
}

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<StateDetail | null>(null);

  useEffect(() => {
    let cy: cytoscape.Core | undefined;
    fetch('/api/graph')
      .then((r) => r.json())
      .then((data: GraphData) => {
        if (!containerRef.current) return;
        cy = cytoscape({
          container: containerRef.current,
          elements: [
            ...data.nodes.map((n) => ({ data: { id: n.id, label: n.label } })),
            ...data.edges
              .filter((e) => e.target)
              .map((e) => ({
                data: {
                  id: e.id,
                  source: e.source,
                  target: e.target!,
                  label: e.element ? `${e.action}: ${e.element.slice(0, 22)}` : e.action,
                  destructive: e.destructive ? 1 : 0,
                },
              })),
          ],
          style: [
            {
              selector: 'node',
              style: {
                label: 'data(label)',
                'background-color': '#2f81f7',
                color: '#e6edf3',
                'font-size': '9px',
                'text-valign': 'bottom',
                'text-margin-y': 4,
                width: 26,
                height: 26,
              },
            },
            {
              selector: 'edge',
              style: {
                label: 'data(label)',
                'font-size': '7px',
                color: '#8b949e',
                'curve-style': 'bezier',
                'target-arrow-shape': 'triangle',
                'line-color': '#30363d',
                'target-arrow-color': '#30363d',
                width: 1.5,
              },
            },
            {
              selector: 'edge[destructive = 1]',
              style: { 'line-style': 'dashed', 'line-color': '#f85149', 'target-arrow-color': '#f85149' },
            },
          ],
          layout: { name: 'cose', animate: false, nodeRepulsion: () => 40000 },
        });
        cy.on('tap', 'node', (evt) => {
          fetch(`/api/states/${evt.target.id()}`)
            .then((r) => r.json())
            .then(setSelected)
            .catch(() => setSelected(null));
        });
      });
    return () => cy?.destroy();
  }, []);

  return (
    <div className="graph-wrap">
      <div id="cy" ref={containerRef} />
      <div className="side">
        {selected ? (
          <>
            <p className="sub">{selected.url}</p>
            <img src={selected.screenshot} alt="state screenshot" />
            <table>
              <thead>
                <tr><th>Element</th><th>Best selector</th></tr>
              </thead>
              <tbody>
                {selected.elements.map((el, i) => {
                  const best = [...el.selectors].sort((a, b) => b.score - a.score)[0];
                  return (
                    <tr key={i}>
                      <td>{el.role} “{el.name.slice(0, 28)}”</td>
                      <td>{best ? <code>{best.strategy}={best.value.slice(0, 30)}</code> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="sub">Click a state node to inspect its screenshot, elements, and selectors. Dashed red edges are destructive actions — mapped but never executed.</p>
        )}
      </div>
    </div>
  );
}
