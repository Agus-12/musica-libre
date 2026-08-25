const KEY = "ml_rechazadas";
export function claveCancion(artist, title) {
  const n = (s) => String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${n(artist)}|${n(title)}`;
}
function claveDe(artist, title) {
  return claveCancion(artist, title);
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
export function listarVerificadasLocales() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_OK) || "{}") || {};
    return Object.entries(all).map(([k, v]) => {
      const i = String(k).indexOf("|");
      return {
        artist: i >= 0 ? k.slice(0, i) : "",
        title: i >= 0 ? k.slice(i + 1) : String(k),
        video_id: (v && v.video_id) || "",
      };
    });
  } catch { return []; }
}
