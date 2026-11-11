// What the carry switch in Settings and the one-time notice do to
// `data.carry` ({ on, from, resets?, noticed? }, see migrateCarry in
// model.js). Each returns the new `carry` and leaves the budget's months
// alone, so no figure from before changes.

import { calendarFor } from "./calendar.js";

// Turning carrying on (again) starts with the period that just ended, as the
// default does: money left at the end of it is the first thing to carry in.
// With no earlier period on record it starts with the running one. Earlier
// "Start fresh" points are kept. Switching it on was a deliberate choice, so
// the notice has nothing left to say.
export function carryTurnedOn(data, today = new Date()) {
  const cal = calendarFor(data);
  const cur = cal.current(today);
  const earlier = Object.keys(data.months || {}).some((k) => k < cur);
  return { ...data.carry, on: true, from: earlier ? cal.prev(cur) : cur, noticed: true };
}

// Off. Nothing is deleted: `from` and `resets` stay, but turning it on again
// sets a new start.
export function carryTurnedOff(data) {
  return { ...data.carry, on: false, noticed: true };
}

// "Start fresh": the running period starts at 0, whatever came before. The
// earlier fresh starts stay, and doing it twice in one period adds nothing.
export function carryStartedFresh(data, today = new Date()) {
  const cur = calendarFor(data).current(today);
  const resets = Array.isArray(data.carry?.resets) ? data.carry.resets : [];
  return { ...data.carry, resets: resets.includes(cur) ? resets : [...resets, cur].sort() };
}

// "Got it" on the notice.
export function carryNoticed(data) {
  return { ...data.carry, noticed: true };
}

// Whether the one-time notice shows: carrying is on, the notice hasn't been
// dismissed, and there is something it describes - money carried in, or a
// goal that now counts only the set-aside.
export function showCarryNotice(data, carriedIn) {
  const c = data.carry;
  if (!c?.on || c.noticed) return false;
  return carriedIn !== 0 || (data.goals || []).some((g) => g.source === "budget");
}
