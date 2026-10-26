// People sharing one budget, and who paid for what.
//
// A person: { id, name, color, removed? }, kept in `data.people`. A budget
// with fewer than two of them is a one-person budget and shows nothing about
// payers. Removing someone only marks them `removed`: the record stays so the
// entries they paid for keep their name.
//
// An entry (expense, recurring copy, upcoming payment, credit) may carry
// `paidBy` (a person id, or JOINT) and `paidWith` (an account id). Entries
// store ids, never names.

import { periodSpending, UNCATEGORIZED_NAME } from "./totals.js";
import { splitParts } from "./splits.js";

// Paid for out of the household's shared money, not by one person.
export const JOINT = "joint";

// A new person takes the first of these that nobody is using.
export const PERSON_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6"];

// Where the last payer chosen is remembered, on this computer only.
export const LAST_PAYER_KEY = "budget-ctrl-last-payer";

// The people to show: everyone not removed.
export function peopleOf(data) {
  return (data?.people || []).filter((p) => !p.removed);
}

export function isShared(data) {
  return peopleOf(data).length >= 2;
}

// A person by id, removed ones included, so an old entry can still say who paid.
export function personById(data, id) {
  return (data?.people || []).find((p) => p.id === id) || null;
}

export function addPerson(data, name, newId) {
  const clean = String(name ?? "").trim();
  if (!clean) return data;
  const active = peopleOf(data);
  const taken = new Set(active.map((p) => p.color));
  // With every colour in use, start the list over rather than run out.
  const color = PERSON_COLORS.find((c) => !taken.has(c)) || PERSON_COLORS[active.length % PERSON_COLORS.length];
  return { ...data, people: [...(data?.people || []), { id: newId(), name: clean, color }] };
}

export function renamePerson(data, id, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return data;
  return { ...data, people: (data?.people || []).map((p) => (p.id === id ? { ...p, name: clean } : p)) };
}

export function removePerson(data, id) {
  return { ...data, people: (data?.people || []).map((p) => (p.id === id ? { ...p, removed: true } : p)) };
}

// The accounts someone can pay from: their own, the shared (no owner) ones,
// and none that are closed. With nobody picked, every open account.
export function waysToPay(data, paidBy) {
  return (data?.accounts || []).filter((a) => !a.closed && (!paidBy || !a.owner || a.owner === paidBy));
}

// Tidy a payer as chosen in a form into what is stored: empty values go, and
// so does anything that no longer fits. A removed person stays, so editing
// an old entry doesn't wipe who paid it.
export function cleanPayer({ paidBy, paidWith } = {}, data) {
  const out = {};
  if (paidBy && (paidBy === JOINT || personById(data, paidBy))) out.paidBy = paidBy;
  if (paidWith && waysToPay(data, out.paidBy).some((a) => a.id === paidWith)) out.paidWith = paidWith;
  return out;
}

// What to say about an entry's payer: `who` is the person's name, or JOINT
// (for the screen to word); `how` is the account's name. Each is null when it
// isn't set or the person or account no longer exists.
export function payerParts(data, entry) {
  let who = null;
  if (entry?.paidBy === JOINT) who = JOINT;
  else if (entry?.paidBy) who = personById(data, entry.paidBy)?.name ?? null;
  const how = entry?.paidWith ? (data?.accounts || []).find((a) => a.id === entry.paidWith)?.name ?? null : null;
  return { who, how };
}

// The last payer chosen on this computer, so the next entry starts there.
// Storage can be missing or blocked, or hold something else: then nothing.
export function readLastPayer() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_PAYER_KEY));
    const out = {};
    if (typeof stored?.paidBy === "string" && stored.paidBy) out.paidBy = stored.paidBy;
    if (typeof stored?.paidWith === "string" && stored.paidWith) out.paidWith = stored.paidWith;
    return out;
  } catch {
    return {};
  }
}

export function rememberPayer(payer) {
  try {
    localStorage.setItem(LAST_PAYER_KEY, JSON.stringify({ paidBy: payer?.paidBy, paidWith: payer?.paidWith }));
  } catch {
    // Nowhere to keep it: the next entry just starts blank.
  }
}

// Spending in a period by who paid: person id, JOINT, or "" for what nobody
// was marked for. It walks the entries Total Spent counts, so the two can't
// disagree. `leaveOut` is a Set of category names to skip, split parts too.
export function spendingByPerson(month, periodKey, today, calendar, { leaveOut } = {}) {
  const byPerson = new Map();
  for (const { entry } of periodSpending(month, periodKey, today, calendar).items) {
    const who = entry.paidBy || "";
    for (const part of splitParts(entry)) {
      if (leaveOut?.has(part.category || UNCATEGORIZED_NAME)) continue;
      byPerson.set(who, (byPerson.get(who) || 0) + (part.amount || 0));
    }
  }
  return byPerson;
}
