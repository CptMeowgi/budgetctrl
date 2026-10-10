// The parts of updating that are decisions rather than plumbing: when to look
// for an update, how far a download has got, and what to tell someone when it
// goes wrong. The plugin calls themselves live in the app.

// The app lives in the tray for days at a time, so it looks once a day rather
// than only at launch - and never more often, however many times it starts.
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export function dueForCheck(lastCheckedAt, now, everyMs = CHECK_EVERY_MS) {
  if (!Number.isFinite(lastCheckedAt) || lastCheckedAt <= 0) return true;
  // A clock set backwards would otherwise silence checks until it caught up.
  if (lastCheckedAt > now) return true;
  return now - lastCheckedAt >= everyMs;
}

// Whole percent, or null while the size is unknown - a progress bar should say
// "downloading" rather than invent a figure.
export function progressPercent(downloaded, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100)));
}

// The updater reports failures as raw Rust error text. These are the ones a
// person can act on, in words they can act on.
export function describeUpdateError(err, doing = "checking for updates") {
  const raw = String(err?.message ?? err ?? "");
  if (/signature/i.test(raw)) {
    return "The update's signature didn't match, so it wasn't installed.";
  }
  if (/valid release JSON|404|not found|status code/i.test(raw)) {
    return "No update has been published yet.";
  }
  if (/sending request|dns|connect|timed? ?out|network|offline|unreachable/i.test(raw)) {
    return "Couldn't reach GitHub. Check your internet connection.";
  }
  return `Something went wrong while ${doing}.`;
}

// "just now", "5 minutes ago", "3 hours ago", "2 days ago".
export function agoLabel(then, now) {
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

// Release notes arrive as the changelog's Markdown. The app shows them as plain
// lines - headings, bullets, text - with the emphasis marks taken out, rather
// than pulling in a Markdown renderer for one panel.
export function notesToLines(markdown) {
  const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
  const lines = [];
  let para = [];
  const flush = () => {
    if (para.length) lines.push({ kind: "text", text: clean(para.join(" ")) });
    para = [];
  };
  for (const raw of String(markdown || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (heading) { flush(); lines.push({ kind: "heading", text: clean(heading[1]) }); }
    else if (bullet) { flush(); lines.push({ kind: "bullet", text: clean(bullet[1]) }); }
    else if (raw.startsWith("  ") && lines.length && lines[lines.length - 1].kind === "bullet" && !para.length) {
      // A wrapped bullet continues on an indented line.
      lines[lines.length - 1].text += ` ${clean(line)}`;
    } else para.push(line);
  }
  flush();
  return lines;
}
