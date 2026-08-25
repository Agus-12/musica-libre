const KEY = "ml_rechazadas";
function claveDe(artist, title) {
  return `${String(artist || "").toLowerCase().trim()}|${String(title || "").toLowerCase().trim()}`;
}
function leerTodo() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
  catch { return {}; }
}
export function rechazadasDe(artist, title) {
  const arr = leerTodo()[claveDe(artist, title)] || [];
  return arr.filter(id => /^[\w-]{11}$/.test(id));
}
export function marcarRechazada(artist, title, videoId) {
  const id = String(videoId || "").trim();
  if (!/^[\w-]{11}$/.test(id)) return rechazadasDe(artist, title);
  const all = leerTodo();
  const k = claveDe(artist, title);
  const set = new Set(all[k] || []);
  set.add(id);
  all[k] = [...set];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  return all[k];
}
const KEY_OK = "ml_verificadas";
export function estaVerificadaLocal(artist, title) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_OK) || "{}") || {};
    return Boolean(all[claveDe(artist, title)]);
  } catch { return false; }
}
export function marcarVerificadaLocal(artist, title, videoId) {
  const k = claveDe(artist, title);
  if (!k || k === "|") return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY_OK) || "{}") || {};
    all[k] = { video_id: String(videoId || ""), ts: Date.now() };
    localStorage.setItem(KEY_OK, JSON.stringify(all));
  } catch {}
}
