import { createContext, useContext } from "react";

// ---- Apple design tokens -------------------------------------------------
// Transcribed from the Apple DESIGN.md spec. Kept as tokens rather than inlined
// so the scale is enforced instead of approximated per component.

// SF Pro where the platform has it (macOS/iOS), DM Sans elsewhere - the app
// already loads DM Sans and SF Pro is not licensable for web delivery.
export const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', 'Segoe UI', sans-serif";

// Weight ladder is 300/400/600/700. 500 is deliberately absent from the spec.
export const TYPE = {
  displayLarge:  { fontSize: 40, fontWeight: 600, lineHeight: 1.10, letterSpacing: "0" },
  displayMedium: { fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.374px" },
  lead:          { fontSize: 28, fontWeight: 400, lineHeight: 1.14, letterSpacing: "0.196px" },
  leadAiry:      { fontSize: 24, fontWeight: 300, lineHeight: 1.5,  letterSpacing: "0" },
  tagline:       { fontSize: 21, fontWeight: 600, lineHeight: 1.19, letterSpacing: "0.231px" },
  bodyStrong:    { fontSize: 17, fontWeight: 600, lineHeight: 1.24, letterSpacing: "-0.374px" },
  body:          { fontSize: 17, fontWeight: 400, lineHeight: 1.47, letterSpacing: "-0.374px" },
  caption:       { fontSize: 14, fontWeight: 400, lineHeight: 1.43, letterSpacing: "-0.224px" },
  captionStrong: { fontSize: 14, fontWeight: 600, lineHeight: 1.29, letterSpacing: "-0.224px" },
  buttonLarge:   { fontSize: 18, fontWeight: 300, lineHeight: 1.0,  letterSpacing: "0" },
  buttonUtility: { fontSize: 14, fontWeight: 400, lineHeight: 1.29, letterSpacing: "-0.224px" },
  finePrint:     { fontSize: 12, fontWeight: 400, lineHeight: 1.0,  letterSpacing: "-0.12px" },
  microLegal:    { fontSize: 10, fontWeight: 400, lineHeight: 1.3,  letterSpacing: "-0.08px" },
  navLink:       { fontSize: 12, fontWeight: 400, lineHeight: 1.0,  letterSpacing: "-0.12px" },
};

export const RADIUS = { none: 0, xs: 5, sm: 8, md: 11, lg: 18, pill: 9999 };
export const SPACE = { xxs: 4, xs: 8, sm: 12, md: 17, lg: 24, xl: 32, xxl: 48, section: 80 };

// The spec allows exactly one drop shadow, reserved for floating surfaces.
// Cards get a hairline border instead - alternating surfaces act as dividers.
export const ELEVATION = "rgba(0, 0, 0, 0.22) 3px 5px 30px 0";
export const FOCUS_BLUE = "#0071e3";
export const CHIP_GRAY = "rgba(210, 210, 215, 0.64)";

const THEME = {
  bg: "#f5f5f7",          // Parchment
  surface: "#ffffff",     // Pure White
  border: "#e0e0e0",      // Hairline
  text: "#1d1d1f",        // Near-Black Ink
  textMuted: "#333333",   // Ink Muted 80
  textFaint: "#7a7a7a",   // Ink Muted 48
  accent: "#0066cc",      // Action Blue - the single accent
  accentSoft: "rgba(0,102,204,0.08)",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  shadowCard: "none",
  outerBg: "#000000",
  outerText: "#ffffff",
  outerTextMuted: "#cccccc",
  outerBorder: "#2a2a2c",
  outerAccentSoft: "rgba(41,151,255,0.15)",
};

// Full light theme — inner panel light AND outer frame light.
export const LIGHT_THEME = {
  ...THEME,
  outerBg: "#ffffff",
  outerText: "#1d1d1f",
  outerTextMuted: "#7a7a7a",
  outerBorder: "#e0e0e0",
  outerAccentSoft: "rgba(0,102,204,0.08)",
};

// Full dark theme — everything dark.
export const DARK_THEME = {
  ...LIGHT_THEME,
  // Global-nav black frame, near-black tiles for content and cards.
  outerBg: "#000000",
  outerText: "#ffffff",
  outerTextMuted: "#cccccc",
  outerBorder: "#2a2a2c",
  outerAccentSoft: "rgba(41,151,255,0.18)",
  bg: "#1d1d1f",
  surface: "#272729",     // Near-Black Tile 1
  border: "#3a3a3c",
  text: "#ffffff",
  textMuted: "#cccccc",   // Body Muted
  textFaint: "#8a8a8e",
  accent: "#2997ff",      // Sky Link Blue, for links on dark surfaces
  accentSoft: "rgba(41,151,255,0.18)",
  shadowCard: "none",
};

export function makeStyles(theme) {
  const hairline = `1px solid ${theme.border}`;
  return {
    shell: { display: "flex", height: "100vh", background: theme.outerBg, color: theme.text, fontFamily: FONT, overflow: "hidden" },
    sidebar: { width: 240, minWidth: 240, background: theme.outerBg, borderRight: "none", display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto", overflowX: "hidden" },
    logo: { padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px`, borderBottom: `1px solid ${theme.outerBorder}`, flexShrink: 0 },
    nav: { padding: `${SPACE.sm}px ${SPACE.sm}px`, display: "flex", flexDirection: "column", gap: SPACE.xxs, flex: "1 0 auto" },
    navItem: { display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.xs}px ${SPACE.md}px`, borderRadius: RADIUS.md, border: "none", background: "transparent", color: theme.outerTextMuted, ...TYPE.caption, cursor: "pointer", fontFamily: FONT, textAlign: "left", width: "100%", flexShrink: 0, minHeight: 44, boxSizing: "border-box" },
    navItemActive: { background: theme.outerAccentSoft, color: theme.outerText, fontWeight: 600 },
    badge: { background: theme.warning, color: "#fff", ...TYPE.microLegal, fontWeight: 600, borderRadius: RADIUS.pill, padding: "2px 8px", marginLeft: "auto" },
    main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: theme.outerBg },
    topbar: { padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.md}px`, borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: theme.outerBg },
    content: { flex: 1, overflow: "auto", background: theme.bg, borderRadius: RADIUS.lg, margin: `0 ${SPACE.md}px ${SPACE.md}px 0`, padding: SPACE.xl },
    contentInner: { maxWidth: 1440, margin: "0 auto" },
    // auto-fit, not a fixed 4: the row carries a 5th card once there are closed
    // months, which overflowed the grid and clipped off the right edge.
    statsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: SPACE.md, marginBottom: SPACE.lg },
    statCard: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.lg, border: hairline, boxShadow: "none" },
    dashGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: SPACE.md },
    card: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.lg, border: hairline, boxShadow: "none" },
    cardTitle: { ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.8px", color: theme.textFaint, fontWeight: 600 },
    linkBtn: { background: "none", border: "none", color: theme.accent, ...TYPE.buttonUtility, cursor: "pointer", fontFamily: FONT, padding: `${SPACE.xs}px 0` },
    searchInput: { width: "100%", boxSizing: "border-box", height: 44, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: RADIUS.pill, padding: `0 ${SPACE.lg}px`, ...TYPE.caption, color: theme.text, outline: "none", marginBottom: SPACE.sm, fontFamily: FONT },
    breakdownBar: { display: "flex", height: SPACE.sm, borderRadius: RADIUS.pill, overflow: "hidden", background: theme.bg, marginTop: SPACE.sm },
    tableHeader: { display: "flex", padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: hairline, marginTop: SPACE.md, ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", color: theme.textFaint, fontWeight: 600 },
    tableRow: { display: "flex", alignItems: "center", padding: `${SPACE.md}px ${SPACE.md}px`, borderBottom: hairline, ...TYPE.caption },
    miniRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACE.sm}px 0`, borderBottom: hairline },
    addBtn: { background: theme.accent, color: "#fff", border: "none", borderRadius: RADIUS.pill, padding: "11px 22px", ...TYPE.caption, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
    themeToggle: { background: "transparent", border: "none", color: theme.outerText, fontSize: 17, cursor: "pointer", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 },
    delBtn: { background: "none", border: "none", color: theme.textFaint, cursor: "pointer", ...TYPE.caption, padding: `${SPACE.xxs}px ${SPACE.xs}px` },
    editBtn: { background: "none", border: "none", color: theme.textMuted, cursor: "pointer", ...TYPE.caption, padding: `${SPACE.xxs}px ${SPACE.xs}px` },
    empty: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.xxl}px ${SPACE.lg}px`, ...TYPE.body },
    emptySmall: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.lg}px 0`, ...TYPE.caption },
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: SPACE.lg, boxSizing: "border-box" },
    modal: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.xl, width: "100%", maxWidth: 460, maxHeight: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box", border: hairline, boxShadow: ELEVATION },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACE.xs, flex: "none" },
    // Bleeds into the dialog's side padding so the scrollbar sits at its edge
    // rather than over the content.
    modalBody: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", margin: `0 -${SPACE.xl}px`, padding: `0 ${SPACE.xl}px` },
    closeBtn: { background: "none", border: "none", color: theme.textFaint, fontSize: 20, cursor: "pointer", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
    input: { width: "100%", background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, color: theme.text, ...TYPE.caption, outline: "none", boxSizing: "border-box", fontFamily: FONT, minHeight: 44 },
    saveBtn: { width: "100%", background: theme.accent, color: "#fff", border: "none", borderRadius: RADIUS.pill, padding: "14px 28px", ...TYPE.buttonLarge, cursor: "pointer", marginTop: SPACE.xs, fontFamily: FONT },
    catPill: { display: "inline-flex", alignItems: "center", gap: SPACE.xs, padding: `${SPACE.xxs}px ${SPACE.sm}px ${SPACE.xxs}px ${SPACE.xxs}px`, borderRadius: RADIUS.pill, ...TYPE.finePrint, fontWeight: 600 },
    catDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 },
    suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: theme.surface, border: hairline, borderRadius: RADIUS.md, boxShadow: ELEVATION, zIndex: 10, maxHeight: 200, overflow: "auto", marginTop: SPACE.xxs },
    suggestItem: { display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.sm}px`, cursor: "pointer", ...TYPE.caption },
    chartEmpty: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.xxl}px ${SPACE.lg}px`, ...TYPE.caption },
    chartTooltip: { background: theme.surface, border: hairline, borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, ...TYPE.caption, color: theme.text, boxShadow: ELEVATION },
  };
}

const s = makeStyles(LIGHT_THEME);

export const ThemeContext = createContext({ theme: LIGHT_THEME, s });
export const useThemed = () => useContext(ThemeContext);
