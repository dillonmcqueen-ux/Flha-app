// src/useDraftAutosave.js
// Phase 0 of docs/scope-offline-capability.md: debounced local-draft
// autosave so an in-progress form survives a dropped connection, a
// crash, or an accidental navigation — without needing a submission
// queue or a service worker. Pure localStorage, no network involved.
//
// Scoped per form type + a caller-supplied scope id (typically
// companyId), not per individual worker — most companies don't have a
// strong per-person identity on shared-code logins, so this can't do
// better than "per device" anyway. A device shared between crew members
// could show a previous worker's unsent draft; that's the same
// limitation the existing window.name/localStorage session already has.
import { useEffect, useRef } from "react";

const DEBOUNCE_MS = 800;

function draftKey(formType, scopeId) {
  return `fora_draft_${formType}_${scopeId || "anon"}`;
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
