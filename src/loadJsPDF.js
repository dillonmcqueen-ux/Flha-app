// src/loadJsPDF.js
// The single place the browser gets jsPDF.
//
// Every PDF generator used to carry its own byte-identical copy of a loader
// that injected `https://cdnjs.cloudflare.com/.../jspdf/2.5.1/jspdf.umd.min.js`
// as a <script> tag, with no Subresource Integrity hash, while the CSP in
// vercel.json allowed script-src from all of cdnjs. That put a third-party
// CDN inside the trust boundary of a logged-in session: anything served from
// that URL would have run with full access to the session token and every
// form on the page. `jspdf` is already a dependency of this project — it's
// what server-lib/reportPdfs.js and server-lib/gatehousePdf.js render with —
// so the browser now loads the copy we already ship and build.
//
// Two things fall out of this beyond the supply-chain fix:
//   - script-src in vercel.json is now 'self' with no CDN exception.
//   - Offline PDF generation gets a lot more likely to work. public/sw.js's
//     fetch handler passes cross-origin requests straight through by
//     design, so the cdnjs script could never be service-worker cached at
//     all — a queued submission draining with no signal
//     (docs/scope-offline-capability.md) was relying on the browser's own
//     HTTP cache still holding a third-party script. As a same-origin
//     chunk it goes through the cache-first static-asset path instead, so
//     it's cached from the first PDF generated after a deploy onward. Note
//     it is NOT precached at install: sw.js reads index.html's script/href
//     tags, and a lazily-imported chunk isn't referenced there. Making it
//     precached would mean either a build-time manifest (which sw.js
//     deliberately avoids) or a static import that puts ~390 kB into the
//     main bundle on every page load.
//
// Kept as a dynamic import so jsPDF stays in its own lazily-fetched chunk
// rather than being pulled into the main bundle — same "only paid for when
// you actually generate a PDF" behaviour the CDN loader had.
export async function loadJsPDF() {
  const { jsPDF } = await import("jspdf");
  return jsPDF;
}
