import { useState, useRef, useCallback } from "react";
import { colors as C, radius as RAD } from "../theme";
import { PAGE_W, PAGE_H, isPlaced } from "../../server-lib/documentEngine/layoutSchema.js";
import {
  PALETTE, addBlock, moveBlock, resizeBlock, deleteBlock, duplicateBlock, placeFlowBlock, alignBlocks,
  hitTest, reorder, pageCount, updateBlock, setRect, movePage, mmToPx, pxToMm, MAX_PAGES,
} from "./editorModel.js";

// Drag and drop layout editor (WP5). Boxes are placed on A4 pages in mm. An
// uploaded picture of the paper form can sit behind them as a tracing aid; it
// is only kept in this session and is never saved with the layout.

const CANVAS_W = 560;
const btn = { background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const input = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: RAD.sm, border: `1px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 12.5 };
const lab = { display: "block", fontSize: 10.5, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", margin: "8px 0 3px" };

const TEXTY = ["text", "banner", "callout", "chips", "signature", "signature_grid", "approvals", "field_value"];

export default function LayoutEditor({ layout, onChange, fields = [], onPreview }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [bg, setBg] = useState({}); // { [page]: dataUrl }
  const drag = useRef(null);
  const canvasRef = useRef(null);
  const pages = Math.max(pageCount(layout), page);
  const sel = selected[0] || null;
  const selBlock = (layout.blocks || []).find((b) => b.id === sel) || null;
  const flowBlocks = (layout.blocks || []).filter((b) => !isPlaced(b));
  const placed = (layout.blocks || []).filter((b) => isPlaced(b) && b.rect.page === page);
  const heightPx = mmToPx(PAGE_H, CANVAS_W);

  const commit = useCallback((next) => onChange(next), [onChange]);

  const toMm = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: pxToMm(e.clientX - r.left, r.width), y: pxToMm(e.clientY - r.top, r.width) };
  };

  const onDropPalette = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("text/plain");
    if (!PALETTE.some((p) => p.type === type)) return;
    const { x, y } = toMm(e);
    const out = addBlock(layout, type, page, x, y);
    if (out.error) return;
    commit(out.layout);
    setSelected([out.id]);
  };

  const startDrag = (e, block, mode) => {
    e.stopPropagation();
    e.preventDefault();
    const additive = e.shiftKey;
    setSelected((s) => (additive ? (s.includes(block.id) ? s : [...s, block.id]) : [block.id]));
    const p = toMm(e);
    drag.current = { id: block.id, mode, last: p, base: layout };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = toMm(e);
    const dx = p.x - d.last.x; const dy = p.y - d.last.y;
    // Accumulate unsnapped movement so slow drags still land on the grid.
    d.acc = { x: (d.acc?.x || 0) + dx, y: (d.acc?.y || 0) + dy };
    d.last = p;
    const stepX = Math.trunc(d.acc.x); const stepY = Math.trunc(d.acc.y);
    if (!stepX && !stepY) return;
    d.acc = { x: d.acc.x - stepX, y: d.acc.y - stepY };
    commit(d.mode === "resize" ? resizeBlock(layout, d.id, stepX, stepY) : moveBlock(layout, d.id, stepX, stepY));
  };
  const endDrag = () => { drag.current = null; };

  const onKey = (e) => {
    if (!sel || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const step = e.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); commit(moveBlock(layout, sel, ...moves[e.key])); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(deleteBlock(layout, sel)); setSelected([]); }
  };

  const loadBg = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 6 * 1024 * 1024) return;
    const rd = new FileReader();
    rd.onload = () => setBg((b) => ({ ...b, [page]: String(rd.result) }));
    rd.readAsDataURL(f);
  };

  const patch = (p) => commit(updateBlock(layout, sel, p));
  const rect = selBlock && isPlaced(selBlock) ? selBlock.rect : null;

  return (
    <div onKeyDown={onKey} tabIndex={0} style={{ display: "flex", gap: 14, flexWrap: "wrap", outline: "none" }}>
      <div style={{ width: 150 }}>
        <div style={lab}>Drag onto the page</div>
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", p.type)}
            style={{ ...btn, marginBottom: 6, cursor: "grab" }}>{p.label}</div>
        ))}
        {flowBlocks.length > 0 && (
          <>
            <div style={lab}>Flowing blocks</div>
            {flowBlocks.map((b) => (
              <div key={b.id} style={{ fontSize: 12, color: C.text.body, marginBottom: 4 }}>
                {b.heading || b.title || b.type}
                <button style={{ ...btn, marginLeft: 6, padding: "2px 6px" }} onClick={() => { commit(placeFlowBlock(layout, b.id, page)); setSelected([b.id]); }}>Place</button>
              </div>
            ))}
          </>
        )}
      </div>

      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} style={{ ...btn, borderColor: page === i + 1 ? C.orange : C.line }} onClick={() => { setPage(i + 1); setSelected([]); }}>Page {i + 1}</button>
          ))}
          {pages < MAX_PAGES && <button style={btn} onClick={() => setPage(pages + 1)}>+ Page</button>}
          <label style={{ ...btn, display: "inline-block" }}>Trace paper form
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={loadBg} style={{ display: "none" }} />
          </label>
          {bg[page] && <button style={btn} onClick={() => setBg((b) => { const n = { ...b }; delete n[page]; return n; })}>Remove trace</button>}
          {onPreview && <button style={{ ...btn, background: C.orange, color: C.text.onOrange }} onClick={onPreview}>Preview PDF</button>}
        </div>
        <div ref={canvasRef} data-testid="layout-canvas"
          onDragOver={(e) => e.preventDefault()} onDrop={onDropPalette}
          onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onPointerDown={(e) => { const p = toMm(e); const hit = hitTest(layout, page, p.x, p.y); setSelected(hit ? [hit] : []); }}
          style={{ position: "relative", width: CANVAS_W, height: heightPx, background: "#fff", border: `1px solid ${C.line}`, touchAction: "none", userSelect: "none", overflow: "hidden" }}>
          {bg[page] && <img src={bg[page]} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.45, pointerEvents: "none" }} />}
          {placed.map((b) => {
            const r = b.rect; const on = selected.includes(b.id);
            return (
              <div key={b.id} data-block={b.id} onPointerDown={(e) => startDrag(e, b, "move")}
                style={{
                  position: "absolute", left: mmToPx(r.x, CANVAS_W), top: mmToPx(r.y, CANVAS_W), width: mmToPx(r.w, CANVAS_W), height: mmToPx(r.h, CANVAS_W),
                  border: `1.5px ${on ? "solid" : "dashed"} ${on ? C.orange : "#64748b"}`, background: on ? "rgba(249,115,22,0.12)" : "rgba(30,58,95,0.06)",
                  color: "#1e3a5f", fontSize: 10, overflow: "hidden", cursor: "move", boxSizing: "border-box", padding: 2,
                }}>
                {b.type}{b.field ? `: ${b.field}` : ""}
                {on && <div onPointerDown={(e) => startDrag(e, b, "resize")} style={{ position: "absolute", right: 0, bottom: 0, width: 12, height: 12, background: C.orange, cursor: "nwse-resize" }} />}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ width: 220 }}>
        {!selBlock && <div style={{ fontSize: 12.5, color: C.text.muted }}>Click a box to edit it. Arrow keys nudge (Shift for 5 mm). Delete removes. Shift-click selects more than one.</div>}
        {selBlock && (
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: C.text.primary }}>{selBlock.type} <span style={{ color: C.text.muted, fontWeight: 600 }}>({selBlock.id})</span></div>
            {rect && (
              <>
                <div style={lab}>Box (mm)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {["x", "y", "w", "h"].map((k) => (
                    <input key={k} aria-label={k} type="number" style={input} value={Math.round(rect[k] * 10) / 10}
                      onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) commit(setRect(layout, sel, { [k]: n })); }} />
                  ))}
                </div>
                <div style={lab}>Page</div>
                <input aria-label="page" type="number" min={1} max={MAX_PAGES} style={input} value={rect.page}
                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (n >= 1) { commit(movePage(layout, sel, n)); setPage(Math.min(n, MAX_PAGES)); } }} />
              </>
            )}
            {(selBlock.type === "table" || selBlock.type === "chips" || selBlock.type === "text" || selBlock.type === "field_value" || selBlock.type === "callout") && (
              <>
                <div style={lab}>Reads from field</div>
                <select style={input} value={selBlock.field || ""} onChange={(e) => patch({ field: e.target.value || undefined })}>
                  <option value="">(none)</option>
                  {fields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label || f.field_key}</option>)}
                  {selBlock.field && !fields.some((f) => f.field_key === selBlock.field) && <option value={selBlock.field}>{selBlock.field} (missing)</option>}
                </select>
              </>
            )}
            {TEXTY.includes(selBlock.type) && selBlock.type !== "banner" && (
              <>
                <div style={lab}>{selBlock.type === "field_value" ? "Label" : "Heading"}</div>
                <input style={input} value={(selBlock.type === "field_value" ? selBlock.label : selBlock.heading) || ""}
                  onChange={(e) => patch(selBlock.type === "field_value" ? { label: e.target.value } : { heading: e.target.value })} />
              </>
            )}
            {selBlock.type === "text" && (
              <>
                <div style={lab}>Fixed text</div>
                <textarea style={{ ...input, minHeight: 50 }} value={selBlock.value || ""} onChange={(e) => patch({ value: e.target.value })} />
              </>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              <button style={btn} onClick={() => { const o = duplicateBlock(layout, sel); if (!o.error) { commit(o.layout); setSelected([o.id]); } }}>Duplicate</button>
              <button style={btn} onClick={() => commit(reorder(layout, sel, true))}>Front</button>
              <button style={btn} onClick={() => commit(reorder(layout, sel, false))}>Back</button>
              <button style={{ ...btn, color: C.status?.danger?.text || "#b91c1c" }} onClick={() => { commit(deleteBlock(layout, sel)); setSelected([]); }}>Delete</button>
            </div>
            {selected.length > 1 && (
              <>
                <div style={lab}>Align to first selected</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["left", "right", "top", "bottom", "center", "middle", "width", "height"].map((h) => (
                    <button key={h} style={{ ...btn, padding: "3px 7px" }} onClick={() => commit(alignBlocks(layout, selected, h))}>{h}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
