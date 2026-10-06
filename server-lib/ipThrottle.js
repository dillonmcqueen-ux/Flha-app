// Fixed-window per-key counter backed by master_code_ip_limits (see
// docs/schema/master-code-throttle-migration.sql). Shared by api/login.js
// (master-code, company-code, PIN, onboarding buckets) and api/checkout.js,
// kept apart by key prefix.
//
// The count is bumped by one atomic INSERT ... ON CONFLICT DO UPDATE inside
// bump_ip_throttle (docs/schema/ip-throttle-atomic-migration.sql), and the
// decision is made on the value that statement returns. The old version read
// the row, then wrote count + 1 back from Node, so N simultaneous requests
// all read the same count and all wrote the same count + 1: a burst of
// thousands advanced the counter by one and every ceiling built on it
// (including the per-IP PIN cap) collapsed under concurrency.
//
// If the function is missing (a deploy landing before the migration is
// applied), fall back to the old non-atomic path rather than failing
// closed and locking every caller out of login and checkout.
export async function checkIpThrottle(supabaseAdmin, key, maxAttempts, windowMs) {
  const { data, error } = await supabaseAdmin.rpc('bump_ip_throttle', {
    p_key: key,
    p_window_seconds: Math.round(windowMs / 1000),
  });
  if (!error && typeof data === 'number') return data <= maxAttempts;

  if (error) console.error('bump_ip_throttle RPC unavailable, using non-atomic fallback:', error.message);
  return legacyCheckIpThrottle(supabaseAdmin, key, maxAttempts, windowMs);
}

async function legacyCheckIpThrottle(supabaseAdmin, key, maxAttempts, windowMs) {
  const now = Date.now();
  const { data: rows } = await supabaseAdmin
    .from('master_code_ip_limits')
    .select('window_start, count')
    .eq('ip', key)
    .limit(1);
  const row = rows && rows[0];
  if (!row || now - new Date(row.window_start).getTime() > windowMs) {
    await supabaseAdmin
      .from('master_code_ip_limits')
      .upsert({ ip: key, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (row.count >= maxAttempts) return false;
  await supabaseAdmin.from('master_code_ip_limits').update({ count: row.count + 1 }).eq('ip', key);
  return true;
}

// Reads a bucket without counting this call: true while it is still under
// `maxAttempts` in its current window. For limits that should only count
// FAILURES (a wrong company code) but must still refuse the next guess once the
// budget is spent. Pair it with checkIpThrottle() on the failure path. A read
// error answers true, so a database blip never locks everyone out of login.
export async function peekIpThrottle(supabaseAdmin, key, maxAttempts, windowMs) {
  const { data, error } = await supabaseAdmin
    .from('master_code_ip_limits')
    .select('window_start, count')
    .eq('ip', key)
    .limit(1);
  if (error) return true;
  const row = data && data[0];
  if (!row) return true;
  if (Date.now() - new Date(row.window_start).getTime() > windowMs) return true;
  return row.count < maxAttempts;
}

// The key a caller's address is counted under. IPv4 is the address itself. A
// single IPv6 customer owns a whole /64 (2^64 addresses), so counting each
// address separately would hand a scripted client a fresh budget per request;
// everything in the same /64 shares one bucket instead.
export function ipBucket(ip) {
  const raw = String(ip || 'unknown').trim().toLowerCase();
  if (!raw.includes(':') || raw.includes('.')) return raw; // IPv4, or IPv4-mapped IPv6
  const [head, tail = ''] = raw.split('::');
  const first = head ? head.split(':') : [];
  const last = raw.includes('::') && tail ? tail.split(':') : [];
  const missing = raw.includes('::') ? Math.max(0, 8 - first.length - last.length) : 0;
  const groups = [...first, ...Array(missing).fill('0'), ...last];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64';
}
