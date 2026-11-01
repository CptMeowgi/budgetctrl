// Sealing a budget: a private budget is encrypted with a random 256-bit key,
// and that key is wrapped (encrypted in turn) by the password and by a
// recovery code. Only the wrapped keys and the sealed data are ever kept.
// The password, the recovery code and the unwrapped key are never stored, put
// in localStorage or logged; they live in memory while the budget is open.
//
// PBKDF2 is slow on purpose. A password gets 600000 rounds; the recovery code
// is 120 random bits, so 10000 are plenty and it can be checked quickly.

export const PASSWORD_MIN = 8;
export const ITERATIONS = 600000;
export const RECOVERY_ITERATIONS = 10000;

// A stored count above this is a damaged or hand-edited file, not a real one;
// refusing it keeps an unlock from hanging on a crafted record.
const MAX_ITERATIONS = 10000000;

// Crockford base32: no I, L, O or U, so a code read off paper has no look-alikes.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Built in slices: spreading a whole sealed budget into one call overflows the stack.
const toB64 = (bytes) => {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// The same word can be typed as one character or as a letter plus a mark, so
// both are brought to one form. Spaces count, and nothing is trimmed.
export function normalizePassword(pw) {
  return String(pw ?? "").normalize("NFC");
}

// Counted in code points after normalising, not bytes.
export function validPassword(pw) {
  return [...normalizePassword(pw)].length >= PASSWORD_MIN;
}

export function passwordProblem(pw, again) {
  if (!validPassword(pw)) return `Use at least ${PASSWORD_MIN} characters.`;
  if (normalizePassword(pw) !== normalizePassword(again)) return "The two passwords don't match.";
  return null;
}

export function newBudgetKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// A budget key is exactly 32 bytes. Anything else is a bug in the caller, and
// WebCrypto would otherwise happily seal with a shorter AES key.
function checkKey(key) {
  if (key?.length !== 32) throw new TypeError("A budget key is 32 bytes.");
}

// An undefined or empty secret would quietly become the guessable text
// "undefined" or nothing at all, so it is refused rather than coerced.
function checkSecret(secret) {
  if (typeof secret !== "string" || !secret) throw new TypeError("A password or recovery code is needed.");
}

const validIterations = (n) => Number.isInteger(n) && n > 0 && n <= MAX_ITERATIONS;

const aesKey = (bytes, usage) => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [usage]);

async function encrypt(plain, keyBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyBytes, "encrypt"), plain);
  return { iv: toB64(iv), data: toB64(data) };
}

// Rejects on the wrong key or on any change to the data: AES-GCM checks both.
async function decrypt({ iv, data }, keyBytes) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(keyBytes, "decrypt"), fromB64(data));
}

// A fresh IV each time, so sealing the same budget twice never looks alike.
// Async so a bad key or a doc that cannot become JSON is a rejected promise.
export async function sealBudget(doc, key) {
  checkKey(key);
  return encrypt(new TextEncoder().encode(JSON.stringify(doc)), key);
}

export async function openSealed(sealed, key) {
  checkKey(key);
  return JSON.parse(new TextDecoder().decode(await decrypt(sealed, key)));
}

async function secretKey(secret, salt, iterations, usage) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-GCM", length: 256 }, false, [usage],
  );
}

// The caller passes normalizePassword(pw) with ITERATIONS, or
// normalizeRecoveryCode(code) with RECOVERY_ITERATIONS. The count is kept in
// the record, so changing the default later never locks anyone out.
export async function wrapKey(key, secret, iterations) {
  checkKey(key);
  checkSecret(secret);
  // A count that unwrapKey would refuse must never be written, or the key
  // could never be opened again.
  if (!validIterations(iterations)) throw new RangeError("The iteration count is out of range.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await secretKey(secret, salt, iterations, "encrypt"), key);
  return { v: 1, salt: toB64(salt), iterations, iv: toB64(iv), data: toB64(data) };
}

// null for a wrong secret or a damaged record, so the caller only has to tell
// "not this one" from "opened". Only the final decrypt failing means a wrong
// secret; anything else (no crypto.subtle, a secret that is not text) is a
// real fault and throws instead of passing for a wrong password.
export async function unwrapKey(wrapped, secret) {
  if (typeof secret !== "string") throw new TypeError("A password or recovery code is needed.");
  if (!secret || !validIterations(wrapped?.iterations)) return null;
  let salt, iv, data;
  try {
    salt = fromB64(wrapped.salt);
    iv = fromB64(wrapped.iv);
    data = fromB64(wrapped.data);
  } catch {
    return null;
  }
  if (salt.length !== 16 || iv.length !== 12) return null;
  const k = await secretKey(secret, salt, wrapped.iterations, "decrypt");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, data));
  } catch {
    return null;
  }
}

const regroup = (s) => s.match(/.{1,4}/g).join("-");

// 24 characters of 5 bits each is 120 bits. 32 divides 256, so taking the low
// five bits of a random byte is not biased towards any character.
export function makeRecoveryCode() {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => ALPHABET[b & 31]);
  return regroup(chars.join(""));
}

// Accept what a person types from paper: any case, spaces or dashes anywhere,
// and the look-alikes the alphabet leaves out (O for 0, I or L for 1).
export function normalizeRecoveryCode(input) {
  const clean = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return clean ? regroup(clean) : "";
}
