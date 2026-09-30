// src/useDraftAutosave.js
// Phase 0 of docs/scope-offline-capability.md: debounced local-draft
// autosave so an in-progress form survives a dropped connection, a
// crash, or an accidental navigation — without needing a submission
// queue or a service worker. Pure localStorage, no network involved.
//
// Scoped per form type + a caller-supplied scope id (typically
// companyId) + the signed-in roster member (setDraftUser, called from
// Login.jsx whenever the session changes). Without the user part, a phone
// shared between crew members restored the previous worker's unsent draft,
// including their name. A session with no roster id (founder/admin) gets
// the old per-device key.
import { useEffect, useRef } from "react";

const DEBOUNCE_MS = 800;

let draftUser = "";

// Called by Login.jsx with the session's roster id (or null on logout).
export function setDraftUser(userId) {
  draftUser = userId ? String(userId) : "";
}

export function draftUserSuffix() {
  return draftUser ? `@u${draftUser}` : "";
}

function draftKey(formType, scopeId) {
  return `fora_draft_${formType}_${scopeId || "anon"}${draftUserSuffix()}`;
}

// Returns the previously-saved draft's `data` payload, or null if there
// isn't one (or storage is unavailable — private browsing, quota, etc.).
export function loadDraft(formType, scopeId) {
  try {
    const raw = localStorage.getItem(draftKey(formType, scopeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed.data : null;
  } catch (e) {
    return null;
  }
}

// Call this right after a successful submit (or when the worker
// deliberately starts over) so a stale draft doesn't reappear later.
export function clearDraft(formType, scopeId) {
  try { localStorage.removeItem(draftKey(formType, scopeId)); } catch (e) { /* nothing to clear */ }
}

// Debounced-saves `data` under formType+scopeId whenever it changes.
// `enabled` should stay false until any existing draft has already been
// restored into state — otherwise the very first write (of the form's
// blank initial state) would race with, and can clobber, the restore.
export function useDraftAutosave(formType, scopeId, data, enabled) {
  const timerRef = useRef(null);
  const serialized = JSON.stringify(data);

  useEffect(() => {
    if (!enabled) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(formType, scopeId), JSON.stringify({ savedAt: Date.now(), data: JSON.parse(serialized) }));
      } catch (e) { /* storage full or unavailable — draft just won't persist, not fatal */ }
    }, DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, formType, scopeId, serialized]);
}
