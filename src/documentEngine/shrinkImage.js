// Scales a picked photo down before it is stored in a draft or the offline
// queue. A phone photo is several MB; 1600 px on the long side is plenty for
// a field record. Non-images and anything that fails to decode pass through
// unchanged as a data URL.
export function readAsDataUrl(file) {
  return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
}

export async function shrinkImage(file, max = 1600) {
  const url = await readAsDataUrl(file);
  if (!/^data:image\/(png|jpeg|webp)/.test(url)) return url;
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 800 * 1024) return url;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } catch (e) { return url; }
}
