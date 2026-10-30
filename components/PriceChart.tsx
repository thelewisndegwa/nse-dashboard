"use client";

import { useId, useMemo, useRef, useState } from "react";
import { axisMoney, kesExact, niceDate } from "@/lib/format";
import type { SeriesPoint } from "@/lib/types";

type Props = {
  points: SeriesPoint[];
  liveAttached: boolean;
};

export function PriceChart({ points, liveAttached }: Props) {
  const rawId = useId();
  const gradId = `fill-${rawId.replace(/:/g, "")}`;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const width = 760;
    const height = 280;
    const pad = { l: 52, r: 12, t: 16, b: 28 };
    const times = points.map((point) => Date.parse(`${point.d}T00:00:00Z`));
    const start = times[0];
    const end = times[times.length - 1] || start + 1;
    const span = Math.max(1, end - start);
    let min = Math.min(...points.map((point) => point.p));
    let max = Math.max(...points.map((point) => point.p));
    if (min === max) {
      min *= 0.97;
      max *= 1.03;
    }
    const yPad = (max - min) * 0.08;
    min -= yPad;
    max += yPad;
    const xOf = (time: number) => pad.l + ((time - start) / span) * (width - pad.l - pad.r);
    const yOf = (value: number) => pad.t + ((max - value) / (max - min)) * (height - pad.t - pad.b);
    const coords = points.map((point, index) => ({
      x: xOf(times[index]),
      y: yOf(point.p),
      point,
    }));
    const line = coords.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
    const history = liveAttached ? coords.slice(0, -1) : coords;
    const solid = history.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
    const lastHist = history[history.length - 1];
    const areaEnd = lastHist || coords[coords.length - 1];
    const base = height - pad.b;
    const area = `${solid} L${areaEnd.x.toFixed(1)},${base} L${coords[0].x.toFixed(1)},${base} Z`;
    const ticks = [0, 1, 2, 3].map((step) => {
      const value = min + ((max - min) * step) / 3;
      return { value, y: yOf(value) };
    });
    return { width, height, pad, coords, line, solid, area, ticks, base, live: liveAttached ? coords[coords.length - 1] : null, lastHist };
  }, [points, liveAttached]);

  if (!geometry) return <p className="note">Not enough sessions to draw a chart.</p>;

  function move(event: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * geometry!.width;
    let best = 0;
    let bestDist = Infinity;
    geometry!.coords.forEach((coord, index) => {
      const dist = Math.abs(coord.x - x);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    setHover(best);
  }

  const active = hover != null ? geometry.coords[hover] : null;

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label="Price from the buy date to the latest quote"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e4b15a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#e4b15a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geometry.ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={geometry.pad.l} x2={geometry.width - geometry.pad.r} y1={tick.y} y2={tick.y} stroke="var(--line)" />
            <text x={geometry.pad.l - 8} y={tick.y + 4} textAnchor="end" fill="var(--faint)" fontSize="11">
              {axisMoney(tick.value)}
            </text>
          </g>
        ))}
        <path d={geometry.area} fill={`url(#${gradId})`} />
        <path d={geometry.solid} fill="none" stroke="var(--ink)" strokeWidth="2" />
        {geometry.live && geometry.lastHist && (
          <path
            d={`M${geometry.lastHist.x},${geometry.lastHist.y} L${geometry.live.x},${geometry.live.y}`}
            fill="none"
            stroke="#e4b15a"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
        )}
        <circle cx={geometry.coords[0].x} cy={geometry.coords[0].y} r="3.5" fill="#e4b15a" />
        <circle cx={geometry.coords[geometry.coords.length - 1].x} cy={geometry.coords[geometry.coords.length - 1].y} r="4" fill="#3dbe86" />
        {active && (
          <g>
            <line x1={active.x} x2={active.x} y1={geometry.pad.t} y2={geometry.base} stroke="var(--muted)" />
            <circle cx={active.x} cy={active.y} r="4" fill="var(--ink)" />
          </g>
        )}
      </svg>
      {active && (
        <div className="tip" style={{ left: `${(active.x / geometry.width) * 100}%`, top: `${(active.y / geometry.height) * 100}%` }}>
          {niceDate(active.point.d)} · {kesExact(active.point.p)}
        </div>
      )}
    </div>
  );
}
