/* Cupo Free: una canción = una fila, aunque viva con varias claves
   locales (id de iTunes + "artista titulo"). */

export const LIMITE_FREE = 50;

export function normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function claveCanon(entry, key) {
  const vid = String(entry?.video_id || "").trim();
  if (/^[\w-]{11}$/.test(vid)) return `yt:${vid}`;
  const art = normTxt(entry?.artist);
  const nam = normTxt(entry?.name || entry?.title);
  if (art && nam) return `n:${art}|${nam}`;
  const k = String(key || "").slice(0, 300);
  return k || "";
}

export function aliasesDe(entry, key) {
  const out = new Set();
  const add = (v) => {
    const s = String(v || "").trim().slice(0, 300);
    if (s) out.add(s);
  };
  add(key);
  add(entry?.video_id);
  add(claveCanon(entry, key));
  const art = (entry?.artist || "").trim();
  const nam = (entry?.name || entry?.title || "").trim();
  if (art && nam) {
    add(`${art} ${nam}`);
    add(`${nam} ${art}`);
    add(`${art}|${nam}`);
    add(`${normTxt(art)}|${normTxt(nam)}`);
    add(`n:${normTxt(art)}|${normTxt(nam)}`);
  }
  if (nam) add(nam);
  return [...out];
}

export function unicasOfflineLocales(mp3s) {
  const grupos = new Map();
  for (const [key, e] of Object.entries(mp3s || {})) {
    if (!e?.audio_url) continue;
    const id = claveCanon(e, key) || String(key);
    const prev = grupos.get(id);
    if (!prev) grupos.set(id, { id, keys: [key], entry: e });
    else prev.keys.push(key);
  }
  return [...grupos.values()];
}

export function gruposAliasLocales(mp3s) {
  return unicasOfflineLocales(mp3s).map(g => aliasesDe(g.entry, g.keys[0]).concat(g.keys));
}
