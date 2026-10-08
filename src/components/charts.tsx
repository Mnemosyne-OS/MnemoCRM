/**
 * The three chart forms MnemoCRM needs, drawn in plain SVG (no chart library:
 * a dependency for three shapes is not worth a lockfile change).
 *
 * Mark specs (dataviz method): one series per chart, so no legend box — the
 * title names it; 2 px lines with a 10 % area wash; bars at most 24 px thick
 * with a 4 px rounded data-end and a square baseline; 1 px solid recessive
 * gridlines; values in TEXT tokens, never in the series colour; a crosshair +
 * tooltip on the line, a tooltip per bar; and every chart has a table view.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { niceCeiling } from '../model/analytics';

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    // jsdom and some embedded views have no ResizeObserver: one measure is still a real one.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface AreaPoint {
  key: string;
  value: number;
  /** Lines shown in the tooltip for this point. */
  tip: string[];
  /** Short x label for this point. */
  label: string;
}

export function AreaChart({ points, format, height = 220, ariaLabel }: { points: AreaPoint[]; format: (v: number) => string; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 64;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const w = Math.max(width, 200);
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const top = niceCeiling(Math.max(...points.map((p) => p.value), 0));
  const x = (i: number) => padL + (points.length <= 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => padT + innerH - (v / top) * innerH;
  const ticks = [0, top / 2, top];
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = points.length > 1 ? `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
  // About six x labels, whatever the number of points. The last point is
  // labelled only if it sits far enough from the previous label to not touch it.
  const every = Math.max(1, Math.ceil(points.length / 6));
  const lastMultiple = Math.floor((points.length - 1) / every) * every;
  const labelled = new Set<number>();
  for (let i = 0; i < points.length; i += every) labelled.add(i);
  if (points.length - 1 - lastMultiple >= every * 0.6) labelled.add(points.length - 1);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    if (points.length === 0) return;
    const i = points.length <= 1 ? 0 : Math.round(((px - padL) / innerW) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="crm-chart" ref={ref}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="crm-grid" />
            <text x={padL - 8} y={y(t)} className="crm-axis" textAnchor="end" dominantBaseline="middle">{format(t)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          labelled.has(i) ? (
            <text key={p.key} x={x(i)} y={height - 8} className="crm-axis" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {p.label}
            </text>
          ) : null,
        )}
        {area && <path d={area} className="crm-area" />}
        {points.length > 1 && <path d={line} className="crm-line" />}
        {points.length === 1 && <circle cx={x(0)} cy={y(points[0].value)} r={4} className="crm-dot" />}
        {hp && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} className="crm-crosshair" />
            <circle cx={x(hover)} cy={y(hp.value)} r={5} className="crm-dot" />
          </g>
        )}
      </svg>
      {hp && hover !== null && (
        <div
          className="crm-tooltip"
          style={{ left: `${(x(hover) / w) * 100}%`, transform: `translateX(${x(hover) > w * 0.7 ? '-105%' : '8px'})` }}
          role="status"
        >
          {hp.tip.map((line, i) => (
            <div key={i} className={i === 0 ? 'crm-tooltip-head' : undefined}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarRow {
  id: string;
  label: ReactNode;
  value: number;
  /** Shown at the bar tip. */
  display: string;
  /** Tooltip lines. */
  tip?: string[];
}

export function HBars({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="crm-hbars" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pct = max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0;
        return (
          <li key={r.id} className="crm-hbar" onPointerEnter={() => setHover(r.id)} onPointerLeave={() => setHover((h) => (h === r.id ? null : h))}>
            <span className="crm-hbar-label">{r.label}</span>
            {/* The bar's percentage is of its OWN area; the value sits beside it, so a long
                label can never cap the longest bars (they used to saturate at the same length). */}
            <span className="crm-hbar-track">
              <span className="crm-hbar-area">
                {r.value > 0 && <span className={`crm-hbar-fill${hover === r.id ? ' crm-hbar-fill-hover' : ''}`} style={{ width: `${pct}%` }} />}
              </span>
              <span className="crm-hbar-value">{r.display}</span>
            </span>
            {hover === r.id && r.tip && (
              <span className="crm-tooltip crm-tooltip-bar" role="status">
                {r.tip.map((line, i) => (
                  <div key={i} className={i === 0 ? 'crm-tooltip-head' : undefined}>{line}</div>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sparkline({ values, width = 160, height = 40 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0) || 1;
  const x = (i: number) => (i * (width - 8)) / (values.length - 1) + 4;
  const y = (v: number) => height - 4 - (v / max) * (height - 8);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="crm-spark">
      <path d={d} className="crm-line crm-line-muted" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} className="crm-dot" />
    </svg>
  );
}

/** Every chart's numbers, as a table: identity never rides on colour or shape alone. */
export function DataTable({ summary, head, rows }: { summary: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="crm-datatable">
      <summary>{summary}</summary>
      <table>
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
