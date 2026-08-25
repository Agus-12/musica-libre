#!/bin/bash
# Pega esto en la terminal DENTRO de la carpeta musica-libre.
# Después abre GitHub Desktop → ves los cambios → Commit to main → Push.
set -e
cd "$(dirname "$0")"
test -f app/profile/page.js || { echo "No estás en la carpeta musica-libre"; exit 1; }

mkdir -p app/utils app/api/pagos/offline

cat > app/utils/offlineCupo.js << 'ENDFILE'
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
ENDFILE

cat > app/api/pagos/offline/route.js << 'ENDFILE'
import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

const LIMITE = 50;

function limpiarKeys(lista) {
  const out = [];
  const visto = new Set();
  for (const raw of lista || []) {
    const k = String(raw || "").trim().slice(0, 300);
    if (!k || visto.has(k)) continue;
    visto.add(k);
    out.push(k);
  }
  return out;
}

async function planDe(supabase, userId) {
  const { data: sub } = await supabase
    .from("suscripciones")
    .select("plan,estado,vence_en,acceso_libre,aura_libre")
    .eq("user_id", userId)
    .maybeSingle();
  const premium = Boolean(
    sub?.plan === "premium" &&
    sub?.estado === "active" &&
    (!sub?.vence_en || new Date(sub.vence_en) > new Date())
  );
  return { ilimitado: premium || Boolean(sub?.acceso_libre || sub?.aura_libre) };
}

async function contar(supabase, userId) {
  const { count } = await supabase
    .from("descargas_offline")
    .select("track_key", { count: "exact", head: true })
    .eq("user_id", userId);
  return count || 0;
}

async function keysDe(supabase, userId) {
  const { data } = await supabase
    .from("descargas_offline")
    .select("track_key")
    .eq("user_id", userId);
  return (data || []).map(r => r.track_key);
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const keys = await keysDe(supabase, user.id);
  return NextResponse.json({ ok: true, count: keys.length, keys });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { ilimitado } = await planDe(supabase, user.id);

  if (body.action === "sync") {
    const grupos = Array.isArray(body.grupos) ? body.grupos : [];
    const purge = Boolean(body.purge);
    const actuales = await keysDe(supabase, user.id);
    const setActual = new Set(actuales);
    const keep = new Set();
    const aInsertar = [];
    const duplicados = [];

    for (const g of grupos) {
      const aliases = limpiarKeys(g);
      if (!aliases.length) continue;
      const matches = aliases.filter(a => setActual.has(a));
      if (matches.length) {
        keep.add(matches[0]);
        for (const extra of matches.slice(1)) duplicados.push(extra);
        continue;
      }
      aInsertar.push(aliases[0]);
    }

    const extras = purge
      ? actuales.filter(k => !keep.has(k))
      : duplicados;
    if (extras.length) {
      await supabase.from("descargas_offline").delete().eq("user_id", user.id).in("track_key", extras);
    }

    let insertadas = 0;
    for (const k of aInsertar) {
      if (!ilimitado) {
        const n = await contar(supabase, user.id);
        if (n >= LIMITE) break;
      }
      const { error } = await supabase.from("descargas_offline").insert({ user_id: user.id, track_key: k });
      if (!error) insertadas++;
    }

    const count = await contar(supabase, user.id);
    return NextResponse.json({ ok: true, count, borradas: extras.length, insertadas });
  }

  const aliases = limpiarKeys([
    body.track_key,
    ...(Array.isArray(body.aliases) ? body.aliases : []),
    ...(Array.isArray(body.track_keys) ? body.track_keys : []),
  ]);
  if (!aliases.length) return NextResponse.json({ error: "Falta track_key" }, { status: 400 });

  const { data: yaRows } = await supabase
    .from("descargas_offline")
    .select("track_key")
    .eq("user_id", user.id)
    .in("track_key", aliases)
    .limit(1);

  if (yaRows && yaRows.length) return NextResponse.json({ ok: true, ya: true, count: await contar(supabase, user.id) });

  if (!ilimitado) {
    const n = await contar(supabase, user.id);
    if (n >= LIMITE) {
      return NextResponse.json({ error: "Límite gratuito alcanzado", count: n, limite: LIMITE }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from("descargas_offline")
    .insert({ user_id: user.id, track_key: aliases[0] });
  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      return NextResponse.json({ ok: true, ya: true, count: await contar(supabase, user.id) });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: await contar(supabase, user.id) });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.all) {
    const { error } = await supabase.from("descargas_offline").delete().eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: 0 });
  }

  const keys = limpiarKeys(
    Array.isArray(body.track_keys)
      ? body.track_keys
      : [body.track_key, ...(Array.isArray(body.aliases) ? body.aliases : [])]
  );
  if (!keys.length) return NextResponse.json({ error: "Falta track_key" }, { status: 400 });

  const { error } = await supabase
    .from("descargas_offline")
    .delete()
    .eq("user_id", user.id)
    .in("track_key", keys);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: await contar(supabase, user.id) });
}
ENDFILE

python3 << 'PY'
from pathlib import Path

# --- DownloadManager ---
p = Path("app/components/DownloadManager.js")
t = p.read_text()
t = t.replace(
'''.map(x => x.video_id || `${x.artist}|${x.name}`)
      );
      puedeGuardarOffline = unicas.size < 50;''',
'''.map(x => x.video_id || `${(x.artist || "").toLowerCase()}|${(x.name || "").toLowerCase()}`)
      );
      const servidor = Number(acceso.offline_count) || 0;
      puedeGuardarOffline = Math.max(unicas.size, servidor) < 50;'''
)
old = '''      const r = await fetch("/api/pagos/offline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track_key: String(track.key || sq).slice(0, 300) }) });'''
new = '''      const aliases = [
        String(track.key || ""),
        sq,
        track.video_id || "",
        data.video_id || "",
        `${track.artist || ""} ${track.name || ""}`.trim(),
        `${(track.artist || "").toLowerCase()}|${(track.name || "").toLowerCase()}`,
      ].filter(Boolean);
      const r = await fetch("/api/pagos/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_key: String(track.key || sq).slice(0, 300), aliases }),
      });'''
if old in t:
    t = t.replace(old, new, 1)
p.write_text(t)

# --- spotify ---
p = Path("app/spotify/page.js")
t = p.read_text()
t = t.replace(
'''        const unicas = new Set(Object.values(mp3s).filter(x => x?.audio_url).map(x => x.video_id || `${x.artist}|${x.name}`));
        if (!unicas.has(String(itemId)) && unicas.size >= 50) {''',
'''        const unicas = new Set(Object.values(mp3s).filter(x => x?.audio_url).map(x => x.video_id || `${(x.artist || "").toLowerCase()}|${(x.name || "").toLowerCase()}`));
        const servidor = Number(acceso.offline_count) || 0;
        if (Math.max(unicas.size, servidor) >= 50) {'''
)
p.write_text(t)

# --- profile ---
p = Path("app/profile/page.js")
t = p.read_text()
# quitar basura de intentos previos
cut = t.find("\n}\naActiva")
if cut != -1:
    t = t[:cut+2]
if 'from "../utils/offlineCupo"' not in t:
    t = t.replace(
        'import Explorar from "../spotify/page";\n',
        'import Explorar from "../spotify/page";\nimport { aliasesDe, gruposAliasLocales, LIMITE_FREE } from "../utils/offlineCupo";\n',
        1,
    )
t = t.replace(
    'const [estadoPremium, setEstadoPremium] = useState({ cargando: true, activo: false, plan: "free", estado: "free", acceso_libre: false });',
    'const [estadoPremium, setEstadoPremium] = useState({ cargando: true, activo: false, plan: "free", estado: "free", acceso_libre: false, offline_count: null, limite_offline: LIMITE_FREE });\n  const [syncCupo, setSyncCupo] = useState({ haciendo: false, listo: false });',
    1,
)
old = '''  async function cargarEstadoPremium() {
    try { const r = await fetch("/api/pagos/estado", { cache: "no-store" }); const d = await r.json(); if (r.ok) setEstadoPremium({ ...d, cargando: false }); }
    catch { setEstadoPremium(v => ({ ...v, cargando: false })); }
  }'''
new = '''  async function sincronizarCupoOffline(purge = false) {
    if (syncCupo.haciendo) return null;
    setSyncCupo({ haciendo: true, listo: false });
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const grupos = gruposAliasLocales(mp3s);
      const r = await fetch("/api/pagos/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", grupos, purge }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setEstadoPremium(v => ({ ...v, offline_count: d.count ?? v.offline_count }));
        setSyncCupo({ haciendo: false, listo: true });
        return d;
      }
    } catch {}
    setSyncCupo({ haciendo: false, listo: false });
    return null;
  }
  async function cargarEstadoPremium() {
    try {
      const [re, ra] = await Promise.all([
        fetch("/api/pagos/estado", { cache: "no-store" }),
        fetch("/api/pagos/acceso", { cache: "no-store" }),
      ]);
      const d = await re.json().catch(() => ({}));
      const a = await ra.json().catch(() => ({}));
      if (re.ok || ra.ok) {
        setEstadoPremium({
          ...d, ...a,
          activo: Boolean(d.activo || a.premium || a.ilimitado),
          acceso_libre: Boolean(d.acceso_libre || a.aura_libre),
          offline_count: a.offline_count ?? d.offline_count ?? null,
          limite_offline: a.ilimitado ? 0 : (a.limite_offline || LIMITE_FREE),
          cargando: false,
        });
      } else setEstadoPremium(v => ({ ...v, cargando: false }));
    } catch { setEstadoPremium(v => ({ ...v, cargando: false })); }
  }'''
if old in t and "async function sincronizarCupoOffline" not in t:
    t = t.replace(old, new, 1)
t = t.replace(
    '  useEffect(() => { if (vista === "cuenta" && user) { cargarEstadoPremium(); fetch("/api/pagos/config").then(r => r.json()).then(d => setMpPublicKey(d.public_key || "")).catch(() => {}); cargarPanelAdmin(); } }, [vista, user]);',
    '''  useEffect(() => {
    if (vista === "cuenta" && user) {
      (async () => {
        await sincronizarCupoOffline();
        await cargarEstadoPremium();
      })();
      fetch("/api/pagos/config").then(r => r.json()).then(d => setMpPublicKey(d.public_key || "")).catch(() => {});
      cargarPanelAdmin();
    }
  }, [vista, user]);''',
    1,
)
if 'body: JSON.stringify({ all: true })' not in t:
    t = t.replace(
        '      localStorage.removeItem("ml_offline");\n      setAlmacenamientoOffline({ cargando: false, canciones: 0, bytes: 0 });\n      try { refreshDownloads(); } catch {}',
        '      localStorage.removeItem("ml_offline");\n      setAlmacenamientoOffline({ cargando: false, canciones: 0, bytes: 0 });\n      try { await fetch("/api/pagos/offline", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }); } catch {}\n      setEstadoPremium(v => ({ ...v, offline_count: 0 }));\n      try { refreshDownloads(); } catch {}',
        1,
    )
t = t.replace(
    '''            .map(x => x.video_id || `${x.artist}|${x.name}`)
        );
        offlineUnicas = ids.size;
      } catch {}

      // Las descargas offline que ya están en cola también reservan espacio.''',
    '''            .map(x => x.video_id || `${(x.artist || "").toLowerCase()}|${(x.name || "").toLowerCase()}`)
        );
        offlineUnicas = ids.size;
      } catch {}
      try {
        const ra = await fetch("/api/pagos/acceso", { cache: "no-store" });
        const acc = await ra.json();
        if (ra.ok) servidor = Number(acc.offline_count) || 0;
      } catch {}

      // Las descargas offline que ya están en cola también reservan espacio.'''
)
if "let servidor = 0;" not in t:
    t = t.replace("      let offlineUnicas = 0;\n", "      let offlineUnicas = 0;\n      let servidor = 0;\n", 1)
t = t.replace("disponibles = Math.max(0, 50 - offlineUnicas - reservadas);",
              "disponibles = Math.max(0, LIMITE_FREE - Math.max(offlineUnicas, servidor) - reservadas);")

old = '''  async function reDownload(item) {
    if (item.online_only) {
      toast.info("Esta canción está disponible en modo YouTube y no cuenta como offline", 3500);
      return;
    }'''
new = '''  async function reDownload(item) {
    let ilimitado = false;
    let usados = 0;
    try {
      const r = await fetch("/api/pagos/acceso", { cache: "no-store" });
      const acceso = await r.json();
      if (r.ok) {
        ilimitado = Boolean(acceso.ilimitado);
        usados = Number(acceso.offline_count) || 0;
      }
    } catch {}
    if (!ilimitado && usados >= LIMITE_FREE) {
      toast.warning(`Límite Free: ${usados}/${LIMITE_FREE} offline. Borra una o pásate a Premium`, 5000);
      return;
    }'''
t = t.replace(old, new, 1)
if 'if (item.video_id) params.set("v", item.video_id);' not in t:
    t = t.replace(
        '      if (item.title) params.set("expected_song", item.title);\n',
        '      if (item.title) params.set("expected_song", item.title);\n      if (item.video_id) params.set("v", item.video_id);\n',
        1,
    )
old = '''          await fetch("/api/pagos/offline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track_key: String(item.key).slice(0, 300) })
          });'''
new = '''          const aliases = aliasesDe(item, item.key).concat(item.keys || []);
          const rr = await fetch("/api/pagos/offline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track_key: String(item.key).slice(0, 300), aliases })
          });
          if (!rr.ok) {
            const ed = await rr.json().catch(() => ({}));
            guardado = false;
            toast.warning(ed.error || "No hay cupo offline en tu cuenta", 4500);
          } else {
            const ed = await rr.json().catch(() => ({}));
            if (typeof ed.count === "number") setEstadoPremium(v => ({ ...v, offline_count: ed.count }));
          }'''
t = t.replace(old, new, 1)
old = '''        await fetch("/api/pagos/offline", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_keys: claves })
        });'''
new = '''        const aliases = aliasesDe(item, item.key).concat(claves);
        const rd = await fetch("/api/pagos/offline", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_keys: aliases })
        });
        const dd = await rd.json().catch(() => ({}));
        if (typeof dd.count === "number") setEstadoPremium(v => ({ ...v, offline_count: dd.count }));'''
t = t.replace(old, new, 1)

contador = '''        {!estadoPremium.cargando && !estadoPremium.acceso_libre && !estadoPremium.activo && (
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
              <span style={{fontSize:"0.78em",fontWeight:800,color:"var(--text2)"}}>
                {typeof estadoPremium.offline_count === "number" ? estadoPremium.offline_count : "—"} / {LIMITE_FREE} offline
              </span>
              <button onClick={async ()=>{ const d = await sincronizarCupoOffline(true); await cargarEstadoPremium(); if (d) toast.success(`Cupo de este teléfono: ${d.count}/${LIMITE_FREE}`, 3500); }} disabled={syncCupo.haciendo} style={{padding:"5px 9px",borderRadius:8,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text3)",fontSize:"0.68em",fontWeight:700,cursor:"pointer"}}>{syncCupo.haciendo ? "Sincronizando…" : "Ajustar a este teléfono"}</button>
            </div>
            <div style={{height:6,borderRadius:3,background:"var(--border2)",overflow:"hidden"}}>
              <div style={{height:"100%",width:Math.min(100, ((estadoPremium.offline_count || 0) / LIMITE_FREE) * 100)+"%",background:(estadoPremium.offline_count||0)>=LIMITE_FREE?"#ef4444":"linear-gradient(90deg,var(--accent),#22c55e)"}}/>
            </div>
            <div style={{color:"var(--text4)",fontSize:"0.66em",marginTop:6,lineHeight:1.45}}>Las canciones en modo YT no ocupan cupo. Tocá ⟳ en Descargadas para pasarlas a OFF si te queda lugar.</div>
          </div>
        )}
'''
needle = '{!estadoPremium.activo && !estadoPremium.acceso_libre && !pagoPlan &&'
if "Ajustar a este teléfono" not in t:
    t = t.replace(needle, contador + "        " + needle, 1)

p.write_text(t)
print("profile/download/spotify listos")
PY

echo ""
echo "LISTO. Ahora:"
echo "  1. Abre GitHub Desktop"
echo "  2. Vas a ver archivos cambiados"
echo "  3. Escribe el mensaje: Cupo Free: YT a OFF y contador de Supabase"
echo "  4. Commit to main"
echo "  5. Push origin"
