import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { fmt } from "../money.js";
import { FONT, useThemed } from "../theme.js";

export function CategoryDonut({ data, total }) {
  const { theme, s } = useThemed();
  if (!data.length) {
    return <div style={s.chartEmpty}>Add expenses to see category breakdown.</div>;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={2} stroke="none">
            {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie>
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.icon} {d.name}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>{fmt(d.value)} · {pct}%</div>
              </div>
            );
          }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.text }}>{fmt(total)}</div>
      </div>
    </div>
  );
}

export function NetWorthChart({ series }) {
  const { theme, s } = useThemed();
  if (series.length < 2) {
    return <div style={s.chartEmpty}>Update a balance on another day to see the trend.</div>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={0.3} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.label}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.text }}>Net worth: {fmt(d.net)}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>Assets {fmt(d.assets)} · Debts {fmt(d.debts)}</div>
              </div>
            );
          }} />
          <Area type="monotone" dataKey="net" stroke={theme.accent} strokeWidth={2} fill="url(#netWorthFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyBarChart({ data, curKey, onBarClick }) {
  const { theme, s } = useThemed();
  if (data.length < 2) {
    return <div style={s.chartEmpty}>Come back next month to see trends.</div>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.key}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.danger }}>Spent: {fmt(d.spent)}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>Income: {fmt(d.income)}</div>
              </div>
            );
          }} />
          <Bar
            dataKey="spent"
            radius={[6, 6, 0, 0]}
            onClick={(d) => { if (d && d.key !== curKey) onBarClick?.(d.key); }}
          >
            {data.map((d) => (
              <Cell
                key={d.key}
                fill={d.spent > d.income ? theme.danger : theme.accent}
                style={{ cursor: d.key !== curKey ? "pointer" : "default" }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SavingsChart({ series }) {
  const { theme, s } = useThemed();
  if (!series || series.length < 2) {
    return <div style={s.chartEmpty}>Close out a month to start tracking savings.</div>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.success} stopOpacity={0.35} />
              <stop offset="100%" stopColor={theme.success} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.label}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.success }}>Balance: {fmt(d.balance)}</div>
                {d.delta !== 0 && (
                  <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: d.delta >= 0 ? theme.success : theme.danger }}>
                    {d.delta >= 0 ? "+" : ""}{fmt(d.delta)} that month
                  </div>
                )}
              </div>
            );
          }} />
          <Area type="monotone" dataKey="balance" stroke={theme.success} strokeWidth={2} fill="url(#savingsFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
