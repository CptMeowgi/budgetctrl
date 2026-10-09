// Accounts and their balances. Balances are typed in when you check them -
// they are not worked out from the budget's entries, which follow budget
// periods and would never quite match what the bank says.
//
// An account:
//   { id, name, kind, closed?, balances: [{ date: "YYYY-MM-DD", amount, note? }] }
//
// For a credit card or loan, `amount` is what you owe, as a positive number -
// the way the statement shows it. Net worth subtracts it.

export const ACCOUNT_KINDS = [
  { id: "current", label: "Current account", icon: "🏦", liability: false },
  { id: "savings", label: "Savings", icon: "🐷", liability: false },
  { id: "cash", label: "Cash", icon: "💵", liability: false },
  { id: "investment", label: "Investments", icon: "📈", liability: false },
  { id: "card", label: "Credit card", icon: "💳", liability: true },
  { id: "loan", label: "Loan", icon: "🧾", liability: true },
];

// After this long without an update a balance is probably out of date.
export const STALE_DAYS = 30;

export function kindOf(account) {
  return ACCOUNT_KINDS.find((k) => k.id === account?.kind) || ACCOUNT_KINDS[0];
}

export function isLiability(account) {
  return kindOf(account).liability;
}

export function sortedBalances(account) {
  return [...(account?.balances || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The balance as it stood on a day: the latest one recorded on or before it.
export function balanceAsOf(account, iso) {
  let found = null;
  for (const b of sortedBalances(account)) if (b.date <= iso) found = b;
  return found;
}

export function latestBalance(account) {
  const all = sortedBalances(account);
  return all.length ? all[all.length - 1] : null;
}

export function previousBalance(account) {
  const all = sortedBalances(account);
  return all.length > 1 ? all[all.length - 2] : null;
}

// One balance per day: recording another on the same day corrects it.
export function recordBalance(account, { date, amount, note }) {
  const entry = { date, amount: Math.round(amount * 100) / 100 };
  if (note && String(note).trim()) entry.note = String(note).trim();
  const balances = (account.balances || []).filter((b) => b.date !== date);
  return { ...account, balances: [...balances, entry].sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

export function removeBalance(account, date) {
  return { ...account, balances: (account.balances || []).filter((b) => b.date !== date) };
}

// Closing records a zero balance, so the account stops counting from that day
// but the net worth history before it stays true.
export function closeAccount(account, iso) {
  return { ...recordBalance(account, { date: iso, amount: 0 }), closed: true };
}

export function reopenAccount(account) {
  const out = { ...account };
  delete out.closed;
  return out;
}

export function netWorthAsOf(accounts, iso) {
  let assets = 0;
  let debts = 0;
  for (const a of accounts || []) {
    const b = balanceAsOf(a, iso);
    if (!b) continue;
    if (isLiability(a)) debts += b.amount;
    else assets += b.amount;
  }
  return { assets, debts, net: assets - debts };
}

// Net worth on every day a balance was recorded, each account carrying its
// last known balance forward.
export function netWorthSeries(accounts) {
  const dates = [...new Set((accounts || []).flatMap((a) => (a.balances || []).map((b) => b.date)))].sort();
  return dates.map((date) => ({ date, ...netWorthAsOf(accounts, date) }));
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function daysBetweenISO(fromIso, toIso) {
  const [a, b] = [fromIso, toIso].map((s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86400000);
}

// How net worth moved over the last `days`. Null when nothing was recorded
// that far back - a first balance is not a change.
export function netWorthChange(accounts, todayIso, days = 30) {
  const since = addDays(todayIso, -days);
  const hadAny = (accounts || []).some((a) => balanceAsOf(a, since));
  if (!hadAny) return null;
  return netWorthAsOf(accounts, todayIso).net - netWorthAsOf(accounts, since).net;
}

// Open accounts whose balance has not been updated for `days`.
export function staleAccounts(accounts, todayIso, days = STALE_DAYS) {
  return (accounts || []).filter((a) => {
    if (a.closed) return false;
    const last = latestBalance(a);
    return !last || daysBetweenISO(last.date, todayIso) > days;
  });
}
