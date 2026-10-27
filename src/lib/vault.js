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

// Counted in characters you can see, not bytes.
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
export function sealBudget(doc, key) {
  return encrypt(new TextEncoder().encode(JSON.stringify(doc)), key);
}

export async function openSealed(sealed, key) {
  return JSON.parse(new TextDecoder().decode(await decrypt(sealed, key)));
}

async function secretKey(secret, salt, iterations, usage) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-GCM", length: 256 }, false, [usage],
  );
}

// The caller passes normalizePassword(pw) with ITERATIONS, or
// normalizeRecoveryCode(code) with RECOVERY_ITERATIONS. The count is kept in
// the record, so changing the default later never locks anyone out.
export async function wrapKey(key, secret, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await secretKey(secret, salt, iterations, "encrypt"), key);
  return { v: 1, salt: toB64(salt), iterations, iv: toB64(iv), data: toB64(data) };
}

// null for a wrong secret (or a damaged record), never a throw, so the caller
// only has to tell "not this one" from "opened".
export async function unwrapKey(wrapped, secret) {
  try {
    const k = await secretKey(secret, fromB64(wrapped.salt), wrapped.iterations, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(wrapped.iv) }, k, fromB64(wrapped.data));
    return new Uint8Array(plain);
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
