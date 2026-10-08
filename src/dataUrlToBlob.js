// Turns a data: URL (a signature canvas export, a captured photo) into a Blob
// without going through fetch().
//
// The Content Security Policy in vercel.json sets connect-src to 'self' and
// the Supabase origin, with no data:. Chromium treats fetch("data:...") as a
// connect-src request, so `await (await fetch(dataUrl)).blob()` is refused and
// the signature never uploads. Near Miss, Incident and Sign Afterwards all hit
// that. Decoding in place needs no network permission and works offline.
export function dataUrlToBlob(dataUrl) {
  const comma = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
  if (comma < 0 || !dataUrl.startsWith("data:")) throw new Error("Not a data URL");
  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = header.replace(/;base64$/i, "").split(";")[0] || "application/octet-stream";
  const bin = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
