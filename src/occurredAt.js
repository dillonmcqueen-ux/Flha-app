// src/occurredAt.js
// Incident and near miss "when did it happen" used to be a free-text box
// ("Today at 5:45 PM"). New reports store a datetime-local value
// ("2026-09-30T14:30"); old rows keep whatever was typed. Everything that
// shows the value goes through formatOccurredAt so both shapes read fine.
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Current local time in datetime-local format, used as the picker default.
export function nowLocalInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// True when the stored value is a picker value (safe to edit with a picker).
export function isLocalInput(value) {
  return typeof value === "string" && LOCAL_RE.test(value);
}

// Picker value -> readable text; anything else (legacy free text) passes through.
export function formatOccurredAt(value) {
  if (!isLocalInput(value)) return value || "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}
