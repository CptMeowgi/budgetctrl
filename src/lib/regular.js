// Spot payments that are really monthly bills - Netflix, the gym, a phone
// plan - entered (or imported) as one-off expenses, and turn one into a
// recurring bill without counting this month twice.
//
// Looks like a bill when the same payee appears:
//   - in consecutive calendar months, at most once in each (so the weekly
//     grocery shop never qualifies)
//   - for amounts within 15% of each other
//   - on days within a week of each other
//   - recently: the latest within the last 45 days
// and it is not already a recurring bill, or a suggestion you dismissed.

import { payeeKey } from "./reports.js";
import { isoDay } from "./periods.js";
import { calendarFor } from "./calendar.js";
import { monthsBetween } from "./schedule.js";
import { daysBetweenISO } from "./accounts.js";
import { copiesFor } from "./occurrences.js";
import { followAhead } from "./recurringEdits.js";

const mostCommon = (xs) => {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

export function findRegularPayments(data, today) {
  const todayIso = isoDay(today);
  const tracked = new Set((data.recurringTemplate || []).map((t) => payeeKey(t.name)));
  const dismissed = new Set(data.dismissedRegular || []);
  const groups = new Map();
  for (const [periodKey, m] of Object.entries(data.months || {})) {
    for (const e of m.expenses || []) {
      if (!e.date || !(e.amount > 0)) continue;
      const key = payeeKey(e.name);
      if (!key || tracked.has(key) || dismissed.has(key)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id: e.id, periodKey, name: e.name.trim(), amount: e.amount, date: e.date, category: e.category });
    }
  }

  const out = [];
  for (const [key, items] of groups) {
    const byMonth = new Map();
    for (const it of items) {
      const mk = it.date.slice(0, 7);
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk).push(it);
    }
    if ([...byMonth.values()].some((list) => list.length > 1)) continue;

    // The run of consecutive months ending with the latest one.
    const months = [...byMonth.keys()].sort();
    let run = [months[months.length - 1]];
    for (let i = months.length - 2; i >= 0 && monthsBetween(months[i], run[0]) === 1; i--) run.unshift(months[i]);
    if (run.length < 2) continue;

    const runItems = run.map((mk) => byMonth.get(mk)[0]);
    const latest = runItems[runItems.length - 1];
    if (daysBetweenISO(latest.date, todayIso) > 45) continue;

    const amounts = runItems.map((it) => it.amount);
    if (Math.max(...amounts) > Math.min(...amounts) * 1.15) continue;
    const days = runItems.map((it) => Number(it.date.slice(8, 10)));
    if (Math.max(...days) - Math.min(...days) > 7) continue;

    const categories = runItems.map((it) => it.category).filter((c) => c && c !== "Uncategorized");
    out.push({
      key,
      name: mostCommon(runItems.map((it) => it.name)),
      amount: latest.amount,
      dayOfMonth: median(days),
      category: mostCommon(categories) || latest.category || "Uncategorized",
      months: run,
      entries: runItems.map(({ id, periodKey }) => ({ id, periodKey })),
      lastDate: latest.date,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// Make a suggestion a monthly recurring bill. Earlier months keep their
// expenses as recorded; this period's expense becomes this period's instance
// of the bill, so its spending is counted once, not twice.
export function convertToRecurring(data, suggestion, newId, today) {
  const cal = calendarFor(data);
  const curKey = cal.current(today);
  const tpl = {
    id: newId(), name: suggestion.name, amount: suggestion.amount, dayOfMonth: suggestion.dayOfMonth,
    category: suggestion.category, autoPay: false,
  };
  // This period's copy of the bill, when it falls here. The expense it stands
  // for goes, so the payment is counted once; with no copy here it stays.
  const copies = copiesFor(tpl, cal, curKey, newId);
  const inThisPeriod = new Set(copies.length ? suggestion.entries.filter((e) => e.periodKey === curKey).map((e) => e.id) : []);
  const cur = data.months?.[curKey] || { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
  const months = {
    ...data.months,
    [curKey]: {
      ...cur,
      expenses: (cur.expenses || []).filter((e) => !inThisPeriod.has(e.id)),
      recurring: [...(cur.recurring || []), ...copies],
    },
  };
  return {
    data: followAhead({ ...data, months, recurringTemplate: [...(data.recurringTemplate || []), tpl] }, "recurring", cal, curKey, tpl.id, newId),
    removed: inThisPeriod.size,
  };
}

export function dismissRegular(data, key) {
  const list = data.dismissedRegular || [];
  return list.includes(key) ? data : { ...data, dismissedRegular: [...list, key] };
}
