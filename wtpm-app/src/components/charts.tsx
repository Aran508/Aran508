'use client';
import {
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, ReferenceLine, ComposedChart, Legend, LabelList,
} from 'recharts';
import { pct, shortDay } from '@/lib/format';

export const C = {
  navy: '#261a66',
  navy2: '#6b5fc7',
  navy3: '#b9b2ea',
  orange: '#ef5f18',
  orange2: '#f9a77c',
  good: '#16a34a',
  warn: '#eab308',
  bad: '#dc2626',
  grid: '#ece9e3',
  muted: '#6b6878',
  track: '#efedf6',
};
const axis = { fontSize: 11, fill: C.muted };
const tip = { contentStyle: { borderRadius: 14, border: '1px solid #e7e5e0', boxShadow: '0 8px 24px rgba(20,13,61,.12)', fontSize: 12 }, labelStyle: { fontWeight: 700, color: '#17151f' } };

export function toneColor(v: number | null | undefined, low = 0.6, high = 0.8) {
  if (v == null) return C.track;
  return v < low ? C.bad : v <= high ? C.warn : C.good;
}

/** Doughnut like the Excel dashboard: value + remainder to 100%. */
export function Donut({ value, label, color, size = 150, sub }: { value: number | null; label: string; color?: string; size?: number; sub?: string }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  const col = color ?? toneColor(value);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={[{ v }, { v: 1 - v }]} dataKey="v" innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
              <Cell fill={col} />
              <Cell fill={C.track} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[26px] font-bold tracking-tight tabular-nums leading-none">{pct(value)}</div>
            {sub && <div className="text-[11px] text-muted mt-1">{sub}</div>}
          </div>
        </div>
      </div>
      <div className="mt-2 text-sm font-semibold">{label}</div>
    </div>
  );
}

export function TrendChart({ data, target, height = 260 }: { data: { date: string; OEE: number | null; A: number | null; P: number | null; Q: number | null }[]; target?: number; height?: number }) {
  const d = data.map((x) => ({ ...x, day: shortDay(x.date) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={d} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip {...tip} formatter={(v: number, n: string) => [pct(v), n === 'OEE' ? '%OEE' : `%${n}`]} />
        {target && <ReferenceLine y={target} stroke={C.orange} strokeDasharray="4 4" label={{ value: `Target ${Math.round(target * 100)}%`, fill: C.orange, fontSize: 11, position: 'insideTopRight' }} />}
        <Line type="monotone" dataKey="A" stroke={C.navy3} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="P" stroke={C.orange2} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="OEE" stroke={C.navy} strokeWidth={3} dot={{ r: 2.5, fill: C.navy }} connectNulls isAnimationActive={false} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'OEE' ? '%OEE' : `%${v}`)} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RankBars({ data, color, height = 150 }: { data: { machine: string; OEE: number | null }[]; color: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }} barSize={18}>
        <XAxis type="number" hide domain={[0, 1]} />
        <YAxis type="category" dataKey="machine" width={130} tick={{ ...axis, fill: '#17151f', fontWeight: 600 }} tickLine={false} axisLine={false} />
        <Bar dataKey="OEE" fill={color} radius={[0, 8, 8, 0]} background={{ fill: C.track, radius: 8 }} isAnimationActive={false}>
          <LabelList dataKey="OEE" position="right" formatter={(v: number) => pct(v)} style={{ fontSize: 12, fontWeight: 700, fill: '#17151f' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MachineApqBars({ data, height = 300 }: { data: { machine: string; A: number | null; P: number | null; Q: number | null; OEE: number | null }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 40 }} barGap={1}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="machine" tick={{ ...axis, fontSize: 10 }} interval={0} angle={-35} textAnchor="end" tickLine={false} axisLine={false} height={60} />
        <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip {...tip} formatter={(v: number, n: string) => [pct(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} />
        <Bar dataKey="A" name="%A" fill={C.navy3} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="P" name="%P" fill={C.orange2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="Q" name="%Q" fill="#9fd8b0" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="OEE" name="%OEE" fill={C.navy} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OeeBars({ data, height = 280, target, low = 0.6, high = 0.8 }: { data: { name: string; OEE: number | null }[]; height?: number; target?: number; low?: number; high?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -14, bottom: 40 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="name" tick={{ ...axis, fontSize: 10 }} interval={0} angle={-35} textAnchor="end" tickLine={false} axisLine={false} height={60} />
        <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip {...tip} formatter={(v: number) => [pct(v), '%OEE']} />
        {target && <ReferenceLine y={target} stroke={C.orange} strokeDasharray="4 4" />}
        <Bar dataKey="OEE" radius={[6, 6, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={toneColor(d.OEE, low, high)} />)}
          <LabelList dataKey="OEE" position="top" formatter={(v: number) => (v == null ? '' : `${Math.round(v * 100)}%`)} style={{ fontSize: 10, fontWeight: 700, fill: '#17151f' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ParetoChart({ data, height = 300 }: { data: { name: string; hours: number; cumulative: number; group: string }[]; height?: number }) {
  const col = (g: string) => (g === 'A' ? C.navy : g === 'P' ? C.orange : g === 'Q' ? C.good : C.navy3);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 50 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="name" tick={{ ...axis, fontSize: 10 }} interval={0} angle={-35} textAnchor="end" tickLine={false} axisLine={false} height={70} />
        <YAxis yAxisId="h" tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
        <YAxis yAxisId="c" orientation="right" tick={axis} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip {...tip} formatter={(v: number, n: string) => (n === 'cumulative' ? [pct(v), 'Cumulative'] : [`${v.toFixed(1)} h`, 'Hours'])} />
        <Bar yAxisId="h" dataKey="hours" radius={[6, 6, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={col(d.group)} />)}
        </Bar>
        <Line yAxisId="c" type="monotone" dataKey="cumulative" stroke={C.bad} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function WeekBars({ weeks, height = 150 }: { weeks: { week: number; OEE: number | null }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={weeks.map((w) => ({ ...w, name: `W${w.week}` }))} margin={{ top: 16, right: 4, left: -24, bottom: 0 }}>
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}`} />
        <Bar dataKey="OEE" radius={[6, 6, 0, 0]} isAnimationActive={false}>
          {weeks.map((w, i) => <Cell key={i} fill={toneColor(w.OEE)} />)}
          <LabelList dataKey="OEE" position="top" formatter={(v: number) => (v == null ? '' : `${Math.round(v * 100)}%`)} style={{ fontSize: 10, fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedLossBars({ data, height = 300 }: { data: { name: string; A: number; P: number; Q: number; M: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 40 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="name" tick={{ ...axis, fontSize: 10 }} interval={0} angle={-35} textAnchor="end" tickLine={false} axisLine={false} height={60} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
        <Tooltip {...tip} formatter={(v: number, n: string) => [`${v.toFixed(1)} h`, n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} />
        <Bar dataKey="A" name="Availability" stackId="s" fill={C.navy} isAnimationActive={false} />
        <Bar dataKey="P" name="Performance" stackId="s" fill={C.orange} isAnimationActive={false} />
        <Bar dataKey="Q" name="Quality" stackId="s" fill={C.good} isAnimationActive={false} />
        <Bar dataKey="M" name="Planned / mgmt" stackId="s" fill={C.navy3} radius={[6, 6, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
