// An in-memory stand-in for the Supabase client, covering the calls the
// document engine makes: from().select/insert/update/delete with eq, in, is,
// order, limit, and select() after insert/update. Not a general PostgREST
// emulator. Used by tests/unit/document-engine-service.test.js.

const DEFAULTS = {
  company_documents: { is_enabled: false, brain_enabled: true, owner_muted: false },
  document_records: { meta: {}, status: 'submitted', review_step: 0, review_round: 0, unsigned_alerted_at: null, review_alerted_at: null, unsigned_closed_at: null, submitted_at: null, awaiting_signature: false, signature_requested_at: null, worker_signed_at: null, returned_reason: null, pdf_path: null, site_id: null, submitted_by_roster_id: null, client_submission_id: null },
  document_fields: { required: false, config: {}, attachment_rules: {}, section: null, help_text: null },
  document_definitions: { company_id: null, template_id: null, current_version_id: null, archived_at: null, icon: null, category: null },
  document_versions: { published_at: null },
  document_escalations: { status: 'open', actioned_by_roster_id: null, actioned_at: null },
};

const CASCADES = {
  document_records: [['document_answers', 'record_id'], ['document_signatures', 'record_id'], ['document_attachments', 'record_id']],
};

const same = (a, b) => (a == null || b == null ? a == b : String(a) === String(b));

export function makeDb(seed = {}) {
  const tables = {};
  const nextId = {};
  const failures = [];
  const t = (name) => {
    if (!tables[name]) tables[name] = [];
    if (nextId[name] == null) nextId[name] = tables[name].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    return tables[name];
  };
  for (const [name, rows] of Object.entries(seed)) { tables[name] = rows.map((r) => ({ ...r })); t(name); }

  class Query {
    constructor(name) { this.name = name; this.mode = 'select'; this.filters = []; this._order = null; this._limit = null; this.payload = null; this.returning = false; }
    select() { if (this.mode !== 'select') this.returning = true; return this; }
    insert(rows) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this.mode = 'update'; this.payload = patch; return this; }
    delete() { this.mode = 'delete'; return this; }
    eq(col, val) {
      // PostgREST's json path form, meta->>key.
      const m = /^(\w+)->>(\w+)$/.exec(col);
      if (m) this.filters.push((r) => same(r[m[1]] && r[m[1]][m[2]] != null ? String(r[m[1]][m[2]]) : null, val));
      else this.filters.push((r) => same(r[col], val));
      return this;
    }
    in(col, vals) { this.filters.push((r) => (vals || []).some((v) => same(r[col], v))); return this; }
    is(col, val) { this.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
    not(col, op, val) { this.filters.push((r) => (op === 'is' && val === null ? r[col] != null : true)); return this; }
    gte(col, val) { this.filters.push((r) => r[col] != null && r[col] >= val); return this; }
    lt(col, val) { this.filters.push((r) => r[col] != null && r[col] < val); return this; }
    order(col, { ascending = true } = {}) { this._order = { col, ascending }; return this; }
    limit(n) { this._limit = n; return this; }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
    run() {
      const fail = failures.find((f) => f.table === this.name && f.mode === this.mode);
      if (fail) return { data: null, error: { message: 'injected failure', code: 'XX000' } };
      const rows = t(this.name);
      const match = () => rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === 'select') {
        let out = match().map((r) => ({ ...r }));
        if (this._order) {
          const { col, ascending } = this._order;
          out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
        }
        if (this._limit != null) out = out.slice(0, this._limit);
        return { data: out, error: null };
      }
      if (this.mode === 'insert') {
        // document_signatures_review_once_uidx: one approval per step per round.
        if (this.name === 'document_signatures') {
          for (const p of this.payload) {
            if (p.kind === 'approval' && rows.some((r) => r.kind === 'approval' && String(r.record_id) === String(p.record_id) && r.step_key === p.step_key && String(r.meta?.round) === String(p.meta?.round))) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
          }
        }
        const made = this.payload.map((p) => {
          const row = { ...(DEFAULTS[this.name] || {}), ...p };
          if (row.id == null) { row.id = nextId[this.name]; nextId[this.name] += 1; }
          row.created_at = row.created_at || new Date().toISOString();
          rows.push(row);
          return row;
        });
        return { data: this.returning ? made.map((r) => ({ ...r })) : null, error: null };
      }
      if (this.mode === 'update') {
        const hit = match();
        hit.forEach((r) => Object.assign(r, this.payload));
        return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      const hit = match();
      for (const r of hit) {
        rows.splice(rows.indexOf(r), 1);
        for (const [child, col] of CASCADES[this.name] || []) {
          tables[child] = t(child).filter((c) => !same(c[col], r.id));
        }
      }
      return { data: null, error: null };
    }
  }
  // claim_notification_slot: the first 3 claims per (company, key, person) are
  // allowed, the rest are held. refund_notification_slot is accepted and ignored.
  const claims = new Map();
  const rpcCalls = [];
  const rpcHandlers = {};
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (rpcHandlers[name]) return rpcHandlers[name](args);
    if (name === 'claim_notification_slot') {
      const k = `${args.p_company}:${args.p_key}:${args.p_roster}`;
      const n = (claims.get(k) || 0) + 1;
      claims.set(k, n);
      return { data: [{ allowed: n <= 3, suppressed: 0 }], error: null };
    }
    return { data: null, error: null };
  };
  return {
    tables,
    rpc,
    rpcCalls,
    rpcHandlers,
    from: (name) => { t(name); return new Query(name); },
    failOn: (table, mode) => failures.push({ table, mode }),
    clearFailures: () => { failures.length = 0; },
  };
}
