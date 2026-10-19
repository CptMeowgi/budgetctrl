// Saving and deleting recurring bills and credits: the template that makes
// each new period's copies, and the copies in the period being edited. Bills
// and credits follow the same rules, so both forms use these.
//
// A monthly item has at most one copy in a period. A weekly item has one per
// date it falls on, so editing or deleting one copy in the running period
// redoes or removes them all: they are the same bill. Past periods are
// history, and only ever change one copy at a time. Periods made ahead of
// time follow the running one (see followAhead).

import { copiesFor, isRecurringItem, isWeekly, missingCopies, occursIn } from "./occurrences.js";

const KINDS = {
  recurring: { list: "recurring", template: "recurringTemplate" },
  credits: { list: "credits", template: "creditTemplate" },
};
const emptyPeriod = () => ({ income: 0, expenses: [], recurring: [], upcoming: [], credits: [] });

// Periods made ahead of time (by a pay switch, or an import of a future
// date) already hold copies of the bills. A change to a bill in the running
// period reaches them too, as if they were made afterwards: each gets the
// template's copies afresh, and a date that stays keeps its copy's id, as
// does a monthly bill's one copy.
export function followAhead(data, kind, cal, curKey, templateId, newId) {
  // A bill from before templates had ids has no copies to follow it.
  if (!templateId) return data;
  const { list, template } = KINDS[kind];
  const ahead = Object.keys(data.months || {}).filter((k) => k > curKey);
  if (!ahead.length) return data;
  const tpl = (data[template] || []).find((x) => x.id === templateId);
  const months = { ...data.months };
  for (const k of ahead) {
    const items = months[k][list] || [];
    const mine = items.filter((x) => x.templateId === templateId);
    const fresh = tpl ? copiesFor(tpl, cal, k, newId) : [];
    if (!mine.length && !fresh.length) continue;
    const idOn = new Map(mine.map((x) => [x.date || "", x.id]));
    const kept = fresh.map((c) => (idOn.has(c.date || "") ? { ...c, id: idOn.get(c.date || "") }
      : !isWeekly(tpl) && mine.length === 1 && fresh.length === 1 ? { ...c, id: mine[0].id } : c));
    months[k] = { ...months[k], [list]: [...items.filter((x) => x.templateId !== templateId), ...kept] };
  }
  return { ...data, months };
}

export function saveRecurring(data, kind, { cal, curKey, targetKey, editing, editingTpl, fields, schedule, newId, today }) {
  const { list, template } = KINDS[kind];
  const months = data.months || {};
  const tmpl = data[template] || [];
  const cur = months[curKey] || emptyPeriod();
  const target = months[targetKey] || emptyPeriod();
  const touchesTemplate = targetKey === curKey;
  const curItems = cur[list] || [];
  const put = (key, month, items) => ({ ...months, [key]: { ...month, [list]: items } });

  // A template edited from "not due this period". Rescheduled into this
  // period, it gets its copies now: the rollover that would have made them
  // has already happened.
  if (editingTpl) {
    const tpl = { ...editingTpl, ...fields, ...schedule };
    const add = missingCopies(tpl, cal, curKey, curItems, newId);
    return followAhead({ ...data, [template]: tmpl.map((x) => (x.id === tpl.id ? tpl : x)),
                         months: add.length ? put(curKey, cur, [...curItems, ...add]) : months }, kind, cal, curKey, tpl.id, newId);
  }

  if (editing) {
    const items = target[list] || [];
    if (!touchesTemplate) {
      return { ...data, months: put(targetKey, target, items.map((x) => (x.id === editing.id ? { ...editing, ...fields } : x))) };
    }
    const nextTmpl = tmpl.map((x) => (x.id === editing.templateId ? { ...x, ...fields, ...schedule } : x));
    if (isWeekly(editing) || isWeekly(schedule) || cal.dated(targetKey)) {
      // Weekly before or after, or any bill in a fortnight: this period's
      // copies are redone from the template. A date that stays keeps its
      // copy's id, so a reminder already shown for it isn't shown again. A
      // payment already made on a date the new schedule doesn't have stays
      // as it was: changing the schedule today doesn't undo money already
      // spent.
      const tpl = nextTmpl.find((x) => x.id === editing.templateId) || { ...editing, ...fields, ...schedule, id: editing.templateId };
      const mine = items.filter((x) => x.templateId === editing.templateId);
      const idOn = new Map(mine.filter((x) => x.date).map((x) => [x.date, x.id]));
      // A monthly bill is paid once a month: moved, it stands on its new day
      // only, as in a monthly budget. A weekly one's past dates were each paid.
      const monthly = !isWeekly(editing) && !isWeekly(schedule);
      const fresh = copiesFor(tpl, cal, targetKey, newId);
      const redone = fresh.map((c) => (idOn.has(c.date) ? { ...c, id: idOn.get(c.date) }
        : monthly && fresh.length === 1 ? { ...c, id: editing.id } : c));
      const redoneDates = new Set(redone.map((c) => c.date));
      const paid = today && !monthly ? mine.filter((x) => !redoneDates.has(x.date) && cal.isDue(x, targetKey, today)) : [];
      const kept = items.filter((x) => x.templateId !== editing.templateId);
      return followAhead({ ...data, [template]: nextTmpl, months: put(targetKey, target, [...kept, ...paid, ...redone]) },
                         kind, cal, curKey, editing.templateId, newId);
    }
    // Rescheduled out of this period: this copy goes, the template stays.
    const updated = { ...editing, ...fields, ...schedule };
    const dueNow = occursIn(updated, cal, curKey);
    const nextItems = !dueNow ? items.filter((x) => x.id !== editing.id) : items.map((x) => (x.id === editing.id ? updated : x));
    return followAhead({ ...data, [template]: nextTmpl, months: put(targetKey, target, nextItems) }, kind, cal, curKey, editing.templateId, newId);
  }

  // A new item: a template when the running period is being edited, and
  // this period's copies if it falls here. In a past period it is a one-off
  // correction with no template.
  const tid = newId();
  const tpl = { id: tid, ...fields, ...(touchesTemplate ? schedule : {}) };
  const add = touchesTemplate ? copiesFor(tpl, cal, targetKey, newId) : [{ ...tpl, id: newId(), templateId: tid }];
  const out = {
    ...data,
    [template]: touchesTemplate ? [...tmpl, tpl] : tmpl,
    months: add.length ? put(targetKey, target, [...(target[list] || []), ...add]) : months,
  };
  return touchesTemplate ? followAhead(out, kind, cal, curKey, tid, newId) : out;
}

// Deleting a copy in the running period deletes the item: its template, and
// every copy of it in this period (a weekly one has several).
export function deleteRecurringCopy(data, kind, curKey, copy) {
  const { list, template } = KINDS[kind];
  const cur = data.months?.[curKey] || emptyPeriod();
  const sameItem = (x) => x.id === copy.id || (isWeekly(copy) && x.templateId === copy.templateId);
  return followAhead({
    ...data,
    months: { ...data.months, [curKey]: { ...cur, [list]: (cur[list] || []).filter((x) => !sameItem(x)) } },
    [template]: (data[template] || []).filter((x) => x.id !== copy.templateId),
  }, kind, null, curKey, copy.templateId, null);
}

// Deleting a bill that has no copy in the running period (one listed as
// "not due this period"): its template goes, and so do its copies in any
// period made ahead of time.
export function deleteTemplate(data, kind, curKey, templateId) {
  const { template } = KINDS[kind];
  return followAhead({ ...data, [template]: (data[template] || []).filter((x) => x.id !== templateId) },
                     kind, null, curKey, templateId, null);
}

// The form that edits an entry. A recurring credit opens in its own form
// wherever it's opened from (History, search, the bill calendar); the
// one-off form would leave a stray date on it.
export function editFormFor(kind, entry) {
  return kind === "credit" && isRecurringItem(entry) ? "creditRecurring" : kind;
}
