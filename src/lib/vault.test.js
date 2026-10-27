import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN, ITERATIONS, RECOVERY_ITERATIONS,
  normalizePassword, validPassword, passwordProblem,
  newBudgetKey, sealBudget, openSealed, wrapKey, unwrapKey,
  makeRecoveryCode, normalizeRecoveryCode,
} from "./vault.js";

// Real values are slow on purpose; tests use a cheap count.
const FAST = 1000;

const doc = { name: "Zakupy spożywcze", currency: "€", note: "CANARY-7Q", items: [1, 2, 3] };

describe("constants", () => {
  it("keeps the agreed strength", () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(ITERATIONS).toBe(600000);
    expect(RECOVERY_ITERATIONS).toBe(10000);
  });
});

describe("newBudgetKey", () => {
  it("is 32 fresh random bytes", () => {
    const [a, b] = [newBudgetKey(), newBudgetKey()];
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("sealBudget / openSealed", () => {
  it("opens again intact, and the sealed text never shows the content", async () => {
    const key = newBudgetKey();
    const sealed = await sealBudget(doc, key);
    expect(JSON.stringify(sealed)).not.toContain("CANARY-7Q");
    expect(JSON.stringify(sealed)).not.toContain("Zakupy");
    expect(await openSealed(sealed, key)).toEqual(doc);
  });

  it("seals the same budget differently every time", async () => {
    const key = newBudgetKey();
    const [a, b] = [await sealBudget(doc, key), await sealBudget(doc, key)];
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("refuses the wrong key", async () => {
    const sealed = await sealBudget(doc, newBudgetKey());
    await expect(openSealed(sealed, newBudgetKey())).rejects.toThrow();
  });

  it("refuses data that was changed", async () => {
    const key = newBudgetKey();
    const sealed = await sealBudget(doc, key);
    const bytes = Uint8Array.from(atob(sealed.data), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    const changed = { ...sealed, data: btoa(String.fromCharCode(...bytes)) };
    await expect(openSealed(changed, key)).rejects.toThrow();
  });

  it("seals a budget far bigger than one function call can spread", async () => {
    const key = newBudgetKey();
    const big = { rows: Array.from({ length: 20000 }, (_, i) => ({ i, memo: "Zakupy spożywcze " + i })) };
    expect(await openSealed(await sealBudget(big, key), key)).toEqual(big);
  });
});

describe("wrapKey / unwrapKey with a password", () => {
  it("unwraps with the same text typed another way, never when trimmed", async () => {
    const key = newBudgetKey();
    const wrapped = await wrapKey(key, normalizePassword(" zażółć gęślą "), FAST);
    expect(JSON.stringify(wrapped)).not.toContain("zażółć");

    const nfd = await unwrapKey(wrapped, normalizePassword(" zażółć gęślą ".normalize("NFD")));
    expect(Array.from(nfd)).toEqual(Array.from(key));

    expect(await unwrapKey(wrapped, normalizePassword("zażółć gęślą"))).toBeNull();
  });

  it("gives null, not a throw, for a wrong secret or a broken record", async () => {
    const wrapped = await wrapKey(newBudgetKey(), "correct horse", FAST);
    expect(await unwrapKey(wrapped, "wrong horse")).toBeNull();
    expect(await unwrapKey({ ...wrapped, data: "not base64!" }, "correct horse")).toBeNull();
    expect(await unwrapKey(null, "correct horse")).toBeNull();
  });

  it("wraps the same key differently each time", async () => {
    const key = newBudgetKey();
    const [a, b] = [await wrapKey(key, "same secret", FAST), await wrapKey(key, "same secret", FAST)];
    expect(a.salt).not.toBe(b.salt);
    expect(a.data).not.toBe(b.data);
  });

  it("remembers its own iteration count, so a later change never locks anyone out", async () => {
    const key = newBudgetKey();
    const wrapped = await wrapKey(key, "same secret", FAST);
    expect(wrapped.iterations).toBe(FAST);
    expect(Array.from(await unwrapKey(wrapped, "same secret"))).toEqual(Array.from(key));
  });
});

describe("recovery codes", () => {
  it("are 24 characters in six groups of four, from the unambiguous alphabet", () => {
    expect(makeRecoveryCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  });

  it("differ every time", () => {
    expect(makeRecoveryCode()).not.toBe(makeRecoveryCode());
  });

  it("read back from lowercase, spaces, and O or L typed for 0 and 1", () => {
    const code = makeRecoveryCode();
    const typed = code.toLowerCase().replaceAll("-", " ").replaceAll("0", "o").replaceAll("1", "l");
    expect(normalizeRecoveryCode(typed)).toBe(code);
    expect(normalizeRecoveryCode(code.replaceAll("1", "I"))).toBe(code);
  });

  it("unlock a key wrapped with the code as typed", async () => {
    const key = newBudgetKey();
    const code = makeRecoveryCode();
    const wrapped = await wrapKey(key, normalizeRecoveryCode(code), FAST);
    const typed = code.toLowerCase().replaceAll("-", "").replaceAll("0", "o").replaceAll("1", "l");
    expect(Array.from(await unwrapKey(wrapped, normalizeRecoveryCode(typed)))).toEqual(Array.from(key));
  });
});

describe("password rules", () => {
  it("counts characters you can see, not bytes", () => {
    expect(validPassword("1234567")).toBe(false);
    expect(validPassword("zażółćgę")).toBe(true);
    // Eight letters, 16 bytes; seven letters with a combining mark is still seven.
    expect(validPassword("zażółćg")).toBe(false);
    expect(validPassword("zażółćg".normalize("NFD"))).toBe(false);
  });

  it("does not trim", () => {
    expect(validPassword("       a")).toBe(true);
    expect(normalizePassword(" a ")).toBe(" a ");
  });

  it("says what is wrong, or nothing", () => {
    expect(passwordProblem("short", "short")).toBe("Use at least 8 characters.");
    expect(passwordProblem("long enough", "long enougH")).toBe("The two passwords don't match.");
    expect(passwordProblem("long enough", "long enough")).toBeNull();
  });
});
