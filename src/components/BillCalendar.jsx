import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { periodDays, scheduledItems } from "../lib/forecast.js";
import { isoDay } from "../lib/periods.js";
import { fmt, fmtWhole } from "../money.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN_PER_DAY = 3;

function dayShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// The period as a month grid, Monday first, with what lands on each day.
export function BillCalendar({ data, periodKey, today, onOpen }) {
  const { theme } = useThemed();
  const days = periodDays(periodKey, data.cutoffDay || 1);
  const items = scheduledItems(data, periodKey, today);
  const byDay = new Map();
  for (const it of items) {
    if (!byDay.has(it.date)) byDay.set(it.date, []);
    byDay.get(it.date).push(it);
  }
  const todayIso = isoDay(today);
  const first = new Date(`${days[0]}T00:00:00`);
  const cells = [...Array((first.getDay() + 6) % 7).fill(null), ...days];
  while (cells.length % 7) cells.push(null);

  const colour = (it) => {
    if (it.kind === "credit") return { fg: theme.success, bg: `${theme.success}14` };
    if (it.status === "done") return { fg: theme.textFaint, bg: theme.bg };
    if (it.status === "overdue") return { fg: theme.danger, bg: `${theme.danger}14` };
    if (it.autoPay) return { fg: theme.textMuted, bg: theme.bg };
    return { fg: theme.warning, bg: `${theme.warning}18` };
  };

  return (
    <div style={{ marginTop: SPACE.sm }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ ...TYPE.finePrint, fontWeight: 600, color: theme.textFaint, textAlign: "center", padding: "2px 0" }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`pad-${i}`} />;
          const list = byDay.get(d) || [];
          const isToday = d === todayIso;
          const dayNum = Number(d.slice(8));
          return (
            <div key={d} style={{
              minHeight: 74, borderRadius: RADIUS.sm, padding: 4, boxSizing: "border-box",
              border: `1px solid ${isToday ? theme.accent : theme.border}`, background: d < todayIso ? "transparent" : theme.surface,
              opacity: d < todayIso ? 0.75 : 1,
            }}>
              <div style={{ ...TYPE.finePrint, fontWeight: isToday ? 700 : 500, color: isToday ? theme.accent : theme.textMuted, marginBottom: 2 }}>
                {dayNum === 1 || d === days[0] ? dayShort(d) : dayNum}
              </div>
              {list.slice(0, SHOWN_PER_DAY).map((it) => {
                const c = colour(it);
                return (
                  <button key={`${it.kind}-${it.id}`} onClick={() => onOpen(it)}
                    title={`${it.name} · ${fmt(Math.abs(it.amount))}${it.status === "done" ? " · done" : it.status === "overdue" ? " · overdue" : ""}`}
                    style={{ all: "unset", boxSizing: "border-box", display: "flex", justifyContent: "space-between", gap: 4, width: "100%",
                             cursor: "pointer", borderRadius: 4, padding: "1px 4px", marginTop: 2, background: c.bg, color: c.fg,
                             ...TYPE.microLegal, fontFamily: FONT, textDecoration: it.status === "done" ? "line-through" : "none" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{it.amount > 0 ? "+" : ""}{fmtWhole(Math.abs(it.amount))}</span>
                  </button>
                );
              })}
              {list.length > SHOWN_PER_DAY && (
                <div style={{ ...TYPE.microLegal, color: theme.textFaint, marginTop: 2 }} title={list.slice(SHOWN_PER_DAY).map((it) => it.name).join(", ")}>
                  +{list.length - SHOWN_PER_DAY} more
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: SPACE.md, flexWrap: "wrap", marginTop: SPACE.sm, ...TYPE.finePrint, color: theme.textFaint }}>
        {[["Due", theme.warning], ["Overdue", theme.danger], ["Money in", theme.success], ["Done or pays itself", theme.textFaint]].map(([l, c]) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// Where the money left this period is heading, day by day to its end.
export function ForecastCard({ fc }) {
  const { theme, s } = useThemed();
  if (fc.series.length < 2) {
    return <div style={s.emptySmall}>This period has ended; there's nothing ahead to forecast.</div>;
  }
  const chart = fc.series.map((p) => ({ ...p, label: dayShort(p.date) }));
  const short = fc.runsShortOn;
  return (
    <>
      <div style={{ ...TYPE.caption, color: short ? theme.danger : theme.text, marginTop: SPACE.xs, lineHeight: 1.5 }}>
        {short
          ? <>At this pace you'd run short around <strong>{dayShort(short)}</strong>.</>
          : <>Lowest point <strong>{fmt(fc.lowestWithEveryday.amount)}</strong> on {dayShort(fc.lowestWithEveryday.date)}, and about <strong>{fmt(fc.endWithEveryday)}</strong> left at the end.</>}
      </div>
      <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2, lineHeight: 1.5 }}>
        Counts the bills and money still to come{fc.rate > 0 ? `, plus about ${fmt(fc.rate)} a day of everyday spending (your average over the last three months)` : ""}.
        The dashed line is bills only.
      </div>
      <div style={{ width: "100%", height: 200, marginTop: SPACE.sm }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <defs>
              <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.accent} stopOpacity={0.25} />
                <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
              tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} />
            <ReferenceLine y={0} stroke={theme.danger} strokeOpacity={0.5} />
            <RTooltip content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const p = payload[0].payload;
              return (
                <div style={s.chartTooltip}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.label}</div>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>Left: {fmt(p.withEveryday)}</div>
                  <div style={{ fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>Bills only: {fmt(p.balance)}</div>
                  {p.items.map((it) => (
                    <div key={`${it.kind}-${it.id}`} style={{ fontVariantNumeric: "tabular-nums", color: it.amount > 0 ? theme.success : theme.textMuted }}>
                      {it.name} {it.amount > 0 ? "+" : "−"}{fmt(Math.abs(it.amount))}
                    </div>
                  ))}
                </div>
              );
            }} />
            <Area type="monotone" dataKey="withEveryday" stroke={theme.accent} strokeWidth={2} fill="url(#forecastFill)" />
            <Line type="stepAfter" dataKey="balance" stroke={theme.textFaint} strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
