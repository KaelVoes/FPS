export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmtTimer(secs) {
  if (!Number.isFinite(secs)) return '--:--';
  secs = Math.max(0, Math.ceil(secs));
  const m = Math.floor(secs / 60), s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
export function tint(G, geo, r, g, b) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b; }
  geo.setAttribute('color', new G.THREE.BufferAttribute(a, 3));
  return geo;
}
export function raySphere(G, rayO, rayD, center, radius, maxDist) {
  const oc = new G.THREE.Vector3().subVectors(rayO, center);
  const b = oc.dot(rayD), c = oc.dot(oc) - radius * radius, disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 || t > maxDist ? -1 : t;
}