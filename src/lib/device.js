// This computer's settings. The language and whether to look for updates
// belong to the computer, not to a budget: kept in a budget file, two
// computers sharing it would keep overwriting each other's choice. They live
// in localStorage, and until one is chosen on this computer the household's
// old setting (`language`, `updates.auto`) stands in for it, so nothing
// changes for anyone who chose before.

const LANGUAGE_KEY = "budget-ctrl-language";
const AUTO_UPDATE_KEY = "budget-ctrl-auto-update";

const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* nowhere to keep it: the household's setting stands */ }
};

// "" is the system's language, a choice of its own.
export function deviceLanguage(household) {
  const chosen = read(LANGUAGE_KEY);
  return chosen !== null ? chosen : household?.language || "";
}

export function setDeviceLanguage(code) {
  write(LANGUAGE_KEY, typeof code === "string" ? code : "");
}

// On unless turned off, as it always was.
export function deviceAutoUpdate(household) {
  const chosen = read(AUTO_UPDATE_KEY);
  if (chosen === "true" || chosen === "false") return chosen === "true";
  return household?.updates?.auto !== false;
}

export function setDeviceAutoUpdate(on) {
  write(AUTO_UPDATE_KEY, on ? "true" : "false");
}
