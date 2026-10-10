import { describe, it, expect } from "vitest";
import { validPin, hashPin, makeLock, checkPin, retryDelayMs } from "./lock.js";

describe("validPin", () => {
  it("takes 4 to 8 digits and nothing else", () => {
    expect(validPin("1234")).toBe(true);
    expect(validPin("12345678")).toBe(true);
    expect(validPin("123")).toBe(false);
    expect(validPin("123456789")).toBe(false);
    expect(validPin("12a4")).toBe(false);
    expect(validPin(" 1234")).toBe(false);
    expect(validPin(undefined)).toBe(false);
  });
});

describe("makeLock / checkPin", () => {
  it("keeps a hash, never the PIN", async () => {
    const lock = await makeLock("4821");
    expect(JSON.stringify(lock)).not.toContain("4821");
    expect(lock).toMatchObject({ v: 1, iterations: 150000, idleMinutes: 5, lockWhenHidden: true });
  });

  it("accepts the right PIN and refuses a wrong one", async () => {
    const lock = await makeLock("4821");
    expect(await checkPin(lock, "4821")).toBe(true);
    expect(await checkPin(lock, "4822")).toBe(false);
    expect(await checkPin(lock, "48211")).toBe(false);
    expect(await checkPin(null, "4821")).toBe(false);
  });

  it("salts each lock, so one PIN never hashes the same twice", async () => {
    const [a, b] = await Promise.all([makeLock("1111"), makeLock("1111")]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("refuses to make a lock from a bad PIN", async () => {
    await expect(makeLock("12")).rejects.toThrow();
  });

  it("keeps the chosen settings", async () => {
    expect(await makeLock("1234", { idleMinutes: 15, lockWhenHidden: false })).toMatchObject({ idleMinutes: 15, lockWhenHidden: false });
  });

  it("hashes the same PIN and salt the same way", async () => {
    const salt = btoa("0123456789abcdef");
    expect(await hashPin("1234", salt, 1000)).toBe(await hashPin("1234", salt, 1000));
  });
});

describe("retryDelayMs", () => {
  it("lets four mistakes go, then makes you wait longer each time, up to five minutes", () => {
    expect(retryDelayMs(4)).toBe(0);
    expect(retryDelayMs(5)).toBe(30000);
    expect(retryDelayMs(6)).toBe(60000);
    expect(retryDelayMs(20)).toBe(300000);
  });
});
