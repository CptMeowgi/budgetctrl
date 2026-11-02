import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceAutoUpdate, deviceLanguage, setDeviceAutoUpdate, setDeviceLanguage } from "./device.js";

// vitest runs these in Node, which has no localStorage here.
const memory = () => {
  const store = new Map();
  vi.stubGlobal("localStorage", { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) });
  return store;
};

afterEach(() => vi.unstubAllGlobals());

describe("this computer's language", () => {
  it("is the household's while nothing is chosen on this computer", () => {
    memory();
    expect(deviceLanguage({ language: "pl" })).toBe("pl");
    expect(deviceLanguage({})).toBe("");
    expect(deviceLanguage(null)).toBe("");
  });

  it("is the one chosen here once there is one, whatever the household says", () => {
    const store = memory();
    setDeviceLanguage("de");
    expect(deviceLanguage({ language: "pl" })).toBe("de");
    expect(store.get("budget-ctrl-language")).toBe("de");
  });

  it("keeps the system default as a choice of its own", () => {
    memory();
    setDeviceLanguage("");
    expect(deviceLanguage({ language: "pl" })).toBe("");
  });

  it("is the household's when there is no storage, or it throws", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(deviceLanguage({ language: "es" })).toBe("es");
    expect(() => setDeviceLanguage("de")).not.toThrow();
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(deviceLanguage({ language: "es" })).toBe("es");
    expect(() => setDeviceLanguage("de")).not.toThrow();
  });
});

describe("this computer's automatic update checks", () => {
  it("are the household's while nothing is chosen on this computer", () => {
    memory();
    expect(deviceAutoUpdate({ updates: { auto: false } })).toBe(false);
    expect(deviceAutoUpdate({ updates: { auto: true } })).toBe(true);
    // On unless turned off, as they always were.
    expect(deviceAutoUpdate({})).toBe(true);
    expect(deviceAutoUpdate(null)).toBe(true);
  });

  it("are the choice made here once there is one, whatever the household says", () => {
    const store = memory();
    setDeviceAutoUpdate(false);
    expect(deviceAutoUpdate({ updates: { auto: true } })).toBe(false);
    expect(store.get("budget-ctrl-auto-update")).toBe("false");
    setDeviceAutoUpdate(true);
    expect(deviceAutoUpdate({ updates: { auto: false } })).toBe(true);
    expect(store.get("budget-ctrl-auto-update")).toBe("true");
  });

  it("are the household's when there is no storage, or it throws", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(deviceAutoUpdate({ updates: { auto: false } })).toBe(false);
    expect(() => setDeviceAutoUpdate(true)).not.toThrow();
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(deviceAutoUpdate({ updates: { auto: false } })).toBe(false);
    expect(() => setDeviceAutoUpdate(true)).not.toThrow();
  });
});
