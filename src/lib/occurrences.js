// Recurring bills and credits come in two kinds. Monthly ones fall on a day
// of the month (`dayOfMonth`, and optionally every N months from `anchor`).
// Weekly ones fall every week or two from a first date:
//   { repeat: "weeks", every: 1 | 2, startDate: "YYYY-MM-DD" }
// A period holds one copy of a weekly item for each date it falls on, and
// each copy stores that `date`.

export function isWeekly(item) {
  return item?.repeat === "weeks";
}

// A copy that came from a recurring template (monthly or weekly), as
// opposed to a one-off entry.
export function isRecurringItem(item) {
  return item?.dayOfMonth != null || isWeekly(item);
}
