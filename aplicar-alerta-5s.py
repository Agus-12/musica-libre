# -*- coding: utf-8 -*-
# Arregla la alerta de los 5s en canciones YA descargadas.
# Corre DENTRO de musica-libre:  python3 aplicar-alerta-5s.py
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
pr = ROOT / "app" / "profile" / "page.js"
if not pr.exists():
    print("ERROR: corre esto DENTRO de la carpeta musica-libre")
    sys.exit(1)

t = pr.read_text(encoding="utf-8")

if "const verifyTimerRef = useRef(null);" not in t:
    t = t.replace(
        "  const playingMetaRef = useRef({});\n",
        "  const playingMetaRef = useRef({});\n  const verifyTimerRef = useRef(null);\n  const verifyAskedRef = useRef(\"\");\n",
        1,
    )

FN = '''  function programarPreguntaVersion(item) {
    clearTimeout(verifyTimerRef.current);
    verifyTimerRef.current = null;
    setPreguntaVersion(null);
    if (!item || !item.key) return;
    if (estaVerificadaLocal(item.artist, item.title)) return;
    const snap = {
      key: item.key,
      title: item.title || "",
      artist: item.artist || "",
      video_id: item.video_id || "",
      audio_url: item.audio_url || "",
      keys: item.keys || [item.key],
    };
    verifyAskedRef.current = "";
    verifyTimerRef.current = setTimeout(async () => {
      const ahora = playingMetaRef.current || {};
      if (ahora.key && ahora.key !== snap.key) return;
      if (estaVerificadaLocal(ahora.artist || snap.artist, ahora.title || snap.title)) return;
      if (verifyAskedRef.current === snap.key) return;
      verifyAskedRef.current = snap.key;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 2000);
        const r = await fetch("/api/verificar-cancion?q=" + encodeURIComponent(((snap.artist || "") + " " + (snap.title || "")).trim()), { signal: ctrl.signal });
        clearTimeout(to);
        const d = await r.json().catch(() => ({}));
        if (d.verificada) {
          marcarVerificadaLocal(snap.artist, snap.title, d.videoId);
          return;
        }
      } catch {}
      const sigue = playingMetaRef.current || {};
      if (sigue.key && sigue.key !== snap.key) return;
      if (estaVerificadaLocal(snap.artist, snap.title)) return;
      setPreguntaVersion({ ...snap, ...sigue, key: snap.key });
    }, 5000);
  }

'''

if "function programarPreguntaVersion" not in t:
    if "if (!isPlaying || !playingKey || !enLinea) return;" in t:
        import re
        t2, n = re.subn(
            r"  useEffect\(\(\) => \{\n    if \(!isPlaying \|\| !playingKey \|\| !enLinea\) return;[\s\S]*?  \}, \[isPlaying, playingKey, enLinea\]\);\n",
            FN,
            t,
            count=1,
        )
        if n != 1:
            print("FALLO: no pude reemplazar el useEffect viejo")
            sys.exit(1)
        t = t2
    else:
        t = t.replace("  async function confirmarVersionSi()", FN + "  async function confirmarVersionSi()", 1)

# Llamar al arrancar audio / YouTube (una sola vez cada sitio)
if t.count("programarPreguntaVersion(item);") < 2:
    t = t.replace(
        "    setPreguntaVersion(null);\n    setProgress(0); setCurrentTime(0); setDuration(0);\n\n    try {\n      a.src = item.audio_url;",
        "    setPreguntaVersion(null);\n    setProgress(0); setCurrentTime(0); setDuration(0);\n    programarPreguntaVersion(item);\n\n    try {\n      a.src = item.audio_url;",
        1,
    )
    t = t.replace(
        "      playingMetaRef.current = { key: item.key, title: item.title || \"\", artist: item.artist || \"\", video_id: item.video_id || \"\", audio_url: item.audio_url || \"\", keys: item.keys || [item.key] };\n      ensurePlayer();\n      return;",
        "      playingMetaRef.current = { key: item.key, title: item.title || \"\", artist: item.artist || \"\", video_id: item.video_id || \"\", audio_url: item.audio_url || \"\", keys: item.keys || [item.key] };\n      programarPreguntaVersion(item);\n      ensurePlayer();\n      return;",
        1,
    )
    t = t.replace(
        "    setPreguntaVersion(null);\n    setProgress(0); setCurrentTime(0); setDuration(0);\n    try {\n      p.loadVideoById(item.video_id);",
        "    setPreguntaVersion(null);\n    setProgress(0); setCurrentTime(0); setDuration(0);\n    programarPreguntaVersion(item);\n    try {\n      p.loadVideoById(item.video_id);",
        1,
    )

if "clearTimeout(verifyTimerRef.current);" not in t:
    t = t.replace(
        "  function stopPlayback() {\n    deteniendoRef.current = true;\n    setTimeout(() => { deteniendoRef.current = false; }, 300);\n    clearTimeout(silTimerRef.current);",
        "  function stopPlayback() {\n    deteniendoRef.current = true;\n    setTimeout(() => { deteniendoRef.current = false; }, 300);\n    clearTimeout(verifyTimerRef.current);\n    verifyTimerRef.current = null;\n    setPreguntaVersion(null);\n    clearTimeout(silTimerRef.current);",
        1,
    )

pr.write_text(t, encoding="utf-8")

sw = ROOT / "public" / "sw.js"
if sw.exists():
    s = sw.read_text(encoding="utf-8")
    s = s.replace('const AURA_BUILD = "dev";', 'const AURA_BUILD = "2026-08-25-verif";')
    s = s.replace("ml-static-v7", "ml-static-v8")
    sw.write_text(s, encoding="utf-8")
    print("OK public/sw.js")

nov = ROOT / "public" / "novedades.json"
nov.write_text(
    '{\n  "version": "25 de agosto, 2026 · v18",\n  "titulo": "Es esta la cancion?",\n  "cambios": [\n    "A los 5 segundos te pregunta si es la version correcta, tambien en canciones que ya tenias",\n    "Si decís que sí, queda guardada en la Mini para todos",\n    "Si no es, se borra y busca otra",\n    "Boton No es esta en Descargadas"\n  ]\n}\n',
    encoding="utf-8",
)
print("OK public/novedades.json")

ok = (
    "function programarPreguntaVersion" in pr.read_text(encoding="utf-8")
    and "if (!isPlaying || !playingKey || !enLinea) return;" not in pr.read_text(encoding="utf-8")
    and pr.read_text(encoding="utf-8").count("programarPreguntaVersion(item)") >= 2
)
print("LISTO" if ok else "FALLO")
if not ok:
    sys.exit(1)
