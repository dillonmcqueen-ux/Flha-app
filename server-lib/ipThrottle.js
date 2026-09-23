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
