// src/Inbox.jsx
// One inbox for everything a person has been sent or is waiting on. The worker
// home screen and the supervisor Overview each build their own item list (see
// src/inbox.js for the shape) and hand it to these two pieces:
//   InboxCard    a single card with a count badge that opens the inbox
//   InboxScreen  the full list, two tabs: needs action / completed
// Opening an item is up to the caller (item.onOpen), so a form, a document or a
// dashboard tab all work the same way here.
import { useState } from "react";
import { Inbox as InboxIcon, ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";

const statusColor = (status) =>
  status === "done" ? C.status.success.text : status === "overdue" ? C.status.danger.text : C.text.muted;

export function InboxCard({ needs, done, onClick, needsWord = "need action", marginBottom = 16 }) {
  const count = needs.length;
  const hasOverdue = needs.some((i) => i.status === "overdue");
  const tone = count === 0 ? null : hasOverdue ? C.status.danger : C.status.warning;
  return (
    <button
      type="button" onClick={onClick}
      aria-label={`Inbox, ${count} ${needsWord}`}
      style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", cursor: "pointer",
        background: tone ? tone.bg : `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
        border: `1px solid ${tone ? tone.border : C.line}`, borderRadius: RAD.lg, padding: "14px 16px",
        boxShadow: SHAD.md, marginBottom, minHeight: 72, boxSizing: "border-box", color: C.text.primary, font: "inherit",
      }}
    >
      <div style={{ position: "relative", width: 46, height: 46, borderRadius: RAD.md, flexShrink: 0, background: `${C.orange}1F`, border: `1px solid ${C.orange}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <InboxIcon size={22} color={C.orange} strokeWidth={2.25} />
        {count > 0 && (
          <span style={{
            position: "absolute", top: -7, right: -7, minWidth: 22, height: 22, padding: "0 6px", boxSizing: "border-box",
            borderRadius: RAD.pill, background: hasOverdue ? C.status.danger.solid : C.orange, color: "#fff",
            fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
          }}>{count > 99 ? "99+" : count}</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.text.primary }}>Inbox</div>
        <div style={{ fontSize: 13, color: tone ? tone.text : C.text.muted, marginTop: 1, fontWeight: tone ? 600 : 400 }}>
          {count > 0 ? `${count} ${needsWord}` : "Nothing waiting on you"}
          {done.length > 0 ? ` · ${done.length} completed` : ""}
        </div>
      </div>
      <ChevronRight size={20} color={C.text.faint} style={{ flexShrink: 0 }} />
    </button>
  );
}

function Row({ item }) {
  const Icon = item.Icon || InboxIcon;
  const accent = item.accent || C.orange;
  return (
    <button
      type="button" onClick={item.onOpen}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer",
        background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 14,
        minHeight: 64, boxShadow: SHAD.md, boxSizing: "border-box", color: C.text.primary, font: "inherit",
        borderLeft: `3px solid ${item.status === "overdue" ? C.status.danger.solid : accent}`,
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: RAD.md, flexShrink: 0, background: `${accent}1F`, border: `1px solid ${accent}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {item.iconNode || <Icon size={20} color={accent} strokeWidth={2.25} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: "anywhere" }}>{item.title}</div>
        <div style={{ fontSize: 13, color: statusColor(item.status), fontWeight: item.status === "overdue" ? 700 : 400, overflowWrap: "anywhere" }}>{item.subtitle}</div>
      </div>
      <ChevronRight size={20} color={C.text.faint} style={{ flexShrink: 0 }} />
    </button>
  );
}

export function InboxScreen({ companyName, needs, done, onBack, needsLabel = "Needs action" }) {
  const [tab, setTab] = useState(needs.length > 0 || done.length === 0 ? "needs" : "done");
  const list = tab === "needs" ? needs : done;
  const tabBtn = (key, label, count) => {
    const on = tab === key;
    return (
      <button
        type="button" role="tab" aria-selected={on} onClick={() => setTab(key)}
        style={{
          flex: 1, minHeight: 44, cursor: "pointer", fontWeight: 700, fontSize: 14, font: "inherit", borderRadius: RAD.md,
          border: `1.5px solid ${on ? C.orange : C.line}`, background: on ? `${C.orange}1F` : "transparent",
          color: on ? C.text.primary : C.text.muted,
        }}
      >
        {label} ({count})
      </button>
    );
  };
  return (
    <div style={{ fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary }}>
      <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={onBack} aria-label="Back" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 36, height: 36, borderRadius: RAD.md, border: `1px solid ${C.line}`, background: "transparent", color: C.text.body, cursor: "pointer" }}>
          <ChevronLeft size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{companyName || "FORA"}</div>
          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>Inbox</div>
        </div>
      </header>
      <div style={{ padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" }}>
        <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {tabBtn("needs", needsLabel, needs.length)}
          {tabBtn("done", "Completed", done.length)}
        </div>
        {list.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.text.muted }}>
            <CheckCircle2 size={32} style={{ marginBottom: 8, color: C.text.faint }} />
            <div>{tab === "needs" ? "You're all caught up." : "Nothing completed yet."}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
            {list.map((item) => <Row key={item.key} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}
