import { useState, useEffect } from "react";

const C = {
  paper: "#EDEFEA", ink: "#182420", slate: "#57655F", line: "#CBD1C8",
  amber: "#C4761F", amberDim: "#C4761F22", card: "#F6F7F3", white: "#FFFFFF",
  bad: "#B3452F", good: "#2E6E58",
};

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function GatehouseDashboard({ companyId, companyName, userName, role, onLogout, token }) {
  const [config, setConfig] = useState(null);
  const [stationId, setStationId] = useState(null);
  const [businessDate, setBusinessDate] = useState(todayLocal());
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cashCounted, setCashCounted] = useState("");
  const [reconReason, setReconReason] = useState("");
  // The saved reconciliation row for this station/day, or null — carries
  // submitted_by/reviewed_by/reviewed_at, not just the last submit's result,
  // so a supervisor sees an operator's earlier submission without needing
  // to resubmit it themselves first.
  const [reconciliation, setReconciliation] = useState(null);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [reconError, setReconError] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [trailersOut, setTrailersOut] = useState("");
  const [trailerCheck, setTrailerCheck] = useState(null);

  // Receipt lookup by number — for the office to pull up a transaction
  // when a customer calls about it. Independent of the station/date
  // pickers above since the caller may not know either.
  const [receiptQuery, setReceiptQuery] = useState("");
  const [receiptResults, setReceiptResults] = useState(null); // null = no search yet
  const [receiptSearching, setReceiptSearching] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  useEffect(() => {
    fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_config", token, companyId }),
    })
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        if (data.stations && data.stations.length > 0) setStationId(data.stations[0].id);
      });
  }, [token, companyId]);

  function loadDay() {
    if (!stationId) return;
    setLoading(true);
    fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_transactions", token, companyId, stationId, businessDate }),
    })
      .then((r) => r.json())
      .then((data) => { setTransactions(data.transactions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  function loadReconciliation() {
    if (!stationId) return;
    fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_reconciliation", token, companyId, stationId, businessDate }),
    })
      .then((r) => r.json())
      .then((data) => {
        setReconciliation(data.reconciliation || null);
        setCashCounted(data.reconciliation ? String(data.reconciliation.cash_counted) : "");
        setReconReason(data.reconciliation?.reason || "");
      })
      .catch(() => {});
  }

  useEffect(() => { loadDay(); loadReconciliation(); setSendStatus(""); }, [stationId, businessDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const cashTotal = transactions.filter((t) => !t.redirected && t.payment_method === "cash").reduce((s, t) => s + Number(t.amount || 0), 0);
  const chequeTotal = transactions.filter((t) => !t.redirected && t.payment_method === "cheque").reduce((s, t) => s + Number(t.amount || 0), 0);
  const grandTotal = cashTotal + chequeTotal;
  const redirectedCount = transactions.filter((t) => t.redirected).length;
  const receiptNumbers = transactions.map((t) => t.receipt_number).filter((n) => n != null);
  const receiptFrom = receiptNumbers.length ? Math.min(...receiptNumbers) : null;
  const receiptTo = receiptNumbers.length ? Math.max(...receiptNumbers) : null;

  // tier_label is a snapshotted string like "Minimum Fee" or, for a
  // multi-item cart, "Minimum Fee + Fridge x2" — parsed back into counts
  // per charge type so the day can be read at a glance ("12 minimum
  // charges, 3 fridges") instead of scanning every row. Mirrors
  // parseTierLabelParts/buildTierBreakdown in api/gatehouse.js.
  const tierBreakdown = (() => {
    const counts = new Map();
    for (const t of transactions) {
      if (t.redirected || !t.tier_label) continue;
      for (const part of t.tier_label.split(" + ")) {
        const m = part.match(/^(.*) x(\d+)$/);
        const label = m ? m[1] : part;
        const qty = m ? Number(m[2]) : 1;
        counts.set(label, (counts.get(label) || 0) + qty);
      }
    }
    return [...counts.entries()]
      .map(([label, quantity]) => ({ label, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
  })();

  async function submitReconciliation() {
    const res = await fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_reconciliation", token, companyId, stationId, businessDate, cashCounted, reason: reconReason }),
    });
    const data = await res.json();
    if (res.ok) setReconciliation(data.reconciliation);
  }

  async function markReviewed() {
    setMarkingReviewed(true); setReconError("");
    const res = await fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_reconciliation_reviewed", token, companyId, stationId, businessDate }),
    });
    const data = await res.json();
    if (res.ok) setReconciliation(data.reconciliation);
    else setReconError(data.error || "Could not mark reviewed.");
    setMarkingReviewed(false);
  }

  async function sendReport() {
    if (!recipientEmail) return;
    setSendStatus("Sending…");
    const res = await fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_daily_report", token, companyId, stationId, businessDate, recipientEmail }),
    });
    const data = await res.json();
    setSendStatus(res.ok ? "Report sent." : (data.error || "Failed to send."));
  }

  async function searchReceipt() {
    const receiptNumber = receiptQuery.trim();
    if (!receiptNumber) return;
    setReceiptSearching(true); setReceiptError(""); setReceiptResults(null);
    const res = await fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search_receipt", token, companyId, receiptNumber }),
    });
    const data = await res.json();
    if (res.ok) setReceiptResults(data.transactions || []);
    else setReceiptError(data.error || "Lookup failed.");
    setReceiptSearching(false);
  }

  async function checkTrailers() {
    const res = await fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_trailer_check", token, companyId, stationId, periodStart: businessDate, periodEnd: businessDate }),
    });
    const data = await res.json();
    if (res.ok) setTrailerCheck(data);
  }

  async function logTrailers() {
    if (!trailersOut) return;
    await fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "log_trailer_count", token, companyId, stationId, periodStart: businessDate, periodEnd: businessDate, trailersOut }),
    });
    setTrailersOut("");
    checkTrailers();
  }

  const styles = {
    wrap: { minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: "'Segoe UI', system-ui, sans-serif" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: `1px solid ${C.line}`, background: C.white },
    body: { maxWidth: 920, margin: "0 auto", padding: "24px 16px 60px" },
    card: { background: C.white, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18, marginBottom: 18 },
    label: { fontSize: 12.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, display: "block" },
    // Form controls don't reliably inherit `color` from an ancestor the
    // way a div does — set it explicitly or the browser's own UA
    // stylesheet can win, producing invisible white-on-white text.
    input: { padding: "10px 12px", fontSize: 15, borderRadius: 6, border: `1px solid ${C.line}`, color: C.ink, background: C.white },
    select: { padding: "10px 12px", fontSize: 15, borderRadius: 6, border: `1px solid ${C.line}`, color: C.ink, background: C.white },
    btn: { background: C.amber, color: "#fff", border: "none", borderRadius: 6, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
    ghost: { background: "transparent", border: `1px solid ${C.line}`, color: C.ink, borderRadius: 6, padding: "8px 14px", fontSize: 14, cursor: "pointer" },
    tile: { flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 14 },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
    th: { textAlign: "left", padding: "8px 10px", borderBottom: `2px solid ${C.line}`, color: C.slate, fontSize: 11.5, textTransform: "uppercase" },
    td: { padding: "8px 10px", borderBottom: `1px solid ${C.line}` },
  };

  if (!config) return <div style={styles.wrap}>Loading…</div>;

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <strong>Gatehouse</strong>
          <div style={{ fontSize: 12, color: C.slate }}>{companyName}{userName ? ` · ${userName}` : ""}</div>
        </div>
        <button style={styles.ghost} onClick={onLogout}>Sign out</button>
      </div>

      <div style={styles.body}>
        <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <select style={styles.select} value={stationId || ""} onChange={(e) => setStationId(e.target.value)}>
            {(config.stations || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input style={styles.input} type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </div>

        <div style={{ ...styles.card, marginBottom: 18 }}>
          <div style={styles.label}>Look up a receipt</div>
          <div style={{ fontSize: 13, color: C.slate, marginBottom: 10 }}>
            Receipt numbers reset each day, so the same number can turn up more than once — pick the right one by date/station below.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              style={{ ...styles.input, maxWidth: 200 }} placeholder="Receipt #" value={receiptQuery}
              onChange={(e) => setReceiptQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") searchReceipt(); }}
              inputMode="numeric"
            />
            <button style={styles.btn} onClick={searchReceipt} disabled={receiptSearching}>{receiptSearching ? "Searching…" : "Search"}</button>
          </div>
          {receiptError && <div style={{ color: C.bad, marginTop: 10, fontSize: 13.5 }}>{receiptError}</div>}
          {receiptResults && (
            receiptResults.length === 0 ? (
              <div style={{ marginTop: 12, fontSize: 13.5, color: C.slate }}>No receipt #{receiptQuery.trim()} found.</div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {receiptResults.map((t) => (
                  <div key={t.id} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 13.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <strong>#{t.receipt_number} — {t.station_name || "Unknown station"}, {t.business_date}</strong>
                      <span style={{ fontWeight: 700, color: C.amber }}>{t.redirected ? "Redirected" : `$${Number(t.amount).toFixed(2)}`}</span>
                    </div>
                    <div style={{ color: C.slate, marginTop: 4 }}>
                      {t.redirected ? "Redirected — not accepted" : t.tier_label}
                      {t.plate ? ` · Plate ${t.plate}` : ""}
                      {t.operator_name ? ` · Logged by ${t.operator_name}` : ""}
                      {!t.redirected && t.payment_method ? ` · ${t.payment_method}` : ""}
                    </div>
                    {t.cheque_photo_url && <a href={t.cheque_photo_url} target="_blank" rel="noopener noreferrer" style={{ color: C.amber }}>View cheque photo</a>}
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={styles.tile}><div style={styles.label}>Loads logged</div><div style={{ fontSize: 22, fontWeight: 700 }}>{transactions.length}</div></div>
          <div style={styles.tile}><div style={styles.label}>Redirected</div><div style={{ fontSize: 22, fontWeight: 700 }}>{redirectedCount}</div></div>
          <div style={styles.tile}>
            <div style={styles.label}>Receipt #s</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{receiptFrom != null ? `${receiptFrom}–${receiptTo}` : "—"}</div>
          </div>
          <div style={styles.tile}><div style={styles.label}>Cash total</div><div style={{ fontSize: 22, fontWeight: 700 }}>${cashTotal.toFixed(2)}</div></div>
          <div style={styles.tile}><div style={styles.label}>Grand total</div><div style={{ fontSize: 22, fontWeight: 700, color: C.amber }}>${grandTotal.toFixed(2)}</div></div>
        </div>

        {tierBreakdown.length > 0 && (
          <div style={styles.card}>
            <div style={styles.label}>Breakdown by charge type — {businessDate}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {tierBreakdown.map((row) => (
                <div key={row.label} style={{ ...styles.tile, flex: "0 0 auto", padding: "10px 14px" }}>
                  <div style={{ fontSize: 13.5 }}>{row.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{row.quantity}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.label}>Transactions — {businessDate}</div>
          {loading ? <div style={{ padding: 12 }}>Loading…</div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Receipt #</th><th style={styles.th}>Time</th><th style={styles.th}>Load</th>
                  <th style={styles.th}>Plate</th><th style={styles.th}>Operator</th><th style={styles.th}>Payment</th><th style={styles.th}>Amount</th>
                </tr></thead>
                <tbody>
                  {transactions.length === 0 && <tr><td style={styles.td} colSpan={7}>No transactions yet.</td></tr>}
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td style={styles.td}>{t.receipt_number}</td>
                      <td style={styles.td}>{new Date(t.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                      <td style={styles.td}>{t.redirected ? "Redirected" : t.tier_label}</td>
                      <td style={styles.td}>{t.plate || "—"}</td>
                      <td style={styles.td}>{t.operator_name || "—"}</td>
                      <td style={styles.td}>
                        {t.redirected ? "—" : t.payment_method}
                        {t.cheque_photo_url && <a href={t.cheque_photo_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: C.amber }}>photo</a>}
                      </td>
                      <td style={styles.td}>{t.redirected ? "—" : `$${Number(t.amount).toFixed(2)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div style={{ ...styles.card, flex: "1 1 280px" }}>
            <div style={styles.label}>Cash reconciliation</div>
            <div style={{ fontSize: 13, color: C.slate, marginBottom: 10 }}>Expected cash: ${cashTotal.toFixed(2)}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...styles.input, flex: 1 }} type="number" step="0.01" placeholder="Cash counted" value={cashCounted} onChange={(e) => setCashCounted(e.target.value)} />
              <button style={styles.btn} onClick={submitReconciliation}>Submit</button>
            </div>
            {reconciliation && Math.abs(reconciliation.variance) >= 0.005 && (
              <input
                style={{ ...styles.input, marginTop: 8 }} placeholder="Reason for difference"
                value={reconReason} onChange={(e) => setReconReason(e.target.value)}
                onBlur={submitReconciliation}
              />
            )}
            {reconciliation && (
              <>
                <div style={{ marginTop: 10, fontWeight: 700, color: Math.abs(reconciliation.variance) < 0.005 ? C.good : C.bad }}>
                  Variance: ${Number(reconciliation.variance).toFixed(2)} {Math.abs(reconciliation.variance) < 0.005 ? "— balanced" : "— flagged"}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: C.slate }}>
                  Counted by {reconciliation.submitted_by || "—"}
                  {reconciliation.reviewed_by
                    ? ` · Reviewed by ${reconciliation.reviewed_by}`
                    : " · Not yet reviewed"}
                </div>
                {!reconciliation.reviewed_by && (role === "supervisor" || role === "admin") && (
                  <button style={{ ...styles.btn, marginTop: 8 }} onClick={markReviewed} disabled={markingReviewed}>
                    {markingReviewed ? "Marking…" : "Mark reviewed"}
                  </button>
                )}
                {reconError && <div style={{ marginTop: 8, fontSize: 13, color: C.bad }}>{reconError}</div>}
              </>
            )}
          </div>

          <div style={{ ...styles.card, flex: "1 1 280px" }}>
            <div style={styles.label}>Send daily report</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...styles.input, flex: 1 }} type="email" placeholder="Recipient email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
              <button style={styles.btn} onClick={sendReport}>Send</button>
            </div>
            {sendStatus && <div style={{ marginTop: 10, fontSize: 13, color: C.slate }}>{sendStatus}</div>}
          </div>

          <div style={{ ...styles.card, flex: "1 1 280px" }}>
            <div style={styles.label}>Trailer check (TRUX)</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input style={{ ...styles.input, flex: 1 }} type="number" placeholder="Trailers hauled out" value={trailersOut} onChange={(e) => setTrailersOut(e.target.value)} />
              <button style={styles.btn} onClick={logTrailers}>Log</button>
            </div>
            <button style={styles.ghost} onClick={checkTrailers}>Check against loads-in</button>
            {trailerCheck && (
              <div style={{ marginTop: 10, fontSize: 13.5 }}>
                Loads in: {trailerCheck.loadsIn} · Trailers out: {trailerCheck.trailersOut ?? "not logged"}
                {trailerCheck.hasTrailerData && trailerCheck.trailersOut !== trailerCheck.loadsIn && (
                  <div style={{ color: C.bad, fontWeight: 700, marginTop: 4 }}>Trend mismatch — worth a look.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
