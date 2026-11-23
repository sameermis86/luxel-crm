"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { C } from "@/lib/chart-colors";
export { C };

const axisProps = { stroke: C.axis, tick: { fill: C.axis, fontSize: 11 }, tickLine: false, axisLine: { stroke: C.grid } } as const;

/** Legend in ink text with a colored swatch: identity never rides on text color. */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-1 flex flex-wrap gap-4 text-xs text-ink" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-edge bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-ink">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto tabular">{p.value}</span>
        </div>
      ))}
      <div className="mt-1 text-[10px] text-muted">Click to see these leads</div>
    </div>
  );
}

export function SourceChart({ data }: { data: { label: string; leads: number; won: number; href: string; wonHref: string }[] }) {
  const router = useRouter();
  if (!data.length) return <Empty />;
  const raw = Math.max(1, ...data.map((d) => d.leads));
  const step = raw <= 10 ? 2 : raw <= 25 ? 5 : raw <= 60 ? 10 : 25;
  const max = Math.ceil(raw / step) * step;
  return (
    <>
    <ChartLegend items={[{ label: "Leads", color: C.leads }, { label: "Won (of these)", color: C.won }]} />
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 4 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis type="number" allowDecimals={false} domain={[0, max]} ticks={Array.from({ length: max / step + 1 }, (_, i) => i * step)} {...axisProps} />
        <YAxis type="category" dataKey="label" width={150} {...axisProps} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(27,36,32,0.04)" }} />
        <Bar isAnimationActive={false} dataKey="leads" name="Leads" fill={C.leads} radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d: any) => router.push(d.payload?.href ?? d.href)}>
        </Bar>
        <Bar isAnimationActive={false} dataKey="won" name="Won (of these)" fill={C.won} radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d: any) => router.push(d.payload?.wonHref ?? d.wonHref)} />
      </BarChart>
    </ResponsiveContainer>
    </>
  );
}

export function WeeklyChart({ data }: { data: { label: string; qualified: number; needs_info: number; unqualified: number; hrefs: Record<string, string> }[] }) {
  const router = useRouter();
  if (!data.length) return <Empty />;
  const seg = (key: "qualified" | "needs_info" | "unqualified", name: string, top: boolean) => (
    <Bar
      isAnimationActive={false}
      dataKey={key}
      name={name}
      stackId="q"
      fill={C[key]}
      stroke="#FFFFFF"
      strokeWidth={2}
      radius={top ? [4, 4, 0, 0] : 0}
      cursor="pointer"
      onClick={(d: any) => router.push((d.payload ?? d).hrefs[key])}
    />
  );
  return (
    <>
    <ChartLegend items={[{ label: "Qualified", color: C.qualified }, { label: "Needs info", color: C.needs_info }, { label: "Unqualified", color: C.unqualified }]} />
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(27,36,32,0.04)" }} />
        {seg("qualified", "Qualified", false)}
        {seg("needs_info", "Needs info", false)}
        {seg("unqualified", "Unqualified", true)}
      </BarChart>
    </ResponsiveContainer>
    </>
  );
}

function Empty() {
  return <p className="py-10 text-center text-sm text-muted">No leads in this range.</p>;
}
