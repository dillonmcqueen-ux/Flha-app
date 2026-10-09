import { useState, useEffect, useCallback } from "react";
import { callDocuments } from "./builderApi.js";
import { inboxCount } from "./recordView.js";

// What the Dashboard needs before the tab is opened: whether the company has
// any engine documents, and how many things wait on this supervisor (records
// to review plus open escalations). Failures leave the tab hidden and the
// badge empty. They never break the Dashboard.
export function useEngineInbox(token, companyId, enabled = true) {
  const [state, setState] = useState({ docs: [], inbox: null, escalations: [] });
  const reload = useCallback(async () => {
    if (!enabled || !token || !companyId) return;
    const safe = (action, extra) => callDocuments(token, action, { companyId, ...extra }).catch(() => null);
    const [docs, inbox, esc] = await Promise.all([safe("list_worker_documents"), safe("my_inbox"), safe("list_escalations", { status: "open" })]);
    setState({ docs: docs?.documents || [], inbox, escalations: esc?.escalations || [] });
  }, [token, companyId, enabled]);
  useEffect(() => { setState({ docs: [], inbox: null, escalations: [] }); reload(); }, [reload]);
  return { ...state, count: inboxCount(state.inbox, state.escalations), reload };
}
