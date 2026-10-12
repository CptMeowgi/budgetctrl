

// Referenced by the storage shim at the top of the file, which is safe because
// those closures only run after this module has finished evaluating.
export const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export const isWindows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

// Linux draws the app with WebKitGTK, which may paint large blurs on the
// processor rather than the graphics card.
export const isLinux = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

// Opens a web page in the person's browser. In the app, only this project's
// GitHub pages are allowed (see capabilities/default.json). Resolves to false
// when it couldn't, so the caller can show the address instead.
export async function openExternal(url) {
  try {
    if (isTauri) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
    return true;
  } catch {
    return false;
  }
}

export async function getAppWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}
