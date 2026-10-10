import { useState } from "react";
import { parseAmount } from "../lib/importer.js";
import { STARTER_CATEGORIES } from "../lib/setup.js";
import { currencyOptions, LOCALE_OPTIONS } from "../money.js";
import { ordinal } from "../text.js";
import { ELEVATION, FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { t, tk } from "../i18n.js";

const STEPS = [tk("Money"), tk("Your month"), tk("Categories")];

// Three short screens for a brand-new budget. Everything here can be changed
// later in Settings, and Skip leaves the defaults.
export function SetupWizard({ data, onFinish, onRestore, onSkip }) {
  const { theme, s } = useThemed();
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState(data.currency || "PLN");
  const [locale, setLocale] = useState(data.locale || "");
  const [cutoffDay, setCutoffDay] = useState(data.cutoffDay || 1);
  const [income, setIncome] = useState("");
  const [setAside, setSetAside] = useState("");
  const [picked, setPicked] = useState(() => new Set(STARTER_CATEGORIES.filter((c) => c.on).map((c) => c.name)));

  const incomeNum = income.trim() === "" ? 0 : parseAmount(income);
  const asideNum = setAside.trim() === "" ? 0 : parseAmount(setAside);
  const stepValid = step !== 1 || (incomeNum != null && incomeNum >= 0 && asideNum != null && asideNum >= 0);
  const answers = () => ({
    currency, locale, cutoffDay, income: incomeNum || 0, setAside: asideNum || 0,
    categories: STARTER_CATEGORIES.filter((c) => picked.has(c.name)).map((c) => ({ ...c, name: t(c.name) })),
    creditNames: Object.fromEntries((data.creditCategories || []).map((c) => [c.name, t(c.name)])),
  });
  const toggle = (name) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const label = { fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };
  const hint = { ...TYPE.finePrint, color: theme.textFaint, marginTop: 6, lineHeight: 1.5 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 150, background: theme.outerBg, display: "flex", alignItems: "center",
                  justifyContent: "center", padding: SPACE.lg, boxSizing: "border-box", overflowY: "auto", fontFamily: FONT }}>
      <div role="dialog" aria-label={t("Set up Budget Ctrl")} style={{ width: "100%", maxWidth: 560, background: theme.surface, borderRadius: RADIUS.lg,
                    border: `1px solid ${theme.border}`, boxShadow: ELEVATION, padding: SPACE.xl, boxSizing: "border-box", color: theme.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACE.md }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((name, i) => (
              <span key={name} title={t(name)} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, transition: "width .2s",
                                                     background: i <= step ? theme.accent : theme.border }} />
            ))}
          </div>
          <button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint }} onClick={onSkip}>{t("Skip")}</button>
        </div>

        {step === 0 && (
          <>
            <div style={{ ...TYPE.lead, fontWeight: 700 }}>{t("Welcome to Budget Ctrl")}</div>
            <div style={{ ...TYPE.caption, color: theme.textMuted, margin: `${SPACE.xs}px 0 ${SPACE.lg}px`, lineHeight: 1.5 }}>{t("Your budget stays on this computer; nothing is sent anywhere. Three quick questions and you're set. All of it can be changed later in Settings.")}</div>
            <label style={label}>{t("Currency")}</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={s.input}>
              {currencyOptions().map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <label style={{ ...label, marginTop: SPACE.md }}>{t("Number format")}</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} style={s.input}>
              {LOCALE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <div style={hint}>
              {t("Moving from another computer? {restore} instead.", {
                restore: <button key="r" style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint, fontWeight: 600 }} onClick={onRestore}>{t("Restore a backup file")}</button>,
              })}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div style={{ ...TYPE.lead, fontWeight: 700 }}>{t("Your month")}</div>
            <div style={{ ...TYPE.caption, color: theme.textMuted, margin: `${SPACE.xs}px 0 ${SPACE.lg}px`, lineHeight: 1.5 }}>{t("Budget Ctrl can follow your payday rather than the calendar, so a month runs from one pay to the next.")}</div>
            <label style={label}>{t("My month starts on")}</label>
            <select value={cutoffDay} onChange={(e) => setCutoffDay(+e.target.value)} style={s.input}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d === 1 ? t("The 1st (calendar months)") : t("The {day} (payday)", { day: ordinal(d) })}</option>
              ))}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: SPACE.md }}>
              <div>
                <label style={label}>{t("Income this month ({currency})", { currency })}</label>
                <input inputMode="decimal" value={income} placeholder="0" autoFocus onChange={(e) => setIncome(e.target.value)} style={s.input} />
              </div>
              <div>
                <label style={label}>{t("Set aside each month")}</label>
                <input inputMode="decimal" value={setAside} placeholder={t("Optional")} onChange={(e) => setSetAside(e.target.value)} style={s.input} />
              </div>
            </div>
            <div style={hint}>{t("Your pay after tax. Each new month starts with the last one's figure, so you only change it when your pay changes.")}</div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ ...TYPE.lead, fontWeight: 700 }}>{t("What do you spend on?")}</div>
            <div style={{ ...TYPE.caption, color: theme.textMuted, margin: `${SPACE.xs}px 0 ${SPACE.md}px`, lineHeight: 1.5 }}>{t("Pick some categories to start with. You can rename, recolour or add more any time.")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.xs }}>
              {STARTER_CATEGORIES.map((c) => {
                const on = picked.has(c.name);
                return (
                  <button key={c.name} onClick={() => toggle(c.name)} aria-pressed={on}
                    style={{ ...TYPE.caption, fontFamily: FONT, cursor: "pointer", borderRadius: RADIUS.pill, padding: "7px 13px",
                             border: `1px solid ${on ? c.color : theme.border}`, background: on ? `${c.color}1c` : "transparent",
                             color: on ? theme.text : theme.textMuted, fontWeight: on ? 600 : 400 }}>
                    {c.icon} {t(c.name)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: SPACE.xl, gap: SPACE.md }}>
          {step > 0
            ? <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep(step - 1)}>{t("← Back")}</button>
            : <span />}
          {step < STEPS.length - 1 ? (
            <button style={{ ...s.addBtn, opacity: stepValid ? 1 : 0.5 }} disabled={!stepValid} onClick={() => setStep(step + 1)}>{t("Next →")}</button>
          ) : (
            <div style={{ display: "flex", gap: SPACE.md, alignItems: "center" }}>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => onFinish(answers(), "statement")}>{t("Start with a bank statement")}</button>
              <button style={s.addBtn} onClick={() => onFinish(answers(), "done")}>{t("Start budgeting")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
