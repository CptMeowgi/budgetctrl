// Line icons, drawn on a 24-unit grid with round 1.8 strokes in the current
// text colour. The first set follows the Figma design; the rest are drawn to
// match it for screens the design doesn't show.
const PATHS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h11" />
      <path d="M16 12h4M16 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  chart: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  "arrow-up": <path d="m18 15-6-6-6 6" />,
  "arrow-down": <path d="m6 9 6 6 6-6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2 3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="m7 22-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  "money-in": (
    <>
      <path d="M12 3v10m0 0 4-4m-4 4-4-4" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
};

export function Icon({ name, size = 18, style }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: "none", ...style }}>
      {PATHS[name]}
    </svg>
  );
}

// The design's brand mark: three rising bars on a violet-to-green tile.
export function BrandMark({ size = 27 }) {
  const bar = (h) => ({ display: "block", width: 4, height: h, borderRadius: 3, background: "#f4f7f5" });
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, display: "flex", alignItems: "flex-end", gap: 3, padding: 5, boxSizing: "border-box",
      borderRadius: 8, background: "linear-gradient(145deg, #7b7ee9, #4fc397)", boxShadow: "0 0 24px rgba(99,102,217,.24)", flex: "none",
    }}>
      <span style={bar(7)} /><span style={bar(13)} /><span style={bar(10)} />
    </div>
  );
}
