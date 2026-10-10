// App lock: a PIN that keeps the app closed to anyone else at this computer.
// The PIN is never stored, only a salted PBKDF2 hash of it - slow on purpose,
// so a copied lock file cannot be brute-forced in a blink. It does not encrypt
// the budget itself; the settings say so plainly.

export const PIN_MIN = 4;
export const PIN_MAX = 8;
const ITERATIONS = 150000;

export function validPin(pin) {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(String(pin || ""));
}

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPin(pin, saltB64, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations }, key, 256);
  return toB64(bits);
}

// The stored lock: never the PIN, only what checks it.
export async function makeLock(pin, settings = {}) {
  if (!validPin(pin)) throw new Error(`A PIN is ${PIN_MIN} to ${PIN_MAX} digits.`);
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  return {
    v: 1, salt, iterations: ITERATIONS, hash: await hashPin(pin, salt, ITERATIONS),
    idleMinutes: settings.idleMinutes ?? 5,
    lockWhenHidden: settings.lockWhenHidden ?? true,
  };
}

export async function checkPin(lock, pin) {
  if (!lock?.hash || !validPin(pin)) return false;
  const h = await hashPin(pin, lock.salt, lock.iterations || ITERATIONS);
  // Same length always; compare every character so the time taken does not
  // depend on where the first difference is.
  let diff = h.length ^ lock.hash.length;
  for (let i = 0; i < Math.min(h.length, lock.hash.length); i++) diff |= h.charCodeAt(i) ^ lock.hash.charCodeAt(i);
  return diff === 0;
}

// After five wrong tries in a row, wait - 30 seconds, then doubling, up to five
// minutes - before the next.
export function retryDelayMs(failures) {
  if (failures < 5) return 0;
  return Math.min(5 * 60 * 1000, 30 * 1000 * 2 ** (failures - 5));
}
