

// Referenced by the storage shim at the top of the file, which is safe because
// those closures only run after this module has finished evaluating.
export const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export const isWindows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

// Linux draws the app with WebKitGTK, which may paint large blurs on the
// processor rather than the graphics card.
export const isLinux = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

export async function getAppWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}
