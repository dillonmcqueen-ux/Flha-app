// src/foraLogo.js
// The FORA brand mark used in PDF footers (public/fora-logo-dark.png, the dark-text variant for white pages), fetched
// once per page load and cached as a data URL so jsPDF's addImage() can
// embed it without re-fetching for every generated document.
let cached;

export async function getForaLogoDataUrl() {
  if (cached !== undefined) return cached;
  try {
    const resp = await fetch("/fora-logo-dark.png");
    const blob = await resp.blob();
    cached = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch (e) {
    cached = null;
  }
  return cached;
}
