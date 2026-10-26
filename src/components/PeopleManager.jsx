import { useContext, useState } from "react";
import { DeleteArmContext } from "../contexts.js";
import { t } from "../i18n.js";
import { addPerson, peopleOf, removePerson, renamePerson } from "../lib/people.js";
import { uid } from "../model.js";
import { SPACE, useThemed } from "../theme.js";

// The people who share this budget, in Settings. `onChange(nextData)` saves.
// Names are edited in place and written back when the field loses focus or
// Enter is pressed; Escape puts the old name back.
export function PeopleManager({ data, onChange }) {
  const { theme, s } = useThemed();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const people = peopleOf(data);

  const add = () => {
    const next = addPerson(data, name, uid);
    if (next === data) return;
    onChange(next);
    setName("");
    setAdding(false);
  };

  return (
    <div style={{ padding: `${SPACE.xs}px 0` }}>
      {/* Keyed on the name too, so a rename that is undone shows the old name. */}
      {people.map((p) => (
        <PersonRow key={`${p.id}:${p.name}`} person={p}
          onRename={(next) => onChange(renamePerson(data, p.id, next))}
          onRemove={() => onChange(removePerson(data, p.id))} />
      ))}
      {adding ? (
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.xs}px 0` }}>
          <input autoFocus value={name} placeholder={t("Name")} aria-label={t("Name")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") { e.stopPropagation(); setAdding(false); setName(""); }
            }}
            style={{ ...s.input, flex: 1, minHeight: 34, padding: "6px 10px" }} />
          <button style={{ ...s.linkBtn, opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()} onClick={add}>{t("Add")}</button>
          <button style={s.linkBtn} onClick={() => { setAdding(false); setName(""); }}>{t("Cancel")}</button>
        </div>
      ) : (
        <button style={{ ...s.linkBtn, padding: `${SPACE.xs}px 0` }} onClick={() => setAdding(true)}>{t("+ Add person")}</button>
      )}
      <div style={{ fontSize: 11, color: theme.textMuted, marginTop: SPACE.xs }}>
        {t("Add the people you share this budget with. With two or more, every entry can say who paid.")}
      </div>
    </div>
  );
}

function PersonRow({ person, onRename, onRemove }) {
  const { theme, s } = useThemed();
  const { armedId, arm } = useContext(DeleteArmContext);
  const armId = `person-${person.id}`;
  const armed = armedId === armId;
  const remove = t("Remove {name}", { name: person.name });

  // An empty name isn't kept: the field goes back to the name they had.
  const commit = (input) => {
    const clean = input.value.trim();
    if (clean && clean !== person.name) onRename(clean);
    else input.value = person.name;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.xs}px 0` }}>
      <span aria-hidden="true" style={{
        width: 28, height: 28, borderRadius: "50%", background: person.color, color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, fontWeight: 700,
      }}>{[...person.name][0]?.toUpperCase()}</span>
      <input defaultValue={person.name} aria-label={t("Name")}
        onBlur={(e) => commit(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.value = person.name; e.currentTarget.blur(); }
        }}
        style={{ ...s.input, flex: 1, minHeight: 34, padding: "6px 10px" }} />
      <button
        style={{ ...s.delBtn, color: armed ? theme.danger : theme.textFaint, fontWeight: armed ? 700 : 400 }}
        title={armed ? t("Click again to confirm") : remove} aria-label={remove}
        onClick={() => { if (armed) { onRemove(); arm(null); } else arm(armId); }}
      >✕</button>
    </div>
  );
}
