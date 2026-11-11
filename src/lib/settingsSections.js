// The sections of the Settings window, in the order they are listed.
export const SETTINGS_SECTIONS = [
  { id: "budget" },
  { id: "reminders" },
  { id: "data" },
  { id: "app" },
  { id: "privacy" },
  { id: "about" },
];

// Where an arrow, Home or End key moves the list from `index`, or null for
// any other key. The list wraps round at both ends.
export function sectionAfterKey(index, key, count = SETTINGS_SECTIONS.length) {
  if (key === "ArrowDown" || key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
