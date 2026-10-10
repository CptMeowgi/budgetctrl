

// Referenced by the storage shim at the top of the file, which is safe because
// those closures only run after this module has finished evaluating.
export const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export async function getAppWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}
