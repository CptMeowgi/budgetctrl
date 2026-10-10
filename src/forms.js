

// Optional free text on any entry. Blank is stored as absent, not "".
export function cleanNote(s) {
  const v = (s || "").trim();
  return v || undefined;
}

export const NOTE_FIELD = (editing) => ({ key: "note", label: "Note", type: "textarea", placeholder: "Optional — reference, who, why", defaultValue: editing?.note });
