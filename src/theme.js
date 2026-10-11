import { createContext, useContext } from "react";

// ---- Design tokens --------------------------------------------------------
// After the "Mintly" design: dark glass cards on a near-black canvas, violet
// as the accent, green for money in and orange for money out. Kept as tokens
// rather than inlined so the scale is enforced instead of approximated per
// component.

// DM Sans ships with the app (main.jsx), so no font is fetched at run time.
// The CJK fallbacks cover Chinese, which DM Sans doesn't.
export const FONT = "'DM Sans Variable', 'DM Sans', 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif";

export const TYPE = {
  displayLarge:  { fontSize: 40, fontWeight: 700, lineHeight: 1.10, letterSpacing: "-1px" },
  displayMedium: { fontSize: 32, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-1px" },
  lead:          { fontSize: 26, fontWeight: 600, lineHeight: 1.2,  letterSpacing: "-0.8px" },
  leadAiry:      { fontSize: 22, fontWeight: 400, lineHeight: 1.45, letterSpacing: "-0.3px" },
  tagline:       { fontSize: 22, fontWeight: 700, lineHeight: 1.2,  letterSpacing: "-0.6px" },
  bodyStrong:    { fontSize: 16, fontWeight: 600, lineHeight: 1.3,  letterSpacing: "-0.2px" },
  body:          { fontSize: 15, fontWeight: 400, lineHeight: 1.5,  letterSpacing: "-0.1px" },
  caption:       { fontSize: 14, fontWeight: 400, lineHeight: 1.43, letterSpacing: "-0.1px" },
  captionStrong: { fontSize: 14, fontWeight: 600, lineHeight: 1.3,  letterSpacing: "-0.1px" },
  buttonLarge:   { fontSize: 15, fontWeight: 600, lineHeight: 1.0,  letterSpacing: "0" },
  buttonUtility: { fontSize: 13, fontWeight: 600, lineHeight: 1.3,  letterSpacing: "0" },
  finePrint:     { fontSize: 12, fontWeight: 400, lineHeight: 1.2,  letterSpacing: "0" },
  microLegal:    { fontSize: 11, fontWeight: 400, lineHeight: 1.3,  letterSpacing: "0" },
  navLink:       { fontSize: 11, fontWeight: 600, lineHeight: 1.0,  letterSpacing: "0.7px" },
};

export const RADIUS = { none: 0, xs: 6, sm: 9, md: 12, lg: 22, xl: 28, pill: 9999 };
export const SPACE = { xxs: 4, xs: 8, sm: 12, md: 17, lg: 24, xl: 32, xxl: 48, section: 80 };

// Floating surfaces: dialogs, menus, tooltips.
export const ELEVATION = "0 24px 64px rgba(0, 0, 0, 0.32)";
export const FOCUS_RING = "#8b8ef0";

// Dark is the default. Every colour a component needs comes from here, so the
// light version is this table with different values.
export const DARK_THEME = {
  mode: "dark",
  canvas: "#0c0f11",
  // Opaque: the lock screen and welcome screens cover the app with it.
  outerBg: "#0c0f11",
  sidebarBg: "rgba(12, 15, 17, 0.82)",
  topbarBg: "rgba(12, 15, 17, 0.68)",
  outerText: "#f4f7f5",
  outerTextMuted: "#919b97",
  outerBorder: "rgba(255, 255, 255, 0.09)",
  outerAccentSoft: "rgba(99, 102, 217, 0.15)",
  bg: "rgba(255, 255, 255, 0.04)",      // inputs, tracks, subtle fills
  hover: "rgba(255, 255, 255, 0.06)",
  surface: "#191c1e",                    // solid: dialogs, menus, tooltips
  cardBg: "linear-gradient(145deg, rgba(31, 35, 37, 0.88), rgba(20, 23, 25, 0.76))",
  heroBg: "linear-gradient(145deg, rgba(34, 34, 39, 0.9), rgba(21, 25, 26, 0.78) 52%, rgba(19, 31, 28, 0.72))",
  warmBg: "linear-gradient(155deg, rgba(31, 33, 35, 0.9), rgba(31, 24, 22, 0.74))",
  modalBg: "linear-gradient(145deg, rgba(31, 35, 37, 0.98), rgba(22, 25, 27, 0.98))",
  cardBorder: "rgba(255, 255, 255, 0.1)",
  cardShadow: "0 24px 64px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.035)",
  border: "rgba(255, 255, 255, 0.09)",
  text: "#f4f7f5",
  textMuted: "#c2cac7",
  textFaint: "#919b97",
  textSoft: "#68726e",
  accent: "#7b7ee9",
  accentStrong: "#6669d7",
  accentSoft: "rgba(99, 102, 217, 0.15)",
  success: "#4fc397",
  successSoft: "rgba(42, 157, 120, 0.14)",
  warning: "#ed8b54",
  warningSoft: "rgba(229, 139, 80, 0.14)",
  danger: "#e26969",
  dangerSoft: "rgba(226, 105, 105, 0.14)",
  addBg: "rgba(99, 102, 217, 0.18)",
  addBgHover: "rgba(99, 102, 217, 0.28)",
  addBorder: "rgba(123, 126, 233, 0.45)",
  addText: "#f4f7f5",
  addGlow: "0 0 24px rgba(99, 102, 217, 0.13)",
  track: "rgba(237, 240, 238, 0.82)",   // the unfilled part of a progress bar
  glowA: "rgba(229, 139, 80, 0.15)",
  glowB: "rgba(42, 157, 120, 0.13)",
  glowC: "rgba(99, 102, 217, 0.12)",
  shadowCard: "0 12px 30px rgba(0, 0, 0, 0.32)",
};

export const LIGHT_THEME = {
  ...DARK_THEME,
  mode: "light",
  canvas: "#f2f4f3",
  outerBg: "#f2f4f3",
  sidebarBg: "rgba(255, 255, 255, 0.72)",
  topbarBg: "rgba(242, 244, 243, 0.72)",
  outerText: "#15191b",
  outerTextMuted: "#69736f",
  outerBorder: "rgba(15, 23, 20, 0.08)",
  outerAccentSoft: "rgba(99, 102, 217, 0.12)",
  bg: "rgba(15, 23, 20, 0.045)",
  hover: "rgba(15, 23, 20, 0.06)",
  surface: "#ffffff",
  cardBg: "linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(250, 251, 250, 0.84))",
  heroBg: "linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(248, 248, 255, 0.86) 52%, rgba(242, 251, 247, 0.84))",
  warmBg: "linear-gradient(155deg, rgba(255, 255, 255, 0.95), rgba(255, 246, 240, 0.86))",
  modalBg: "linear-gradient(145deg, #ffffff, #fbfcfb)",
  cardBorder: "rgba(15, 23, 20, 0.08)",
  cardShadow: "0 18px 48px rgba(20, 30, 25, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.7)",
  border: "rgba(15, 23, 20, 0.09)",
  text: "#15191b",
  textMuted: "#3d4643",
  textFaint: "#69736f",
  textSoft: "#959e9a",
  accent: "#6669d7",
  accentStrong: "#5457c4",
  accentSoft: "rgba(99, 102, 217, 0.12)",
  success: "#24946f",
  successSoft: "rgba(36, 148, 111, 0.12)",
  warning: "#d26a2f",
  warningSoft: "rgba(210, 106, 47, 0.12)",
  danger: "#d14b4b",
  dangerSoft: "rgba(209, 75, 75, 0.1)",
  addBg: "rgba(99, 102, 217, 0.12)",
  addBgHover: "rgba(99, 102, 217, 0.2)",
  addBorder: "rgba(99, 102, 217, 0.35)",
  addText: "#4b4eb8",
  addGlow: "0 0 24px rgba(99, 102, 217, 0.1)",
  track: "rgba(15, 23, 20, 0.08)",
  glowA: "rgba(229, 139, 80, 0.12)",
  glowB: "rgba(42, 157, 120, 0.1)",
  glowC: "rgba(99, 102, 217, 0.1)",
  shadowCard: "0 12px 30px rgba(20, 30, 25, 0.12)",
};

export function makeStyles(theme) {
  const hairline = `1px solid ${theme.border}`;
  const glass = {
    background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, boxShadow: theme.cardShadow,
    backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
  };
  return {
    shell: { display: "flex", height: "100vh", background: theme.canvas, color: theme.text, fontFamily: FONT, overflow: "hidden", position: "relative", isolation: "isolate" },
    sidebar: { width: 244, minWidth: 244, background: theme.sidebarBg, borderRight: `1px solid ${theme.outerBorder}`, backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", padding: `28px ${SPACE.md}px ${SPACE.md}px` },
    logo: { display: "flex", alignItems: "center", gap: 11, padding: "0 10px", flexShrink: 0 },
    nav: { display: "flex", flexDirection: "column", gap: 6, marginTop: 40, flex: "1 0 auto" },
    navItem: { display: "flex", alignItems: "center", gap: 13, padding: "0 13px", height: 44, borderRadius: 11, border: "none", background: "transparent", color: theme.outerTextMuted, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: FONT, textAlign: "left", width: "100%", flexShrink: 0, boxSizing: "border-box" },
    navItemActive: { background: theme.outerAccentSoft, color: theme.accent, fontWeight: 600 },
    badge: { background: theme.warning, color: "#fff", ...TYPE.microLegal, fontWeight: 700, borderRadius: RADIUS.pill, padding: "2px 7px", marginLeft: "auto" },
    main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "transparent" },
    topbar: { padding: `20px ${SPACE.xl}px`, borderBottom: `1px solid ${theme.outerBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: SPACE.md, flexShrink: 0, background: theme.topbarBg, backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" },
    content: { flex: 1, overflow: "auto", background: "transparent", padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.xl}px` },
    contentInner: { maxWidth: 1380, margin: "0 auto" },
    // auto-fit, not a fixed 4: the row carries a 5th card once there are closed
    // months, which overflowed the grid and clipped off the right edge.
    statsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 18, marginBottom: 18 },
    statCard: { ...glass, borderRadius: RADIUS.lg, padding: "20px 22px" },
    dashGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 18 },
    card: { ...glass, borderRadius: RADIUS.lg, padding: "21px 24px" },
    cardTitle: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.2px", color: theme.text },
    cardLabel: { fontSize: 12, fontWeight: 500, color: theme.textFaint },
    linkBtn: { background: "none", border: "none", color: theme.accent, ...TYPE.buttonUtility, cursor: "pointer", fontFamily: FONT, padding: `${SPACE.xs}px 0` },
    searchInput: { width: "100%", boxSizing: "border-box", height: 40, background: theme.bg, border: hairline, borderRadius: 14, padding: `0 ${SPACE.md}px`, ...TYPE.caption, color: theme.text, outline: "none", marginBottom: SPACE.sm, fontFamily: FONT },
    breakdownBar: { display: "flex", height: 8, borderRadius: RADIUS.pill, overflow: "hidden", background: theme.bg, marginTop: SPACE.sm },
    tableHeader: { display: "flex", padding: `${SPACE.sm}px ${SPACE.xs}px`, borderBottom: hairline, marginTop: SPACE.md, ...TYPE.microLegal, textTransform: "uppercase", letterSpacing: "0.7px", color: theme.textFaint, fontWeight: 600 },
    tableRow: { display: "flex", alignItems: "center", padding: `${SPACE.sm}px ${SPACE.xs}px`, minHeight: 56, boxSizing: "border-box", borderBottom: hairline, ...TYPE.caption },
    miniRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACE.sm}px 0`, borderBottom: hairline },
    addBtn: { height: 40, display: "inline-flex", alignItems: "center", gap: 8, background: theme.addBg, color: theme.addText, border: `1px solid ${theme.addBorder}`, borderRadius: 14, padding: "0 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT, boxShadow: theme.addGlow, whiteSpace: "nowrap" },
    themeToggle: { background: theme.bg, border: `1px solid ${theme.outerBorder}`, color: theme.outerText, cursor: "pointer", width: 40, height: 40, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, position: "relative", flexShrink: 0 },
    delBtn: { background: "none", border: "none", color: theme.textFaint, cursor: "pointer", ...TYPE.caption, padding: `${SPACE.xxs}px ${SPACE.xs}px` },
    editBtn: { background: "none", border: "none", color: theme.textMuted, cursor: "pointer", ...TYPE.caption, padding: `${SPACE.xxs}px ${SPACE.xs}px` },
    empty: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.xxl}px ${SPACE.lg}px`, ...TYPE.body },
    emptySmall: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.lg}px 0`, ...TYPE.caption },
    overlay: { position: "fixed", inset: 0, background: theme.mode === "dark" ? "rgba(0,0,0,0.5)" : "rgba(20,30,25,0.28)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: SPACE.lg, boxSizing: "border-box" },
    modal: { background: theme.modalBg, borderRadius: RADIUS.lg, padding: SPACE.xl, width: "100%", maxWidth: 460, maxHeight: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box", border: `1px solid ${theme.cardBorder}`, boxShadow: ELEVATION },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACE.xs, flex: "none" },
    // Bleeds into the dialog's side padding so the scrollbar sits at its edge
    // rather than over the content.
    modalBody: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", margin: `0 -${SPACE.xl}px`, padding: `0 ${SPACE.xl}px` },
    closeBtn: { background: "none", border: "none", color: theme.textFaint, fontSize: 20, cursor: "pointer", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
    input: { width: "100%", background: theme.bg, border: hairline, borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, color: theme.text, ...TYPE.caption, outline: "none", boxSizing: "border-box", fontFamily: FONT, minHeight: 42 },
    saveBtn: { width: "100%", background: theme.accentStrong, color: "#fff", border: "none", borderRadius: 14, padding: "14px 28px", ...TYPE.buttonLarge, cursor: "pointer", marginTop: SPACE.xs, fontFamily: FONT, boxShadow: theme.addGlow },
    catPill: { display: "inline-flex", alignItems: "center", gap: SPACE.xs, padding: `${SPACE.xxs}px ${SPACE.sm}px ${SPACE.xxs}px ${SPACE.xxs}px`, borderRadius: RADIUS.pill, ...TYPE.finePrint, fontWeight: 600 },
    catDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 },
    suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: theme.surface, border: `1px solid ${theme.cardBorder}`, borderRadius: RADIUS.md, boxShadow: ELEVATION, zIndex: 10, maxHeight: 200, overflow: "auto", marginTop: SPACE.xxs },
    suggestItem: { display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.sm}px`, cursor: "pointer", ...TYPE.caption },
    chartEmpty: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.xxl}px ${SPACE.lg}px`, ...TYPE.caption },
    chartTooltip: { background: theme.surface, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: `${SPACE.xs}px ${SPACE.sm}px`, ...TYPE.finePrint, color: theme.text, boxShadow: ELEVATION },
  };
}

const s = makeStyles(DARK_THEME);

export const ThemeContext = createContext({ theme: DARK_THEME, s });
export const useThemed = () => useContext(ThemeContext);
