// A stored storage path must sit under the caller's own prefix AND contain no
// dot or empty segments. supabase-js builds `object/sign/<bucket>/<path>` as a
// URL and WHATWG parsing collapses `..`, so `<co>/<id>/../../x` would
// otherwise sign a file in another bucket or company. Same rule as
// pathFromStoredUrl in server-lib/signedUrls.js.
export function isOwnedPath(path, prefix) {
  if (typeof path !== 'string' || !path.startsWith(prefix)) return false;
  return !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}
