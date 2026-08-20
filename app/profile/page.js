"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import { useToast } from "../components/ToastContext";
import { useDownloads } from "../components/DownloadManager";
import Explorar from "../spotify/page";

let ytApiLoaded = false;
let ytApiPromise = null;
function loadYTAPI() {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => { ytApiLoaded = true; resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    setTimeout(() => { if (!ytApiLoaded) { ytApiLoaded = true; resolve(); } }, 5000);
  });
  return ytApiPromise;
}

function Ico({ d, size = 14, fill = "none", stroke = "currentColor", sw = 2, viewBox = "0 0 24 24" }) {
  return <svg width={size} height={size} viewBox={viewBox} fill={fill} stroke={stroke} strokeWidth={sw}>{d}</svg>;
}

/* Iconos de transporte dibujados en la grilla completa 24x24 para que
   llenen bien el círculo (antes usaban coords 0-12 dentro de un viewBox
   0 0 24 24, por eso se veían diminutos y descentrados). */
const IcoPlay = ({ size = 14, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
       style={{ display: "block", marginLeft: size * 0.08 }}>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/>
  </svg>
);

const IcoPause = ({ size = 14, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: "block" }}>
    <rect x="6" y="4" width="4.2" height="16" rx="1.4"/>
    <rect x="13.8" y="4" width="4.2" height="16" rx="1.4"/>
  </svg>
);

const IcoStop = ({ size = 14, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: "block" }}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/>
  </svg>
);

export default function ProfilePage() {
  const { user, profile, favorites, playlists, loading, isFavorite, toggleFavorite, loadFavorites, loadPlaylists, checkSession } = useUser();
  const [tab, setTab] = useState("downloads");
  const [favType, setFavType] = useState("album");
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [downloadingItems, setDownloadingItems] = useState({});
  const toast = useToast();
  const { queue, removeByKeys, enqueueAlbum } = useDownloads();

  const [playingKey, setPlayingKey] = useState(null);
  const [playingTitle, setPlayingTitle] = useState("");
  const [playingArtist, setPlayingArtist] = useState("");
  const [playingCover, setPlayingCover] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const playerRef = useRef(null);
  const progressRef = useRef(null);
  const playerReadyRef = useRef(false);   // el iframe de YouTube ya está listo
  const playerInitRef = useRef(null);     // promesa de creación (evita duplicados)
  const pendingRef = useRef(null);        // canción a tocar apenas el player esté listo
  const kickRef = useRef(null);           // reintentos de play
  const mediaFixRef = useRef(null);       // reescritura de la portada en la pantalla de bloqueo
  const wakeRef = useRef(null);           // reanudar al volver a la app
  const audioRef = useRef(null);          // <audio> para archivos guardados (offline)
  const finRealRef = useRef(0);           // duración real (iTunes): corta colas de ruido
  const enSilencioRef = useRef(false);    // el elemento está tocando el silencio guardián
  const posPausaRef = useRef(0);          // dónde quedó la canción real
  const silTimerRef = useRef(null);
  const deteniendoRef = useRef(false);    // true mientras el usuario DETIENE del todo
  /* iOS congela la PWA ~30 s después de pausar y el play de la pantalla
     bloqueada llegaba a una app dormida. Solución: al pausar, EL MISMO
     reproductor cambia a un silencio en loop — la sesión de audio nunca
     muere, la app sigue despierta y el play responde siempre. Un
     segundo elemento no sirve: iOS bloquea audios nuevos en segundo
     plano; el mismo elemento ya está "bendecido" por tu toque. */
  function pausarConGuardian() {
    // Pausa simple y honesta. (iOS congela las PWA pausadas ~30 s
    // después: es un límite de Apple que ningún truco web vence bien.)
    const a = audioRef.current;
    if (!a) return;
    posPausaRef.current = a.currentTime || 0;
    try { a.pause(); } catch {}
    setIsPlaying(false);
    try { navigator.mediaSession.playbackState = "paused"; } catch {}
  }
  function reanudarDeGuardian() {
    const a = audioRef.current;
    if (!a) return;
    const destino = posPausaRef.current || a.currentTime || 0;
    const pr = a.play();
    if (pr && pr.catch) pr.catch(() => {
      // iOS congeló el elemento: recargar en el mismo punto y reintentar
      try {
        a.load();
        const alCargar = () => { try { a.currentTime = destino; } catch {} a.removeEventListener("loadedmetadata", alCargar); };
        a.addEventListener("loadedmetadata", alCargar);
        const pr2 = a.play();
        if (pr2 && pr2.catch) pr2.catch(() => {});
      } catch {}
    });
    setIsPlaying(true);
    try { navigator.mediaSession.playbackState = "playing"; } catch {}
  } const historialRef = useRef([]);        // memoria del aleatorio (no repetir)
  const colaRef = useRef([]);             // cola "reproducir a continuación"
  const ordenAleatorioRef = useRef([]);   // orden pre-generado del aleatorio (visible en la cola)
  const [showCola, setShowCola] = useState(false);
  const [, setTickCola] = useState(0);
  const refrescarCola = () => setTickCola(t => t + 1);
  const [swipeCola, setSwipeCola] = useState({ key: null, dx: 0, x0: 0 });

  function regenerarOrdenAleatorio(excluirKey) {
    const lista = visibleList();
    const pool = lista.map(x => x.key).filter(k => k !== excluirKey);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    ordenAleatorioRef.current = pool;
  }
  function quitarDeColaYSonar(item) {
    quitarDeCola(item.key);
    startTrack(item);
  }
  function quitarDeCola(k) {
    colaRef.current = colaRef.current.filter(x => x !== k);
    refrescarCola();
  }
  /* Lo que viene: primero tu cola manual, después el orden real
     (aleatorio pre-generado o secuencial). */
  function proximas(max = 20) {
    const lista = visibleList();
    const porKey = new Map(lista.map(x => [x.key, x]));
    const manual = colaRef.current.map(k => porKey.get(k)).filter(Boolean);
    let resto = [];
    if (shuffle) {
      resto = ordenAleatorioRef.current.map(k => porKey.get(k)).filter(Boolean);
    } else {
      const i = lista.findIndex(x => x.key === playingKey);
      resto = i >= 0 ? [...lista.slice(i + 1), ...(repeat === "all" ? lista.slice(0, i) : [])] : lista;
    }
    const enManual = new Set(colaRef.current);
    resto = resto.filter(x => !enManual.has(x.key) && x.key !== playingKey);
    return { manual, resto: resto.slice(0, max) };
  }
  const usingAudioRef = useRef(false);    // ¿estamos usando el archivo o YouTube?
  const seekingRef = useRef(false);       // espejo de `seeking` para los eventos
  const [isOnline, setIsOnline] = useState(true);
  const [downloadedMusic, setDownloadedMusic] = useState([]);

  // Arrastre de la barra de progreso estilo iTunes
  const [seeking, setSeeking] = useState(false);
  const [seekPct, setSeekPct] = useState(0);
  const barRef = useRef(null);

  // Buscador, orden aleatorio, repetición y vista ampliada (celular)
  const [search, setSearch] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off");   // off | all | one
  /* ── Letras (lrclib): con resaltado sincronizado tipo karaoke ── */
  const [showLetra, setShowLetra] = useState(false);
  const [letra, setLetra] = useState(null);            // {lineas:[{t,texto}], plain, encontrada}
  const [letraCargando, setLetraCargando] = useState(false);
  const letraDeRef = useRef("");                        // para qué canción es la letra cargada
  const lineaRefs = useRef([]);

  function parseLRC(texto) {
    const out = [];
    for (const ln of (texto || "").split("\n")) {
      const m = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/.exec(ln);
      if (m) {
        const t = Number(m[1]) * 60 + Number(m[2]);
        const txt = m[3].trim();
        if (txt) out.push({ t, texto: txt });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  async function abrirLetra() {
    setShowLetra(true);
    const clave = (playingArtist || "") + "|" + (playingTitle || "");
    if (letraDeRef.current === clave && letra) return;   // ya la tenemos
    setLetra(null); setLetraCargando(true);
    try {
      const p = new URLSearchParams({ artista: playingArtist || "", cancion: playingTitle || "" });
      if (duration > 30) p.set("dur", String(Math.round(duration)));
      const r = await fetch("/api/letras?" + p);
      const d = await r.json();
      letraDeRef.current = clave;
      setLetra({
        encontrada: Boolean(d.encontrada),
        lineas: parseLRC(d.synced),
        plain: d.plain || "",
      });
    } catch { setLetra({ encontrada: false, lineas: [], plain: "" }); }
    setLetraCargando(false);
  }

  // Línea activa según el tiempo actual (para el resaltado karaoke)
  const lineaActiva = (letra && letra.lineas.length)
    ? letra.lineas.reduce((acc, l, i) => (currentTime >= l.t - 0.3 ? i : acc), -1)
    : -1;
  const letraContRef = useRef(null);
  useEffect(() => {
    if (!showLetra || lineaActiva < 0) return;
    /* Scroll SOLO dentro del panel de letra. scrollIntoView arrastraba
       también a los contenedores padres: todo el reproductor se iba
       subiendo y tapaba la X de cerrar. */
    try {
      const cont = letraContRef.current;
      const el = lineaRefs.current[lineaActiva];
      if (cont && el) {
        const destino = el.offsetTop - cont.clientHeight / 2 + el.clientHeight / 2;
        cont.scrollTo({ top: Math.max(0, destino), behavior: "smooth" });
      }
    } catch {}
  }, [lineaActiva, showLetra]);

  const [expanded, setExpanded] = useState(false);

  /* ── Personalización + Amigos ── */
  /* Sección activa: musica | playlists | cuenta (la elige el menú).
     Cambiar de sección NO recarga la página: la música no se corta. */
  const [vista, setVista] = useState("explorar");
  useEffect(() => {
    try { const v = localStorage.getItem("aura_vista"); if (v) setVista(v); } catch {}
    const alVista = (e) => setVista(e.detail || "musica");
    window.addEventListener("aura-vista", alVista);
    return () => window.removeEventListener("aura-vista", alVista);
  }, []);
  useEffect(() => {
    if (vista === "playlists") { setTab("playlists"); setSelectedPlaylist(null); }
    else if (vista === "cuenta") setTab("cuenta");
    else if (vista === "explorar") setTab("explorar");
    else if (!["downloads", "favorites", "stats"].includes(tab)) setTab("downloads");
    /* Cambio de sección = página nueva: arrancar desde ARRIBA. Sin esto,
       el scroll de la sección anterior (p. ej. bien abajo en Mi música)
       se quedaba pegado y en iOS la nueva vista rebotaba al scrollear. */
    try { window.scrollTo(0, 0); } catch {}
  }, [vista]);

  /* ── REPRODUCTOR GLOBAL ──────────────────────────────────────────
     Explorar (embebido) manda lo que quiera reproducir por un evento
     y suena en ESTE reproductor (el único de la app). */
  const startTrackRef = useRef(null);
  /* Abrir algo en Explorar SIN recargar (la música sigue sonando) */
  function irAExplorar(destino) {
    try { localStorage.setItem("aura_explorar_destino", JSON.stringify(destino || {})); } catch {}
    try { localStorage.setItem("aura_vista", "explorar"); } catch {}
    setVista("explorar");
    setTimeout(() => { try { window.dispatchEvent(new CustomEvent("aura-explorar-destino", { detail: destino || {} })); } catch {} }, 60);
  }
  useEffect(() => {
    window.__auraPlayerGlobal = true;
    const alReproducir = (e) => {
      const d = e.detail || {};
      if (!d.key) return;
      try { startTrackRef.current && startTrackRef.current({
        key: String(d.key),
        title: d.title || "",
        artist: d.artist || "",
        cover_url: d.cover_url || "",
        audio_url: d.audio_url || "",
        video_id: d.video_id || "",
        duration_ms: d.duration_ms || null,
        keys: [String(d.key)],
      }); } catch {}
    };
    window.addEventListener("aura-reproducir", alReproducir);
    return () => {
      window.__auraPlayerGlobal = false;
      window.removeEventListener("aura-reproducir", alReproducir);
    };
  }, []);

  const [showCustom, setShowCustom] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [temaAct, setTemaAct] = useState("oscuro");
  const [accentAct, setAccentAct] = useState("#7c5cfc");
  const [fuenteAct, setFuenteAct] = useState("");
  const [amigos, setAmigos] = useState([]);
  const [amigosError, setAmigosError] = useState("");
  const [buscaAmigo, setBuscaAmigo] = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const buscaTimer = useRef(null);

  const [sinDatos, setSinDatos] = useState(false);
  // "En línea" DE VERDAD: con el Modo sin datos activo, la app se
  // comporta como offline aunque haya datos móviles disponibles.
  const enLinea = isOnline && !sinDatos;
  async function aplicarSinDatos(activar) {
    setSinDatos(activar);
    try {
      localStorage.setItem("aura_sin_datos", activar ? "1" : "");
      const c = await caches.open("ml-config");
      if (activar) await c.put("modo-sin-datos", new Response("1"));
      else await c.delete("modo-sin-datos");
      window.dispatchEvent(new CustomEvent("aura-sin-datos", { detail: activar }));
    } catch {}
    toast.info(activar ? "Modo sin datos ACTIVO: la app no tocará internet" : "Modo sin datos apagado", 3500);
  }
  useEffect(() => {
    try {
      setSinDatos(localStorage.getItem("aura_sin_datos") === "1");
      setTemaAct(localStorage.getItem("aura_tema") === "claro" ? "claro" : "oscuro");
      setAccentAct(localStorage.getItem("aura_accent") || "#7c5cfc");
      setFuenteAct(localStorage.getItem("aura_fuente") || "");
    } catch {}
    cargarAmigos();
    cargarBuzon();
    const alCambiarDatos = (e) => setSinDatos(Boolean(e.detail));
    window.addEventListener("aura-sin-datos", alCambiarDatos);
    return () => window.removeEventListener("aura-sin-datos", alCambiarDatos);
  }, []);

  /* Si una llamada da 401 (sesión caducada), renovamos la sesión con
     /api/auth (usa el refresh token) y reintentamos UNA vez. Solo si
     de verdad murió, avisamos que hay que volver a entrar. */
  async function fetchConSesion(url, opts) {
    let r = await fetch(url, opts);
    if (r.status === 401) {
      try { await fetch("/api/auth"); } catch {}
      r = await fetch(url, opts);
      if (r.status === 401) {
        toast.warning("Tu sesión caducó: cerrá sesión (menú) y volvé a entrar", 5000);
      }
    }
    return r;
  }

  function sincronizarAjustes(cambios) {
    // Guarda tema/color/fuente en tu cuenta (te siguen a otros dispositivos)
    try {
      const actual = {
        tema: localStorage.getItem("aura_tema") || "oscuro",
        accent: localStorage.getItem("aura_accent") || "#7c5cfc",
        fuente: localStorage.getItem("aura_fuente") || "",
        ...cambios,
      };
      fetchConSesion("/api/ajustes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actual) }).catch(() => {});
    } catch {}
  }
  function aplicarTema(v) {
    setTemaAct(v);
    try {
      localStorage.setItem("aura_tema", v);
      document.documentElement.classList.toggle("tema-claro", v === "claro");
    } catch {}
    sincronizarAjustes({ tema: v });
  }
  function aplicarAccent(c) {
    setAccentAct(c);
    try {
      localStorage.setItem("aura_accent", c);
      document.documentElement.style.setProperty("--accent", c);
    } catch {}
    sincronizarAjustes({ accent: c });
  }
  function aplicarFuente(f) {
    setFuenteAct(f);
    try {
      if (f) { localStorage.setItem("aura_fuente", f); document.documentElement.setAttribute("data-fuente", f); }
      else { localStorage.removeItem("aura_fuente"); document.documentElement.removeAttribute("data-fuente"); }
    } catch {}
    sincronizarAjustes({ fuente: f });
  }
  /* ── Notificaciones push (aunque la app esté cerrada) ── */
  const [pushOn, setPushOn] = useState(false);
  const VAPID_PUB = "BGtFZHPcbMcTfR4lyetmKGuQQvHfdRpc5df4ZDLn0FpDFoxfeDQWRvZVW4uEx8VS_bIwz8xtutlDXoKseeOOBAs";
  function b64aBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  useEffect(() => {
    (async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        const sub = await reg?.pushManager?.getSubscription();
        setPushOn(Boolean(sub) && Notification.permission === "granted");
      } catch {}
    })();
  }, []);
  async function activarPush() {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        toast.warning("Tu navegador no soporta notificaciones push. En iPhone: agregá AURA a la pantalla de inicio primero.", 5000);
        return;
      }
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") { toast.warning("Permiso de notificaciones denegado", 3500); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(VAPID_PUB) });
      const r = await fetchConSesion("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      const d = await r.json();
      if (d.ok) { setPushOn(true); toast.success("Notificaciones activadas", 3500); }
      else toast.warning(d.error || "No se pudo", 4000);
    } catch (e) {
      toast.error("No se pudo activar: " + String(e.message || e).slice(0, 60), 4000);
    }
  }
  async function desactivarPush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try { await fetchConSesion("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch {}
        await sub.unsubscribe();
      }
      setPushOn(false);
      toast.info("Notificaciones desactivadas", 3000);
    } catch {}
  }
  async function cargarAmigos() {
    try {
      const r = await fetchConSesion("/api/friends");
      const d = await r.json();
      if (d.amigos) { setAmigos(d.amigos); setAmigosError(""); }
      else if (d.error) setAmigosError(d.error);
    } catch {}
  }
  function buscarUsuarios(texto) {
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    if (!texto.trim()) { setSugerencias([]); return; }
    buscaTimer.current = setTimeout(async () => {
      try {
        const r = await fetchConSesion("/api/friends?buscar=" + encodeURIComponent(texto.trim()));
        const d = await r.json();
        setSugerencias(d.usuarios || []);
      } catch {}
    }, 350);
  }
  async function agregarAmigo(username) {
    try {
      const r = await fetchConSesion("/api/friends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      const d = await r.json();
      if (d.ok) { toast.success("Amigo agregado: @" + username, 3000); cargarAmigos(); }
      else toast.warning(d.error || "No se pudo", 3500);
    } catch { toast.error("Error de red", 3000); }
  }
  async function quitarAmigo(id) {
    try {
      await fetchConSesion("/api/friends", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ friend_id: id }) });
      cargarAmigos();
    } catch {}
  }

  /* ── Perfil de un amigo (sus favoritos + playlists públicas) ── */
  const [amigoVista, setAmigoVista] = useState(null);      // {perfil, favoritos, playlists}
  const [amigoCargando, setAmigoCargando] = useState(false);
  async function verAmigo(a) {
    setAmigoCargando(true); setAmigoVista({ perfil: a, favoritos: [], playlists: [] });
    try {
      const r = await fetchConSesion("/api/friends/perfil?id=" + encodeURIComponent(a.id));
      const d = await r.json();
      if (d.perfil) setAmigoVista(d);
      else { toast.warning(d.error || "No se pudo cargar", 3500); setAmigoVista(null); }
    } catch { setAmigoVista(null); }
    setAmigoCargando(false);
  }

  /* ── Compartir canciones con amigos + buzón ── */
  const [compartirItem, setCompartirItem] = useState(null); // item a enviar
  const [buzon, setBuzon] = useState([]);
  async function cargarBuzon() {
    try {
      const r = await fetchConSesion("/api/shares");
      const d = await r.json();
      setBuzon(d.recibidos || []);
    } catch {}
  }
  async function enviarShare(amigo) {
    const it = compartirItem;
    if (!it) return;
    try {
      const r = await fetchConSesion("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        to_id: amigo.id,
        item: { type: it.type || "track", name: it.title || it.name, artist: it.artist || "", cover: it.cover_url || it.cover || "", album_id: it.album_id || "", playlist_id: it.playlist_id || "", source: "itunes" },
      }) });
      const d = await r.json();
      if (d.ok) toast.success("Enviada a @" + amigo.username, 3000);
      else toast.warning(d.error || "No se pudo enviar", 3500);
    } catch { toast.error("Error de red", 3000); }
    setCompartirItem(null);
  }
  function encolarSiguiente(item) {
    colaRef.current = [...colaRef.current.filter(k => k !== item.key), item.key];
    refrescarCola();
    toast.success("Sonará a continuación: " + item.title, 2500);
  }

  /* Descargar TODA la playlist para el modo sin internet */
  function descargarPlaylist() {
    const tracks = (playlistItems || [])
      .filter(i => i.item_type === "track")
      .map(i => ({
        key: String(i.item_id),
        name: i.name,
        artist: i.artist || "",
        cover: i.cover_url || "",
        duration_ms: i.extra_data?.duration_ms || null,
      }));
    if (!tracks.length) { toast.warning("Esta playlist no tiene canciones", 3000); return; }
    enqueueAlbum(selectedPlaylist?.name || "Playlist", tracks);
    toast.success(`Descargando ${tracks.length} canciones de "${selectedPlaylist?.name}"`, 4000);
    setTab("downloads");
  }

  /* Ver una playlist que te compartieron (es pública) */
  const [plCompartida, setPlCompartida] = useState(null);   // {nombre, items, cargando}
  async function verPlaylistCompartida(share) {
    setPlCompartida({ nombre: share.item?.name || "Playlist", items: [], cargando: true });
    try {
      const r = await fetch("/api/playlists?id=" + encodeURIComponent(share.item?.playlist_id || ""));
      const d = await r.json();
      setPlCompartida({ nombre: d.playlist?.name || share.item?.name || "Playlist", items: d.items || [], cargando: false });
    } catch { setPlCompartida(p => p ? { ...p, cargando: false } : null); }
  }
  function descargarPlaylistCompartida() {
    const tracks = (plCompartida?.items || [])
      .filter(i => i.item_type === "track")
      .map(i => ({ key: String(i.item_id), name: i.name, artist: i.artist || "", cover: i.cover_url || "", duration_ms: i.extra_data?.duration_ms || null }));
    if (!tracks.length) { toast.warning("No tiene canciones", 3000); return; }
    enqueueAlbum(plCompartida?.nombre || "Playlist", tracks);
    toast.success(`Descargando ${tracks.length} canciones`, 4000);
    setPlCompartida(null); setShowFriends(false); setTab("downloads");
  }

  async function borrarShare(id) {
    try { await fetchConSesion("/api/shares", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch {}
    setBuzon(prev => prev.filter(s => s.id !== id));
  }

  // Espejo del estado para los callbacks del player (que se registran una vez
  // y si no, verían valores viejos).
  const liveRef = useRef({ list: [], playingKey: null, shuffle: false, repeat: "off" });

  function refreshDownloads() {
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const offline = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      const items = [];
      for (const [key, entry] of Object.entries(mp3s)) {
        // Antes descartabamos entradas vacias, pero si Vercel rechazaba
        // todos los candidatos (ej: Karol G sin video oficial en YouTube),
        // la cancion nunca aparecia en Descargadas. La mostramos aunque
        // este vacia para que el usuario sepa que se intento.
        if (!entry.video_id && !entry.apple_url && !entry.audio_url && !entry.title) continue;
        /* Preferimos los datos REALES de la canción (guardados por el
           gestor de descargas): carátula del álbum y nombre de iTunes.
           El título del video de YouTube queda como último recurso. */
        let coverUrl = entry.cover || "", artistName = entry.artist || "", trackName = entry.name || entry.title || key;
        const oe = offline[key];
        if (oe) {
          // Ignoramos miniaturas de video de YouTube guardadas por
          // versiones viejas: acá va la carátula del álbum o nada.
          const oeCover = oe.cover_url && !/ytimg|img\.youtube/i.test(oe.cover_url) ? oe.cover_url : "";
          coverUrl = coverUrl || oeCover;
          artistName = artistName || oe.artist || "";
          if (!entry.name) trackName = oe.name || trackName;
        }
        if (!coverUrl) {
          const fm = favorites.find(f => [String(f.item_id), (f.artist+" "+f.name).trim(), (f.name+" "+f.artist).trim(), f.name.trim()].includes(key));
          if (fm) { coverUrl = fm.cover_url || ""; artistName = fm.artist || ""; trackName = fm.name || trackName; }
        }
        items.push({ key, title: trackName, artist: artistName, cover_url: coverUrl, video_id: entry.video_id || "", audio_url: entry.audio_url || "", apple_url: entry.apple_url || "", method: entry.method || (entry.video_id ? "youtube" : "apple"), duration_ms: entry.duration_ms || null, saved_at: entry.saved_at || 0 });
      }

      /* Cada canción se guarda con DOS claves ("artista titulo" y el id de la
         pista) para poder buscarla de las dos formas. Eso hacía que apareciera
         DUPLICADA en la lista. Acá agrupamos por la canción real y mostramos
         una sola vez, quedándonos con la entrada más completa (la que tiene
         portada y artista) y recordando todas sus claves para poder borrarlas
         juntas. */
      const grupos = new Map();
      for (const it of items) {
        const id = it.video_id || it.audio_url || it.apple_url
          || (it.artist + "|" + it.title).toLowerCase().trim();
        const prev = grupos.get(id);
        if (!prev) {
          grupos.set(id, { ...it, keys: [it.key] });
        } else {
          prev.keys.push(it.key);
          // Nos quedamos con los datos más completos entre las dos entradas
          const puntaje = (x) => (x.cover_url ? 2 : 0) + (x.artist ? 1 : 0);
          if (puntaje(it) > puntaje(prev)) {
            const keys = prev.keys;
            grupos.set(id, { ...it, keys });
          }
          prev.saved_at = Math.max(prev.saved_at, it.saved_at);
        }
      }

      const unicos = Array.from(grupos.values());
      unicos.sort((a, b) => b.saved_at - a.saved_at);
      setDownloadedMusic(unicos);
    } catch { setDownloadedMusic([]); }
  }

  useEffect(() => { refreshDownloads(); }, [favorites, queue]);

  /* "Seguir escuchando" (desde Descubrir): al llegar con una canción
     marcada, la reproducimos de una y limpiamos la marca. */
  const autoplayHechoRef = useRef(false);
  useEffect(() => {
    if (autoplayHechoRef.current || !downloadedMusic.length) return;
    try {
      const k = localStorage.getItem("aura_autoplay");
      if (!k) return;
      const item = downloadedMusic.find(x => String(x.key) === k || (x.keys || []).includes(k));
      if (item) {
        autoplayHechoRef.current = true;
        localStorage.removeItem("aura_autoplay");
        setTimeout(() => { try { startTrack(item); setExpanded(true); } catch {} }, 400);
      } else {
        localStorage.removeItem("aura_autoplay");
      }
    } catch {}
  }, [downloadedMusic]);

  /* CLAVE PARA EL AUTOPLAY: creamos el reproductor apenas carga la página,
     NO cuando tocás una canción. Antes el iframe nacía dentro del click y
     tardaba en estar listo; para cuando respondía, el navegador ya había
     descartado el "gesto del usuario" y bloqueaba el sonido — por eso había
     que darle play una segunda vez. Ahora, al tocar, el player ya existe y
     playVideo() se ejecuta dentro del mismo gesto. */
  useEffect(() => { ensurePlayer(); }, []);

  useEffect(() => {
    if (!isPlaying) return;
    // Lee el progreso del reproductor real (audio guardado o YouTube).
    // OJO: usamos `seekingRef.current` (no `seeking`) para no re-armar el
    // setInterval cada vez que cambia el estado de "estoy arrastrando". Eso
    // era lo que hacía oscilar la barra (race entre seeks y polls).
    const tick = () => {
      if (seekingRef.current) return;
      try {
        if (usingAudioRef.current && audioRef.current) {
          const a = audioRef.current;
          const d = a.duration;
          if (!isNaN(d) && d > 0 && !isNaN(a.currentTime)) {
            setCurrentTime(a.currentTime);
            setDuration(d);
            setProgress((a.currentTime / d) * 100);
          }
          return;
        }
        const p = playerRef.current;
        if (!p || !playerReadyRef.current) return;
        const t = p.getCurrentTime();
        const d = p.getDuration();
        if (typeof t === "number" && typeof d === "number" && d > 0) {
          setCurrentTime(t);
          setDuration(d);
          setProgress((t / d) * 100);
        }
      } catch {}
    };
    progressRef.current = setInterval(tick, 200);
    return () => clearInterval(progressRef.current);
  }, [isPlaying]);

  // Con el reproductor desplegado, bloqueamos el scroll del fondo (como iTunes)
  useEffect(() => {
    if (expanded) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [expanded]);

  // Si se cierra la reproducción, replegamos la pantalla completa
  useEffect(() => { if (playingKey === null) setExpanded(false); }, [playingKey]);

  // Limpieza de temporizadores al desmontar
  useEffect(() => () => {
    if (kickRef.current) clearInterval(kickRef.current);
    if (mediaFixRef.current) mediaFixRef.current.forEach(clearTimeout);
    if (wakeRef.current) clearInterval(wakeRef.current);
  }, []);

  // Estado de conexión (para el modo offline)
  useEffect(() => {
    const set = () => setIsOnline(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => { window.removeEventListener("online", set); window.removeEventListener("offline", set); };
  }, []);

  /* Que la música NO se corte al salir de la app.
     Cuando el celular manda el navegador a segundo plano, suele pausar el
     iframe. Al volver, si estábamos reproduciendo, lo reanudamos. Además
     mantenemos viva la sesión con un "latido" mientras suena. */
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      if (!playerRef.current || !playerReadyRef.current) return;
      if (!isPlaying) return;
      try {
        const st = playerRef.current.getPlayerState();
        if (st !== 1) { playerRef.current.playVideo(); kickPlay(); }
      } catch {}
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [isPlaying]);

  // Latido: si el sistema pausa el video por estar en segundo plano, reanudar
  useEffect(() => {
    if (!isPlaying) {
      if (wakeRef.current) { clearInterval(wakeRef.current); wakeRef.current = null; }
      return;
    }
    wakeRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p || !playerReadyRef.current) return;
      try {
        // Estado 2 = pausado. Si nosotros creemos que suena, lo despertamos.
        if (p.getPlayerState() === 2) p.playVideo();
      } catch {}
    }, 1000);
    return () => { if (wakeRef.current) { clearInterval(wakeRef.current); wakeRef.current = null; } };
  }, [isPlaying]);

  // ── Arrastre de la barra (mouse + touch), estilo iTunes ──
  function pctFromEvent(e) {
    const bar = barRef.current;
    if (!bar) return 0;
    const r = bar.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return Math.max(0, Math.min(1, x / r.width));
  }

  function startSeek(e) {
    if (!duration) return;
    seekingRef.current = true;
    setSeeking(true);
    setSeekPct(pctFromEvent(e) * 100);
  }

  useEffect(() => {
    if (!seeking) return;
    const move = (e) => { setSeekPct(pctFromEvent(e) * 100); if (e.cancelable) e.preventDefault(); };
    const end = () => {
      seekingRef.current = false;
      setSeeking(false);
      setSeekPct((p) => { seekTo((p / 100) * (duration || 0)); return p; });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    /* iOS a veces corta el arrastre con touchcancel (gesto del sistema,
       notificación...). Sin esto, el bloqueador de scroll del arrastre
       se quedaba PEGADO y la página entera dejaba de scrollear. */
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [seeking, duration]);

  // Crea el reproductor UNA sola vez y lo reutiliza. Antes se destruía y se
  // recreaba en cada canción: como en el medio había awaits, el navegador
  // perdía el "gesto del usuario" y bloqueaba el autoplay — por eso había que
  // darle play una segunda vez en la barra de abajo.
  function ensurePlayer() {
    if (playerReadyRef.current && playerRef.current) return Promise.resolve(playerRef.current);
    if (playerInitRef.current) return playerInitRef.current;

    playerInitRef.current = new Promise((resolve) => {
      const create = () => {
        if (!window.YT || !window.YT.Player) { resolve(null); return; }
        try {
          playerRef.current = new window.YT.Player("yt-player-container", {
            height: "1", width: "1",
            playerVars: { controls:0, disablekb:1, fs:0, modestbranding:1, rel:0, showinfo:0, iv_load_policy:3, playsinline:1 },
            events: {
              onReady: () => {
                playerReadyRef.current = true;
                // Si tocaste una canción mientras el player todavía se creaba,
                // la arrancamos ahora en lugar de perderla.
                const p = pendingRef.current;
                if (p) { pendingRef.current = null; startTrack(p); }
                resolve(playerRef.current);
              },
              onStateChange: (e) => {
                if (e.data === 0) {           // terminó → siguiente
                  if (kickRef.current) { clearInterval(kickRef.current); kickRef.current = null; }
                  handleTrackEnd();
                } else if (e.data === 1) {    // reproduciendo
                  if (kickRef.current) { clearInterval(kickRef.current); kickRef.current = null; }
                  setIsPlaying(true);
                  try { setDuration(playerRef.current.getDuration() || 0); } catch {}
                  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
                } else if (e.data === 2) {    // pausado
                  setIsPlaying(false);
                  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
                }
              },
              onError: () => { toast.error("Error reproduciendo", 3000); setIsPlaying(false); },
            },
          });
        } catch { resolve(null); }
      };
      if (window.YT && window.YT.Player) create();
      else loadYTAPI().then(create);
    });
    return playerInitRef.current;
  }

  /* Red de seguridad: algunos navegadores (sobre todo Safari/Chrome en
     celular) ignoran el primer playVideo() si el video todavía se está
     cargando. Reintentamos unas cuantas veces hasta que suene de verdad. */
  function kickPlay() {
    if (kickRef.current) clearInterval(kickRef.current);
    let intentos = 0;
    kickRef.current = setInterval(() => {
      intentos++;
      const p = playerRef.current;
      if (!p) { clearInterval(kickRef.current); kickRef.current = null; return; }
      let estado = -1;
      try { estado = p.getPlayerState(); } catch {}
      if (estado === 1) { clearInterval(kickRef.current); kickRef.current = null; return; }
      try { p.playVideo(); } catch {}
      if (intentos >= 12) { clearInterval(kickRef.current); kickRef.current = null; }
    }, 350);
  }

  /* Reproduce un ARCHIVO de audio real (el que se guardó en caché).
     A diferencia del iframe de YouTube, esto sí suena sin internet. */
  function startAudioFile(item) {
    // Si venía sonando YouTube, lo paramos
    try { if (playerRef.current && playerReadyRef.current) playerRef.current.stopVideo(); } catch {}

    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
      a.addEventListener("timeupdate", () => {
        if (seekingRef.current || enSilencioRef.current) return;
        let d = a.duration || 0;
        const fin = finRealRef.current;
        /* Si el archivo trae cola de más (versiones viejas corruptas:
           canción + ruido), lo cortamos en la duración real de iTunes
           y pasamos a la siguiente. Margen de 12 s por si el video
           legítimo dura un poco más que la versión de álbum. */
        if (fin > 0 && d > fin + 12) {
          d = fin;
          if (a.currentTime >= fin) {
            finRealRef.current = 0;
            try { a.pause(); } catch {}
            handleTrackEnd();
            return;
          }
        }
        setCurrentTime(a.currentTime || 0);
        setDuration(d);
        setProgress(d > 0 ? (a.currentTime / d) * 100 : 0);
      });
      a.addEventListener("ended", () => handleTrackEnd());
      a.addEventListener("play", () => {
        if (enSilencioRef.current) return;   // es el guardián, no la canción
        setIsPlaying(true);
        /* Avisar a iOS el estado REAL: sin esto, tras pausar desde la
           pantalla bloqueada iOS daba la sesión por muerta y el botón
           de reanudar no hacía nada. */
        try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch {}
      });
      a.addEventListener("pause", () => {
        if (!a.ended) posPausaRef.current = a.currentTime || 0;
        setIsPlaying(false);
        try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; } catch {}
      });
      a.addEventListener("error", () => {
        if (enSilencioRef.current || deteniendoRef.current) return;  // error del guardián: ignorar
        // El archivo cacheado falló: probamos con YouTube si hay conexión
        if (item.video_id && navigator.onLine) { usingAudioRef.current = false; startTrack(item); }
        else toast.error("No se pudo reproducir", 3000);
      });
    }

    usingAudioRef.current = true;
    enSilencioRef.current = false;          // canción nueva: fuera guardián
    clearTimeout(silTimerRef.current);
    try { if (audioRef.current) audioRef.current.muted = false; } catch {}
    finRealRef.current = item.duration_ms ? item.duration_ms / 1000 : 0;
    setPlayingKey(item.key); setPlayingTitle(item.title);
    setPlayingArtist(item.artist); setPlayingCover(item.cover_url);
    setProgress(0); setCurrentTime(0); setDuration(0);

    try {
      a.src = item.audio_url;
      a.load();
      const pr = a.play();
      if (pr && pr.catch) pr.catch(() => {});
      setIsPlaying(true);
      setupMediaSession(item);
    } catch {
      toast.error("No se pudo reproducir", 3000);
      setPlayingKey(null); setIsPlaying(false);
    }
  }

  startTrackRef.current = (item) => startTrack(item);
  function startTrack(item) {
    // Memoria del aleatorio: registrar lo que va sonando
    try { historialRef.current = [...historialRef.current.filter(k => k !== item.key), item.key].slice(-25); } catch {}
    // Estadísticas: SOLO canciones descargadas (las previews de Explorar
    // no cuentan, como siempre fue)
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const k = String(item.key);
      const descargada = Boolean(mp3s[k]?.audio_url) || (item.keys || []).some(x => mp3s[x]?.audio_url);
      if (descargada) {
        const st = JSON.parse(localStorage.getItem("aura_stats") || "{}");
        st[k] = { n: (st[k]?.n || 0) + 1, name: item.title || "", artist: item.artist || "", cover: item.cover_url || "", last: Date.now() };
        localStorage.setItem("aura_stats", JSON.stringify(st));
      }
    } catch {}
    // Si la canción tiene archivo guardado, preferimos ese (funciona offline)
    if (item.audio_url) { startAudioFile(item); return; }
    usingAudioRef.current = false;
    // Si veníamos de un archivo, lo paramos
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; } } catch {}

    const p = playerRef.current;
    if (!p) return;
    setPlayingKey(item.key); setPlayingTitle(item.title);
    setPlayingArtist(item.artist); setPlayingCover(item.cover_url);
    setProgress(0); setCurrentTime(0); setDuration(0);
    try {
      p.loadVideoById(item.video_id);   // loadVideoById ya arranca solo
      try { p.playVideo(); } catch {}   // y por las dudas lo empujamos
      setIsPlaying(true);
      kickPlay();
      setupMediaSession(item);
    } catch {
      toast.error("No se pudo reproducir", 3000);
      setPlayingKey(null); setIsPlaying(false);
    }
  }

  // Lista en el orden en que se ve (respeta el buscador)
  function visibleList() {
    return liveRef.current.list || [];
  }

  function pickNext(dir = 1) {
    const lista = visibleList();
    if (!lista.length) return null;
    const actual = liveRef.current.playingKey;
    const i = lista.findIndex(x => x.key === actual);

    /* Cola manual primero: lo que el usuario marcó "a continuación"
       le gana al aleatorio y al orden normal. */
    if (dir === 1) {
      while (colaRef.current.length) {
        const k = colaRef.current.shift();
        const enCola = lista.find(x => x.key === k);
        if (enCola) return enCola;
      }
    }
    if (liveRef.current.shuffle) {
      if (lista.length === 1) return lista[0];
      /* Anterior en aleatorio: volvemos por el historial real */
      if (dir === -1) {
        const h = historialRef.current;
        const idx = h.lastIndexOf(actual);
        const prevKey = idx > 0 ? h[idx - 1] : null;
        const it = prevKey ? lista.find(x => x.key === prevKey) : null;
        if (it) return it;
        return lista[Math.floor(Math.random() * lista.length)];
      }
      /* Siguiente: consumimos el orden PRE-GENERADO (una permutación:
         no repite hasta agotar todas) — y es lo que muestra la cola. */
      let intentos = 0;
      while (intentos < 3) {
        if (!ordenAleatorioRef.current.length) { regenerarOrdenAleatorio(actual); intentos++; }
        while (ordenAleatorioRef.current.length) {
          const k = ordenAleatorioRef.current.shift();
          const it = lista.find(x => x.key === k);
          if (it) { refrescarCola(); return it; }
        }
      }
      return lista.find(x => x.key !== actual) || lista[0];
    }
    if (i === -1) return lista[0];
    const sig = i + dir;
    if (sig < 0) return lista[lista.length - 1];
    if (sig >= lista.length) {
      return liveRef.current.repeat === "all" ? lista[0] : null;
    }
    return lista[sig];
  }

  function handleTrackEnd() {
    if (liveRef.current.repeat === "one") {
      const lista = visibleList();
      const act = lista.find(x => x.key === liveRef.current.playingKey);
      if (act) { startTrack(act); return; }
    }
    const sig = pickNext(1);
    if (sig) startTrack(sig);
    else {
      setIsPlaying(false);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    }
  }

  function playNext() { const s = pickNext(1); if (s) startTrack(s); }
  function playPrev() {
    // Como en iTunes: si ya pasaron 3s, primero vuelve al inicio del tema
    if (currentTime > 3) { seekTo(0); return; }
    const s = pickNext(-1); if (s) startTrack(s);
  }

  async function setupMediaSession(item) {
    if (!("mediaSession" in navigator)) return;
    // Usamos /api/proxy para servir la portada desde nuestro dominio: así el
    // sistema la puede leer y además queda cacheada para offline.
    const as = item.cover_url ? "/api/proxy?url=" + encodeURIComponent(item.cover_url) : "/icon-512.png";
    // Pre-cargar la portada para que este en memoria del navegador cuando se
    // arme la metadata. Asi el lock screen no muestra el poster del video
    // de YouTube "por un instante" mientras se carga el real.
    try { await fetch(as, { mode: 'no-cors' }); } catch {}
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || "", artist: item.artist || "", album: "AURA",
        artwork: [
          { src: as, sizes: "96x96",   type: "image/jpeg" },
          { src: as, sizes: "192x192", type: "image/jpeg" },
          { src: as, sizes: "256x256", type: "image/jpeg" },
          { src: as, sizes: "384x384", type: "image/jpeg" },
          { src: as, sizes: "512x512", type: "image/jpeg" },
        ],
      });
    } catch {}
    navigator.mediaSession.playbackState = "playing";
    // Si el YouTube ya terminó (estado 0) y volvés a tocar Reanudar desde
    // el dashboard, había que rebobinarlo al inicio para que arranque de
    // verdad — antes llamaba playVideo() y "terminaba" otra vez al toque.
    navigator.mediaSession.setActionHandler("play", () => {
      try {
        const pl = playerRef.current;
        if (pl && playerReadyRef.current && !usingAudioRef.current && pl.getPlayerState && pl.getPlayerState() === 0) {
          pl.seekTo(0, true);
        }
      } catch {}
      if (usingAudioRef.current && audioRef.current) {
        reanudarDeGuardian();
      } else {
        try { playerRef.current?.playVideo(); } catch {}
        kickPlay();
      }
      setIsPlaying(true);
      try { navigator.mediaSession.playbackState = "playing"; } catch {}
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (usingAudioRef.current && audioRef.current) {
        pausarConGuardian();
        return;
      }
      try { playerRef.current?.pauseVideo(); } catch {}
      setIsPlaying(false);
      try { navigator.mediaSession.playbackState = "paused"; } catch {}
    });
    try { navigator.mediaSession.setActionHandler("stop", () => stopPlayback()); } catch {}
    try { navigator.mediaSession.setActionHandler("seekto", (d) => { if (d.seekTime != null) seekTo(d.seekTime); }); } catch {}
    // Botones de anterior/siguiente en la pantalla de bloqueo del celular
    try { navigator.mediaSession.setActionHandler("nexttrack", () => playNext()); } catch {}
    try { navigator.mediaSession.setActionHandler("previoustrack", () => playPrev()); } catch {}

    /* IMPORTANTE: cuando el iframe de YouTube arranca, PISA nuestra metadata
       con la del video (por eso en la pantalla de bloqueo aparecía la
       miniatura de YouTube y no la portada del álbum). Se la volvemos a
       escribir un rato después de que empieza a sonar. */
    if (mediaFixRef.current) mediaFixRef.current.forEach(clearTimeout);
    mediaFixRef.current = [600, 1500, 3000].map(ms => setTimeout(() => {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item.title || "", artist: item.artist || "", album: "AURA",
          artwork: [
            { src: as, sizes: "96x96",   type: "image/jpeg" },
            { src: as, sizes: "192x192", type: "image/jpeg" },
            { src: as, sizes: "256x256", type: "image/jpeg" },
            { src: as, sizes: "384x384", type: "image/jpeg" },
            { src: as, sizes: "512x512", type: "image/jpeg" },
          ],
        });
      } catch {}
    }, ms));
  }

  async function playDownloaded(item) {
    // Si hay archivo de audio guardado, lo usamos: suena aunque no haya
    // internet (viene de la caché del navegador).
    if (item.audio_url) { startAudioFile(item); return; }

    // Sin internet el iframe de YouTube no puede cargar: avisamos claro en
    // vez de quedarnos en silencio como si estuviera roto.
    if (!navigator.onLine && item.video_id) {
      toast.warning("Sin conexión: esta canción se reproduce desde YouTube y necesita internet", 4000);
      return;
    }
    // Misma canción → alternar play/pausa
    if (playingKey === item.key && (playerReadyRef.current || usingAudioRef.current)) {
      togglePlay();
      return;
    }
    if (!item.video_id) {
      toast.info("Buscando en YouTube: " + item.title, 3000);
      try {
        const sq = (item.artist+" "+item.title).trim()||item.key;
        const res = await fetch("/api/download-mp3?q="+encodeURIComponent(sq));
        const data = await res.json();
        if (data.video_id) {
          try { const s = JSON.parse(localStorage.getItem("ml_mp3")||"{}"); s[item.key]={...s[item.key],video_id:data.video_id,saved_at:Date.now()}; localStorage.setItem("ml_mp3",JSON.stringify(s)); } catch {}
          item.video_id = data.video_id;
          refreshDownloads();
        } else { toast.error("No se encontro en YouTube", 3000); return; }
      } catch { toast.error("Error buscando", 3000); return; }
    }
    // Si el player ya está listo (caso normal, se creó al abrir la página),
    // arrancamos EN EL MISMO gesto del toque → suena a la primera.
    if (playerReadyRef.current && playerRef.current) { startTrack(item); return; }

    // Caso raro: todavía se está creando. Lo dejamos agendado y onReady lo toca.
    pendingRef.current = item;
    setPlayingKey(item.key); setPlayingTitle(item.title);
    setPlayingArtist(item.artist); setPlayingCover(item.cover_url);
    const player = await ensurePlayer();
    if (!player) {
      pendingRef.current = null;
      toast.error("No se pudo iniciar el reproductor", 3000);
      setPlayingKey(null);
    }
  }

  function seekTo(seconds) {
    if (enSilencioRef.current) { posPausaRef.current = seconds; setCurrentTime(seconds); return; }
    const d = duration || 0;
    const t = Math.max(0, Math.min(seconds, d || seconds));
    try {
      if (usingAudioRef.current && audioRef.current) {
        audioRef.current.currentTime = t;
      } else if (playerRef.current && playerReadyRef.current) {
        playerRef.current.seekTo(t, true);
      } else return;
      setCurrentTime(t);
      if (d > 0) setProgress((t / d) * 100);
    } catch {}
  }

  // Play/pausa que sirve para los dos reproductores
  function togglePlay() {
    if (usingAudioRef.current && audioRef.current) {
      const a = audioRef.current;
      if (enSilencioRef.current || a.paused) reanudarDeGuardian();
      else pausarConGuardian();
      return;
    }
    if (!playerRef.current || !playerReadyRef.current) return;
    if (isPlaying) { playerRef.current.pauseVideo(); setIsPlaying(false); }
    else { playerRef.current.playVideo(); setIsPlaying(true); kickPlay(); }
  }

  function stopPlayback() {
    deteniendoRef.current = true;
    setTimeout(() => { deteniendoRef.current = false; }, 300);
    clearTimeout(silTimerRef.current);
    enSilencioRef.current = false;
    try { if (audioRef.current) audioRef.current.muted = false; } catch {}
    // Ojo: NO destruimos el player, solo paramos. Así sigue listo para la
    // próxima canción y el play responde al primer toque.
    if (playerRef.current && playerReadyRef.current) { try { playerRef.current.stopVideo(); } catch {} }
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {} }
    usingAudioRef.current = false;
    setPlayingKey(null);setIsPlaying(false);setPlayingTitle("");setPlayingArtist("");setPlayingCover("");
    setProgress(0);setCurrentTime(0);setDuration(0);
    if("mediaSession" in navigator){navigator.mediaSession.playbackState="none";navigator.mediaSession.metadata=null;}
  }

  /* Re-descarga DE VERDAD: pide el archivo a la Mac (con polling mientras
     baja), lo cachea para offline y guarda audio_url. Antes solo guardaba
     el video_id, así que la canción seguía sonando por YouTube y el modo
     offline nunca se arreglaba. */
  async function reDownload(item) {
    // Reset del contador de reparaciones: el usuario pidió reintentar
    try {
      const s = JSON.parse(localStorage.getItem("ml_mp3")||"{}");
      const ks = item.keys && item.keys.length ? item.keys : [item.key];
      for (const k of ks) if (s[k]) s[k] = { ...s[k], intentos_repair: 0 };
      localStorage.setItem("ml_mp3", JSON.stringify(s));
    } catch {}
    setDownloadingItems(p=>({...p,[item.key]:true}));
    toast.info("Descargando: "+item.title,3000);
    try {
      const params = new URLSearchParams();
      params.set("q", (item.artist+" "+item.title).trim()||item.key);
      /* Los mismos datos que usa la descarga normal: sin la duración
         esperada, la re-descarga podía traer una versión doble (6-7 min
         con silencio al final). */
      if (item.duration_ms) params.set("expected_duration", String(Math.round(item.duration_ms/1000)));
      if (item.artist) params.set("expected_artist", item.artist);
      if (item.title) params.set("expected_song", item.title);
      let data = {};
      for (let intento = 0; intento < 13; intento++) {
        const res = await fetch("/api/download-mp3?"+params.toString());
        data = await res.json().catch(()=>({}));
        if (data.audio_url || !data.pendiente) break;
        if (data.video_id && !params.get("v")) params.set("v", data.video_id);
        await new Promise(r=>setTimeout(r,10000));
      }
      let guardado = false;
      if (data.audio_url && "caches" in window) {
        try {
          // URL única: ningún caché viejo puede resucitar la copia corrupta.
          data.audio_url += (data.audio_url.includes("?") ? "&" : "?") + "r=" + Date.now();
          const c = await caches.open("ml-saved-v1");
          try { await c.delete(data.audio_url); } catch {}
          const r = await fetch(data.audio_url, { headers: { Accept: "audio/*,*/*" }, cache: "no-store" });
          if (r.ok && r.status === 200) { await c.put(data.audio_url, r.clone()); guardado = true; }
        } catch {}
      }
      if (guardado || data.video_id) {
        try{
          const s=JSON.parse(localStorage.getItem("ml_mp3")||"{}");
          const ks=item.keys&&item.keys.length?item.keys:[item.key];
          for(const k of ks) s[k]={...s[k],
            video_id:data.video_id||s[k]?.video_id||"",
            audio_url:guardado?data.audio_url:(s[k]?.audio_url||""),
            method:guardado?"audio":(s[k]?.method||"youtube"),
            name:s[k]?.name||item.title||"", artist:s[k]?.artist||item.artist||"",
            cover:s[k]?.cover||item.cover_url||"",
            saved_at:Date.now()};
          localStorage.setItem("ml_mp3",JSON.stringify(s));
        }catch{}
        toast.success(guardado?"Guardada sin internet: "+item.title:"Encontrada (suena por YouTube): "+item.title,4000);
        refreshDownloads();
      }
      else toast.warning("No se encontro",4000);
    } catch { toast.error("Error buscando",3000); }
    setDownloadingItems(p=>({...p,[item.key]:false}));
  }

  async function deleteDownload(item) {
    try {
      // Borra TODAS las claves con las que se guardó esta canción
      const claves = item.keys && item.keys.length ? item.keys : [item.key];

      const s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      for (const k of claves) delete s[k];
      localStorage.setItem("ml_mp3", JSON.stringify(s));

      // Sacamos de la cola de descargas cualquier item de esta canción
      // (incluidas reparaciones): antes podían "resucitarla".
      try { removeByKeys && removeByKeys(claves); } catch {}

      // También la metadata offline
      try {
        const off = JSON.parse(localStorage.getItem("ml_offline") || "{}");
        for (const k of claves) delete off[k];
        localStorage.setItem("ml_offline", JSON.stringify(off));
      } catch {}

      if (item.audio_url && "caches" in window) {
        try { const c = await caches.open("ml-saved-v1"); await c.delete(item.audio_url); } catch {}
      }
      // También pedirle a la Mac que borre su copia del audio, para no
      // ocupar espacio de más. No frena la interfaz y no es crítico si
      // la Mac está apagada (el límite de disco igual limpia lo viejo).
      if (item.video_id) {
        try { fetch("/api/borrar-cancion?video_id=" + encodeURIComponent(item.video_id)).catch(() => {}); } catch {}
      }
      if (claves.includes(playingKey)) stopPlayback();

      // Quitar de favoritos la canción correspondiente
      const posibles = new Set(claves.map(k => String(k).toLowerCase()));
      const tituloArtista = (item.artist + " " + item.title).trim().toLowerCase();
      const artistaTitulo = (item.title + " " + item.artist).trim().toLowerCase();

      const favsBorrar = favorites.filter(f => {
        if (f.item_type !== "track") return false;
        const id = String(f.item_id).toLowerCase();
        if (posibles.has(id)) return true;
        const n = (f.name || "").trim().toLowerCase();
        const a = (f.artist || "").trim().toLowerCase();
        return (a + " " + n) === tituloArtista || (n + " " + a) === artistaTitulo;
      });

      for (const f of favsBorrar) {
        await toggleFavorite("track", f.item_id);
      }

      toast.success(
        favsBorrar.length
          ? "Eliminada de descargas y favoritos: " + item.title
          : "Eliminada: " + item.title,
        3000
      );
      refreshDownloads();
    } catch {}
  }

  // Lista filtrada por el buscador (lo que realmente se ve en pantalla)
  const q = search.trim().toLowerCase();
  const listaVisible = q
    ? downloadedMusic.filter(x =>
        (x.title || "").toLowerCase().includes(q) ||
        (x.artist || "").toLowerCase().includes(q))
    : downloadedMusic;

  // Mantenemos el espejo al día para los callbacks del player
  liveRef.current = { list: listaVisible, playingKey, shuffle, repeat };

  // El Explorar embebido escucha esto para pintar en verde lo que suena
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("aura-sonando", { detail: { key: playingKey, playing: isPlaying, title: playingTitle || "", artist: playingArtist || "" } })); } catch {}
  }, [playingKey, isPlaying, playingTitle, playingArtist]);

  if(loading) return <div style={{textAlign:"center",padding:60,color:"var(--accent)"}}>Cargando...</div>;

  const filteredFavs = favorites.filter(f=>f.item_type===favType);
  async function openPlaylist(pl){setSelectedPlaylist(pl);const r=await fetch("/api/playlists?id="+pl.id);const d=await r.json();setPlaylistItems(d.items||[]);}
  async function deletePlaylist(id){if(!confirm("Borrar esta playlist?"))return;await fetch("/api/playlists",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({playlist_id:id})});loadPlaylists();if(selectedPlaylist?.id===id)setSelectedPlaylist(null);}
  async function removePlaylistItem(iid){await fetch("/api/playlists",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove-item",item_id:iid})});if(selectedPlaylist)openPlaylist(selectedPlaylist);}

  const SM = {padding:"6px 14px",borderRadius:6,border:"none",color:"var(--text-strong)",fontSize:"0.85em",cursor:"pointer",fontWeight:600};

  function CoverImg({url,size="100%",r=0}) {
    const w=typeof size==="string"?size:size+"px";
    if(url) return <img src={url} style={{width:w,height:w,borderRadius:r,objectFit:"cover",display:"block"}}/>;
    return <div style={{width:w,height:w,borderRadius:r,background:"linear-gradient(135deg,var(--panel),var(--border))",display:"flex",alignItems:"center",justifyContent:"center"}}><Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={32} stroke="var(--text6)" sw={1.5}/></div>;
  }

  function fmt(s){if(!s||isNaN(s))return"0:00";const m=Math.floor(s/60);return m+":"+String(Math.floor(s%60)).padStart(2,"0");}
  const hp = playingKey!==null;

  const iconBtn = (onClick, icon, color="var(--text5)", bg="none", title="", sz=14) => (
    <button onClick={onClick} title={title} style={{background:bg,border:"none",color,cursor:"pointer",padding:2,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{icon}</button>
  );

  return (
    <div style={{maxWidth:vista==="explorar"?1000:900,margin:"0 auto",padding:vista==="explorar"?0:20,boxSizing:"border-box",paddingBottom:hp?"calc(135px + env(safe-area-inset-bottom))":"calc(20px + env(safe-area-inset-bottom))"}}>
      <div id="yt-player-container" style={{position:"absolute",top:-9999,left:-9999,width:1,height:1,overflow:"hidden"}}/>

      {/* Header (solo en la sección Perfil) */}
      {vista === "cuenta" && (
      <div style={{background:"var(--panel)",borderRadius:14,padding:22,marginBottom:22,border:"1px solid var(--border)",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),#1ed760)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"2em",flexShrink:0}}>
          {(profile?.display_name||profile?.username||"U")[0].toUpperCase()}
        </div>
        <div style={{flex:1,minWidth:120}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <h1 style={{fontSize:"1.3em",marginBottom:2}}>{profile?.display_name||profile?.username||"Usuario"}</h1>
            {/* Amigos */}
            <button onClick={()=>{setShowFriends(true);cargarAmigos();cargarBuzon();}} title="Amigos" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:16,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text2)",fontSize:"0.68em",fontWeight:700,cursor:"pointer"}}>
              <Ico d={<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>} size={13} stroke="var(--accent)"/> Amigos{amigos.length?` (${amigos.length})`:""}
            </button>
            {/* Personalizar */}
            {/* Campanita del buzón: puntito rojo si te mandaron algo */}
            <button onClick={()=>{setShowFriends(true);cargarAmigos();cargarBuzon();}} title="Buzón" style={{position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",width:30,height:30,borderRadius:"50%",border:"1px solid var(--border)",background:"var(--panel2)",cursor:"pointer"}}>
              <Ico d={<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>} size={14} stroke={buzon.length?"var(--accent)":"var(--text3)"}/>
              {buzon.length > 0 && <span style={{position:"absolute",top:-2,right:-2,minWidth:15,height:15,borderRadius:8,background:"#ef4444",color:"#fff",fontSize:"0.55em",fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px",border:"2px solid var(--panel)"}}>{buzon.length}</span>}
            </button>
            <button onClick={()=>setShowCustom(v=>!v)} title="Personalizar" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:16,border:"1px solid var(--border)",background:showCustom?"var(--accent)":"var(--panel2)",color:showCustom?"#fff":"var(--text2)",fontSize:"0.68em",fontWeight:700,cursor:"pointer"}}>
              <Ico d={<><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></>} size={13} stroke={showCustom?"#fff":"var(--accent)"}/> Personalizar
            </button>
          </div>
          <p style={{color:"var(--text3)",fontSize:"0.82em"}}>@{profile?.username||"user"}</p>
          <div style={{display:"flex",gap:12,color:"var(--text5)",fontSize:"0.78em",marginTop:4}}>
            <span>{favorites.length} favoritos</span>
            <span>{downloadedMusic.length} descargadas</span>
            <span>{playlists.length} playlists</span>
          </div>
        </div>
      </div>

      )}

      {/* ── Panel: Personalizar ── */}
      {showCustom && (
        <div style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:22}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:800,fontSize:"0.9em",marginBottom:12,color:"var(--text)"}}><Ico d={<><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></>} size={16} stroke="var(--accent)"/> Personalizar AURA</div>
          <div style={{marginBottom:14}}>
            <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:700,marginBottom:8}}>TEMA</div>
            <div style={{display:"flex",gap:8}}>
              {[["oscuro","Oscuro"],["claro","Claro"]].map(([v,l])=>(
                <button key={v} onClick={()=>aplicarTema(v)} style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:temaAct===v?"var(--accent)":"var(--panel2)",color:temaAct===v?"#fff":"var(--text2)",fontSize:"0.82em",fontWeight:700,cursor:"pointer"}}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:700,marginBottom:8}}>COLOR</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {["#7c5cfc","#3b82f6","#22c55e","#ec4899","#f97316","#ef4444","#14b8a6","#eab308"].map(c=>(
                <button key={c} onClick={()=>aplicarAccent(c)} title={c} style={{width:34,height:34,borderRadius:"50%",border:accentAct===c?"3px solid var(--text-strong)":"3px solid transparent",background:c,cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.25)"}}/>
              ))}
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:700,marginBottom:8}}>DATOS MÓVILES</div>
            <button onClick={()=>aplicarSinDatos(!sinDatos)} style={{padding:"9px 16px",borderRadius:10,border:"1px solid var(--border)",background:sinDatos?"rgba(234,179,8,0.15)":"var(--panel2)",color:sinDatos?"#eab308":"var(--text2)",fontSize:"0.82em",fontWeight:700,cursor:"pointer"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:7}}>
                <Ico d={sinDatos ? <><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></> : <><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>} size={14} stroke={sinDatos?"#eab308":"var(--text2)"}/>
                {sinDatos ? "Modo sin datos ACTIVO (tocá para apagar)" : "Activar modo sin datos"}
              </span>
            </button>
            <div style={{color:"var(--text4)",fontSize:"0.68em",marginTop:6,lineHeight:1.5}}>Activalo al salir de casa: la app no toca internet (ni datos móviles) y funciona solo con lo descargado. iOS no permite detectar WiFi vs datos automáticamente.</div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:700,marginBottom:8}}>NOTIFICACIONES</div>
            <button onClick={pushOn?desactivarPush:activarPush} style={{padding:"9px 16px",borderRadius:10,border:"1px solid var(--border)",background:pushOn?"rgba(34,197,94,0.15)":"var(--panel2)",color:pushOn?"#22c55e":"var(--text2)",fontSize:"0.82em",fontWeight:700,cursor:"pointer"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:7}}><Ico d={<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>} size={14} stroke={pushOn?"#22c55e":"var(--text2)"}/> {pushOn ? "Activadas (tocá para apagar)" : "Activar notificaciones"}</span>
            </button>
            <div style={{color:"var(--text4)",fontSize:"0.68em",marginTop:6,lineHeight:1.5}}>Te avisamos de versiones nuevas y cuando un amigo te manda una canción, aunque la app esté cerrada.</div>
          </div>
          <div>
            <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:700,marginBottom:8}}>FUENTE</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[["","Normal"],["redonda","Redonda"],["clasica","Clásica"],["mono","Mono"]].map(([v,l])=>(
                <button key={v||"normal"} onClick={()=>aplicarFuente(v)} style={{padding:"8px 14px",borderRadius:10,border:"1px solid var(--border)",background:fuenteAct===v?"var(--accent)":"var(--panel2)",color:fuenteAct===v?"#fff":"var(--text2)",fontSize:"0.82em",fontWeight:700,cursor:"pointer",fontFamily:v==="clasica"?"Georgia,serif":v==="mono"?"Menlo,monospace":"inherit"}}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Amigos ── */}
      {showFriends && (
        <div onClick={()=>setShowFriends(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:16,padding:20,width:"100%",maxWidth:420,maxHeight:"75vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontWeight:800,color:"var(--text)"}}>
                {amigoVista ? (
                  <button onClick={()=>setAmigoVista(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",fontWeight:800,fontSize:"1em",padding:0}}>← Amigos</button>
                ) : <span style={{display:"inline-flex",alignItems:"center",gap:8}}><Ico d={<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>} size={16} stroke="var(--accent)"/> Amigos</span>}
              </div>
              <button onClick={()=>{setShowFriends(false);setAmigoVista(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:"1.2em"}}>✕</button>
            </div>

            {/* ── Vista: perfil de un amigo ── */}
            {amigoVista ? (
              <div>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                  <div style={{width:52,height:52,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),#1ed760)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:"1.4em",flexShrink:0}}>{(amigoVista.perfil?.display_name||amigoVista.perfil?.username||"?")[0].toUpperCase()}</div>
                  <div>
                    <div style={{color:"var(--text)",fontWeight:800}}>{amigoVista.perfil?.display_name||amigoVista.perfil?.username}</div>
                    <div style={{color:"var(--text4)",fontSize:"0.78em"}}>@{amigoVista.perfil?.username}</div>
                  </div>
                </div>
                {amigoCargando && <p style={{color:"var(--text4)",fontSize:"0.85em"}}>Cargando...</p>}
                {!amigoCargando && (
                  <>
                    <div style={{color:"var(--text3)",fontSize:"0.72em",fontWeight:800,marginBottom:8}}>SUS FAVORITOS ({(amigoVista.favoritos||[]).length})</div>
                    {(amigoVista.favoritos||[]).length===0 ? (
                      <p style={{color:"var(--text4)",fontSize:"0.8em",marginBottom:14}}>Todavía no tiene favoritos.</p>
                    ) : (
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                        {(amigoVista.favoritos||[]).slice(0,12).map((f,i)=>(
                          <div key={i} onClick={()=>{setShowFriends(false);setAmigoVista(null);irAExplorar({album:f.extra_data?.album_id||f.item_id,source:f.source||"itunes",track:f.item_type==="track"?(f.name||""):""});}} style={{cursor:"pointer"}}>
                            <CoverImg url={f.cover_url} size="100%" r={8}/>
                            <div style={{color:"var(--text2)",fontSize:"0.66em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:3}}>{f.name}</div>
                            <div style={{color:"var(--text4)",fontSize:"0.6em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.artist}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{color:"var(--text3)",fontSize:"0.72em",fontWeight:800,marginBottom:8}}>SUS PLAYLISTS PÚBLICAS ({(amigoVista.playlists||[]).length})</div>
                    {(amigoVista.playlists||[]).length===0 ? (
                      <p style={{color:"var(--text4)",fontSize:"0.8em"}}>No tiene playlists públicas.</p>
                    ) : (amigoVista.playlists||[]).map(pl=>(
                      <div key={pl.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 4px",borderBottom:"1px solid var(--border2)"}}>
                        <CoverImg url={pl.cover_url} size={36} r={6}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:"var(--text)",fontSize:"0.85em",fontWeight:600}}>{pl.name}</div>
                          {pl.description && <div style={{color:"var(--text4)",fontSize:"0.7em"}}>{pl.description}</div>}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
            <>
            {/* ── Buzón: canciones que te mandaron ── */}
            {buzon.length>0 && (
              <div style={{marginBottom:16,border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"8px 12px",fontSize:"0.7em",fontWeight:800,color:"var(--accent)",borderBottom:"1px solid var(--border2)"}} ><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Ico d={<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></>} size={13} stroke="var(--accent)"/> TE MANDARON ({buzon.length})</span></div>
                {buzon.map(s=>(
                  <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:"1px solid var(--border2)"}}>
                    <CoverImg url={s.item?.cover} size={38} r={6}/>
                    {s.item?.type === "playlist" ? (
                      <div onClick={()=>verPlaylistCompartida(s)} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,color:"var(--text)",fontSize:"0.85em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>} size={13} stroke="var(--accent)"/> {s.item?.name}</div>
                        <div style={{color:"var(--text4)",fontSize:"0.7em"}}>playlist · de @{s.de?.username} · tocá para verla</div>
                      </div>
                    ) : (
                    <div onClick={()=>{setShowFriends(false);if(s.item?.album_id)irAExplorar({album:s.item.album_id,source:s.item.source||"itunes",track:s.item?.name||""});else irAExplorar({buscar:(s.item?.artist||"")+" "+(s.item?.name||"")});}} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                      <div style={{color:"var(--text)",fontSize:"0.85em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.item?.name}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.7em"}}>{s.item?.artist} · de @{s.de?.username}</div>
                    </div>
                    )}
                    <button onClick={()=>borrarShare(s.id)} style={{background:"none",border:"none",cursor:"pointer",padding:5}} title="Quitar">
                      <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={12} stroke="var(--text4)"/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <input value={buscaAmigo} onChange={e=>{setBuscaAmigo(e.target.value);buscarUsuarios(e.target.value);}} placeholder="Buscar por @usuario..." style={{flex:1,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text)",fontSize:"0.9em",outline:"none"}}/>
            </div>
            {sugerencias.length>0 && (
              <div style={{marginBottom:14,border:"1px solid var(--border2)",borderRadius:10,overflow:"hidden"}}>
                {sugerencias.map(u=>(
                  <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:"1px solid var(--border2)"}}>
                    <div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),#1ed760)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:"0.8em",flexShrink:0}}>{(u.display_name||u.username||"?")[0].toUpperCase()}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:"var(--text)",fontSize:"0.85em",fontWeight:600}}>{u.display_name||u.username}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.72em"}}>@{u.username}</div>
                    </div>
                    {amigos.some(a=>a.id===u.id)
                      ? <span style={{color:"#22c55e",fontSize:"0.72em",fontWeight:700}}>✓ amigo</span>
                      : <button onClick={()=>agregarAmigo(u.username)} style={{padding:"6px 12px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontSize:"0.75em",fontWeight:700,cursor:"pointer"}}>Agregar</button>}
                  </div>
                ))}
              </div>
            )}
            {amigosError && <p style={{color:"#eab308",fontSize:"0.78em",marginBottom:10,lineHeight:1.5}}>{amigosError}</p>}
            {amigos.length===0 && !amigosError ? (
              <p style={{color:"var(--text4)",fontSize:"0.85em",textAlign:"center",padding:16}}>Todavía no tenés amigos. Buscá a alguien por su @usuario.</p>
            ) : amigos.map(a=>(
              <div key={a.id} onClick={()=>verAmigo(a)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 4px",borderBottom:"1px solid var(--border2)",cursor:"pointer"}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),#1ed760)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,flexShrink:0}}>{(a.display_name||a.username||"?")[0].toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:"var(--text)",fontSize:"0.88em",fontWeight:600}}>{a.display_name||a.username}</div>
                  <div style={{color:"var(--text4)",fontSize:"0.72em"}}>@{a.username} · tocá para ver su música</div>
                </div>
                <button onClick={(e)=>{e.stopPropagation();quitarAmigo(a.id);}} title="Quitar" style={{background:"none",border:"none",cursor:"pointer",padding:6}}>
                  <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={13} stroke="#ef4444"/>
                </button>
              </div>
            ))}
            </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: elegir amigo para enviarle una canción ── */}
      {compartirItem && (
        <div onClick={()=>setCompartirItem(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:310,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:16,padding:20,width:"100%",maxWidth:380,maxHeight:"70vh",overflowY:"auto"}}>
            <div style={{fontWeight:800,color:"var(--text)",marginBottom:4}}>Enviar a un amigo</div>
            <div style={{color:"var(--text4)",fontSize:"0.78em",marginBottom:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} ><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={13} stroke="var(--accent)"/> {compartirItem.title||compartirItem.name} — {compartirItem.artist}</span></div>
            {amigos.length===0 ? (
              <p style={{color:"var(--text4)",fontSize:"0.85em"}}>Primero agregá amigos (botón Amigos junto a tu nombre).</p>
            ) : amigos.map(a=>(
              <button key={a.id} onClick={()=>enviarShare(a)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 8px",borderRadius:10,border:"none",background:"transparent",cursor:"pointer",textAlign:"left"}}>
                <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),#1ed760)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,flexShrink:0}}>{(a.display_name||a.username||"?")[0].toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:"var(--text)",fontSize:"0.88em",fontWeight:600}}>{a.display_name||a.username}</div>
                  <div style={{color:"var(--text4)",fontSize:"0.7em"}}>@{a.username}</div>
                </div>
                <span style={{color:"var(--accent)",fontSize:"0.75em",fontWeight:800}}>Enviar →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal: playlist que te compartieron ── */}
      {plCompartida && (
        <div onClick={()=>setPlCompartida(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:320,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:16,padding:20,width:"100%",maxWidth:420,maxHeight:"75vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontWeight:800,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} ><span style={{display:"inline-flex",alignItems:"center",gap:7}}><Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>} size={15} stroke="var(--accent)"/> {plCompartida.nombre}</span></div>
              <button onClick={()=>setPlCompartida(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:"1.2em"}}>✕</button>
            </div>
            {plCompartida.cargando ? <p style={{color:"var(--text4)",textAlign:"center",padding:20}}>Cargando...</p> : (
              <>
                <button onClick={descargarPlaylistCompartida} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"10px 16px",borderRadius:10,border:"none",background:"#22c55e",color:"#fff",fontSize:"0.85em",fontWeight:800,cursor:"pointer",marginBottom:12}}>
                  <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={15} stroke="#fff"/> Descargar todas ({plCompartida.items.filter(i=>i.item_type==="track").length})
                </button>
                {plCompartida.items.length===0 ? <p style={{color:"var(--text4)",fontSize:"0.85em",textAlign:"center",padding:14}}>Playlist vacía</p> : plCompartida.items.map((it,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 2px",borderBottom:"1px solid var(--border2)"}}>
                    <CoverImg url={it.cover_url} size={36} r={6}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:"var(--text)",fontSize:"0.85em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.7em"}}>{it.artist}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Vista EXPLORAR: la página de música embebida (mismo player) ── */}
      {vista === "explorar" && <Explorar />}

      {/* Título de la sección + pestañas */}
      {vista === "musica" && (
        <>
          <h1 style={{fontSize:"1.25em",fontWeight:800,marginBottom:14,color:"var(--text-strong)"}}>Mi música</h1>
          <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
            <button onClick={()=>{setTab("downloads");setSelectedPlaylist(null);}} style={{...SM,background:tab==="downloads"?"#22c55e":"var(--panel)",color:tab==="downloads"?"#fff":"var(--text3)",padding:"8px 16px",display:"flex",alignItems:"center",gap:6}}>
              <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={14} stroke="currentColor"/> Descargadas ({downloadedMusic.length})
            </button>
            <button onClick={()=>{setTab("favorites");setSelectedPlaylist(null);}} style={{...SM,background:tab==="favorites"?"var(--accent)":"var(--panel)",color:tab==="favorites"?"#fff":"var(--text3)",padding:"8px 16px",display:"flex",alignItems:"center",gap:6}}>
              <Ico d={<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>} size={14} fill="currentColor" stroke="currentColor"/> Favoritos ({favorites.length})
            </button>
            <button onClick={()=>{setTab("stats");setSelectedPlaylist(null);}} style={{...SM,background:tab==="stats"?"var(--accent)":"var(--panel)",color:tab==="stats"?"#fff":"var(--text3)",padding:"8px 16px",display:"flex",alignItems:"center",gap:6}}>
              <Ico d={<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>} size={14} stroke="currentColor"/> Stats
            </button>
          </div>
        </>
      )}
      {vista === "playlists" && (
        <h1 style={{fontSize:"1.25em",fontWeight:800,marginBottom:14,color:"var(--text-strong)"}}>Mis playlists</h1>
      )}

      {/* ═══ TAB: Estadísticas ═══ */}
      {tab==="stats" && (() => {
        let st = {};
        try { st = JSON.parse(localStorage.getItem("aura_stats") || "{}"); } catch {}
        const arr = Object.values(st).filter(v => v && v.n);
        const total = arr.reduce((a, b) => a + b.n, 0);
        const topCanciones = [...arr].sort((a, b) => b.n - a.n).slice(0, 10);
        const porArtista = new Map();
        for (const c of arr) { const a = c.artist || "¿?"; porArtista.set(a, (porArtista.get(a) || 0) + c.n); }
        const topArtistas = [...porArtista.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxN = topCanciones[0]?.n || 1;
        const maxA = topArtistas[0]?.[1] || 1;
        return (
          <div>
            {total === 0 ? (
              <div style={{textAlign:"center",padding:40,color:"var(--text5)"}}>
                <p style={{fontSize:"1.05em",color:"var(--text3)"}}>Todavía no hay datos</p>
                <p style={{fontSize:"0.82em",marginTop:8}}>Reproducí canciones desde Descargadas y acá aparecerán tus más escuchadas.</p>
              </div>
            ) : (
              <>
                {/* Resumen */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:18}}>
                  {[["Reproducciones",total],["Canciones",arr.length],["Artista top",topArtistas[0]?.[0]||"—"]].map(([l,v])=>(
                    <div key={l} style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 10px",textAlign:"center",minWidth:0,overflow:"hidden"}}>
                      <div style={{color:"var(--accent)",fontWeight:800,fontSize:typeof v==="number"?"1.5em":"0.9em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.68em",fontWeight:700,marginTop:3}}>{l}</div>
                    </div>
                  ))}
                </div>
                {/* Top canciones */}
                <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:800,marginBottom:10}} ><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Ico d={<path d="M12 2s4 4 4 9a4 4 0 01-8 0c0-1 .5-2 1-3-2 1-4 3-4 6a6 6 0 0012 0c0-5-5-9-5-9z"/>} size={13} stroke="#f97316"/> TUS MÁS ESCUCHADAS</span></div>
                <div style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:18}}>
                  {topCanciones.map((c, i) => (
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:"1px solid var(--border2)"}}>
                      <span style={{color:i<3?"var(--accent)":"var(--text5)",fontWeight:800,fontSize:"0.9em",width:22,textAlign:"center",flexShrink:0}}>{i+1}</span>
                      <CoverImg url={c.cover} size={38} r={6}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:"var(--text)",fontSize:"0.85em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
                        <div style={{color:"var(--text4)",fontSize:"0.7em"}}>{c.artist}</div>
                        <div style={{marginTop:4,height:4,borderRadius:2,background:"var(--border2)",overflow:"hidden"}}>
                          <div style={{height:"100%",width:(c.n/maxN*100)+"%",borderRadius:2,background:"linear-gradient(90deg,var(--accent),#22c55e)"}}/>
                        </div>
                      </div>
                      <span style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:800,flexShrink:0}}>{c.n}×</span>
                    </div>
                  ))}
                </div>
                {/* Top artistas */}
                <div style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:800,marginBottom:10}} ><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Ico d={<><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>} size={13} stroke="var(--accent)"/> TUS ARTISTAS</span></div>
                <div style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
                  {topArtistas.map(([a, n], i) => (
                    <div key={a} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:"1px solid var(--border2)"}}>
                      <span style={{color:i===0?"var(--accent)":"var(--text5)",fontWeight:800,width:22,textAlign:"center",flexShrink:0}}>{i+1}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:"var(--text)",fontSize:"0.88em",fontWeight:700}}>{a}</div>
                        <div style={{marginTop:4,height:4,borderRadius:2,background:"var(--border2)",overflow:"hidden"}}>
                          <div style={{height:"100%",width:(n/maxA*100)+"%",borderRadius:2,background:"linear-gradient(90deg,#22c55e,var(--accent))"}}/>
                        </div>
                      </div>
                      <span style={{color:"var(--text3)",fontSize:"0.75em",fontWeight:800,flexShrink:0}}>{n}×</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* TAB: Descargadas */}
      {tab==="downloads" && (
        <div>
          {/* Cola de descargas EN CURSO: antes las canciones encoladas eran
              invisibles hasta terminar y parecía que no se descargaban. */}
          {queue && queue.filter(t=>t.status!=="done").length>0 && (
            <div style={{background:"var(--panel2)",border:"1px solid var(--border)",borderRadius:10,marginBottom:14,overflow:"hidden"}}>
              <div style={{padding:"9px 14px",fontSize:"0.72em",fontWeight:700,letterSpacing:0.4,color:"#eab308",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:6}}>
                <span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:"#eab308",animation:"pulse 1.2s infinite"}}/>
                DESCARGANDO ({queue.filter(t=>t.status!=="done").length})
              </div>
              {queue.filter(t=>t.status!=="done").map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderBottom:"1px solid var(--border2)"}}>
                  <CoverImg url={t.cover} size={38} r={6}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:"var(--text2)",fontSize:"0.85em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                    <div style={{color:"var(--text4)",fontSize:"0.72em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.artist}</div>
                  </div>
                  {t.status==="failed"
                    ? (t.repair
                        ? <span style={{color:"#eab308",fontSize:"0.68em",fontWeight:700,flexShrink:0}} title="La Mac aún la está bajando; se reintenta solo">esperando…</span>
                        : <span style={{color:"#ef4444",fontSize:"0.68em",fontWeight:700,flexShrink:0}} title={t.error||""}>falló</span>)
                    : t.status==="downloading"
                      ? <span style={{color:"#eab308",fontSize:"0.68em",fontWeight:700,flexShrink:0}}>bajando…</span>
                      : <span style={{color:"var(--text4)",fontSize:"0.68em",fontWeight:700,flexShrink:0}}>en cola</span>}
                </div>
              ))}
            </div>
          )}
          {downloadedMusic.length===0 ? (
            <div style={{textAlign:"center",padding:40,color:"var(--text5)"}}>
              <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={40} stroke="var(--text5)"/>
              <p style={{fontSize:"1.1em",color:"var(--text3)",marginBottom:8,marginTop:12}}>No tenes musica descargada</p>
              <p style={{fontSize:"0.85em"}}>Anda a <a href="/spotify" style={{color:"var(--accent)",fontWeight:600}}>Musica</a> y dale corazn a una cancion</p>
            </div>
          ) : (
            <>
            {/* Aviso de modo offline */}
            {!enLinea && (
              <div style={{display:"flex",gap:10,alignItems:"center",background:"rgba(34,197,94,0.10)",border:"1px solid rgba(34,197,94,0.30)",borderRadius:10,padding:"10px 13px",marginBottom:12}}>
                <span style={{flexShrink:0,display:"inline-flex",alignItems:"center",gap:6,background:"rgba(34,197,94,0.18)",color:"#22c55e",border:"1px solid rgba(34,197,94,0.45)",borderRadius:6,padding:"3px 8px",fontSize:"0.62em",fontWeight:800,letterSpacing:0.5}}>
                  <Ico d={<><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>} size={11} stroke="#22c55e" sw={2.4}/> OFF
                </span>
                <div style={{fontSize:"0.8em",lineHeight:1.5,color:"#9fd9b0"}}>
                  Modo sin conexión activo. Sonando las canciones que descargaste.
                </div>
              </div>
            )}

            {/* Buscador + controles */}
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
              {/* El buscador ocupa su propia fila: antes competia por el ancho
                  con el boton verde y en celulares angostos se empalmaban. */}
              <div style={{position:"relative",width:"100%"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",display:"flex",pointerEvents:"none"}}>
                  <Ico d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} size={15} stroke="var(--text4)"/>
                </span>
                <input
                  value={search}
                  onChange={e=>setSearch(e.target.value)}
                  placeholder="Buscar en tus descargas..."
                  style={{width:"100%",boxSizing:"border-box",padding:"11px 34px 11px 36px",borderRadius:10,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text)",fontSize:"0.9em",outline:"none"}}
                />
                {search && (
                  <button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:4,display:"flex"}}>
                    <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={14} stroke="var(--text4)"/>
                  </button>
                )}
              </div>

              {/* Fila de acciones, separada del buscador */}
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {/* Reproducir todo */}
              <button
                onClick={()=>{ const l=listaVisible; if(!l.length)return; startTrack(shuffle ? l[Math.floor(Math.random()*l.length)] : l[0]); }}
                title="Reproducir todo"
                style={{flex:1,minWidth:0,display:"flex",alignItems:"center",justifyContent:"center",gap:7,padding:"11px 16px",borderRadius:10,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",fontWeight:700,fontSize:"0.85em",boxShadow:"0 3px 12px rgba(34,197,94,0.3)"}}>
                <IcoPlay size={14}/> Reproducir
              </button>

              {/* Aleatorio */}
              <button
                onClick={()=>{ setShuffle(s=>!s); toast.info(!shuffle?"Aleatorio activado":"Aleatorio desactivado",2000); }}
                title="Reproducción aleatoria"
                style={{display:"flex",alignItems:"center",justifyContent:"center",width:42,height:42,flexShrink:0,borderRadius:10,cursor:"pointer",background:shuffle?"rgba(34,197,94,0.16)":"var(--panel2)",border:shuffle?"1px solid rgba(34,197,94,0.5)":"1px solid var(--border)"}}>
                <Ico d={<><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></>} size={17} stroke={shuffle?"#22c55e":"#777"}/>
              </button>

              {/* Repetir */}
              <button
                onClick={()=>{ const o=repeat==="off"?"all":repeat==="all"?"one":"off"; setRepeat(o); toast.info(o==="off"?"Repetir desactivado":o==="all"?"Repetir todo":"Repetir esta canción",2000); }}
                title="Repetir"
                style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center",width:42,height:42,flexShrink:0,borderRadius:10,cursor:"pointer",background:repeat!=="off"?"rgba(34,197,94,0.16)":"var(--panel2)",border:repeat!=="off"?"1px solid rgba(34,197,94,0.5)":"1px solid var(--border)"}}>
                <Ico d={<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>} size={17} stroke={repeat!=="off"?"#22c55e":"#777"}/>
                {repeat==="one" && <span style={{position:"absolute",bottom:4,right:5,fontSize:"0.55em",fontWeight:800,color:"#22c55e"}}>1</span>}
              </button>
              </div>
            </div>

            {listaVisible.length===0 ? (
              <div style={{textAlign:"center",padding:34,color:"var(--text4)",background:"var(--panel)",borderRadius:12,border:"1px solid var(--border)"}}>
                <Ico d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} size={30} stroke="var(--text6)"/>
                <p style={{marginTop:10,fontSize:"0.9em"}}>Sin resultados para “{search}”</p>
              </div>
            ) : (
            <div style={{background:"var(--panel)",borderRadius:12,border:"1px solid var(--border)",overflow:"hidden"}}>
              {listaVisible.map(item => {
                const cp = playingKey===item.key || (item.keys||[]).includes(playingKey);
                const dl = downloadingItems[item.key];
                return (
                  <div key={item.key} onClick={()=>playDownloaded(item)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:"1px solid var(--border)",background:cp?"rgba(34,197,94,0.13)":"transparent",borderLeft:cp?"3px solid #22c55e":"3px solid transparent",cursor:"pointer",transition:"background 0.2s, border-color 0.2s"}}>
                    {/* Cover + play */}
                    <div style={{position:"relative",flexShrink:0}}>
                      <CoverImg url={item.cover_url} size={52} r={8}/>
                      <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:cp&&isPlaying?"rgba(34,197,94,0.95)":"rgba(0,0,0,0.7)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",boxShadow:"0 2px 8px rgba(0,0,0,0.4)"}}>
                        {cp&&isPlaying ? <IcoPause size={15}/> : <IcoPlay size={15}/>}
                      </div>
                    </div>
                    {/* Info */}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:cp?"#22c55e":"var(--text)",fontSize:"0.92em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.78em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.artist}</div>
                      {cp && <div style={{marginTop:4,height:3,borderRadius:2,background:"var(--border)",overflow:"hidden"}}><div style={{height:"100%",borderRadius:2,background:"#22c55e",width:progress+"%",transition:"width 0.5s linear"}}/></div>}
                    </div>
                    {cp && <span style={{color:"#22c55e",fontSize:"0.72em",flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{fmt(currentTime)} / {fmt(duration)}</span>}
                    {/* Estado real: verde OFF solo si hay ARCHIVO guardado
                        (suena sin internet). Si solo hay video de YouTube,
                        badge amarillo YT: necesita internet. Antes el OFF
                        verde salía aunque no hubiera archivo, y mentía. */}
                    {item.audio_url
                      ? <span style={{padding:"2px 6px",borderRadius:4,fontSize:"0.6em",fontWeight:700,flexShrink:0,background:"rgba(34,197,94,0.15)",color:"#22c55e",border:"1px solid rgba(34,197,94,0.3)"}}>OFF</span>
                      : item.video_id
                        ? <span title="Suena por YouTube: necesita internet. Tocá ⟳ para bajarla de verdad." style={{padding:"2px 6px",borderRadius:4,fontSize:"0.6em",fontWeight:700,flexShrink:0,background:"rgba(234,179,8,0.12)",color:"#eab308",border:"1px solid rgba(234,179,8,0.3)"}}>YT</span>
                        : null}
                    {/* Sin internet ocultamos re-descargar y borrar: no se
                        pueden completar offline y sólo confunden. */}
                    {iconBtn(e=>{e.stopPropagation();encolarSiguiente(item);}, <Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="14" y2="18"/><polygon points="17 15 22 18 17 21 17 15"/></>} size={14}/>, "#555", "none", "Reproducir a continuación")}
                    {enLinea && iconBtn(e=>{e.stopPropagation();setCompartirItem(item);}, <Ico d={<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>} size={14}/>, "#555", "none", "Enviar a un amigo")}
                    {enLinea && !item.audio_url && iconBtn(e=>{e.stopPropagation();reDownload(item);}, dl ? <span style={{fontSize:"0.8em"}}>...</span> : <Ico d={<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></>} size={14}/>, "var(--text5)", "none", "Buscar de nuevo")}
                    {enLinea && iconBtn(e=>{e.stopPropagation();deleteDownload(item);}, <Ico d={<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>} size={14}/>, "var(--text5)", "none", "Eliminar")}
                  </div>
                );
              })}
            </div>
            )}
            </>
          )}
        </div>
      )}

      {/* TAB: Favoritos */}
      {tab==="favorites" && (
        <div>
          <div style={{display:"flex",gap:6,marginBottom:15}}>
            {["album","artist","track"].map(t=>(
              <button key={t} onClick={()=>setFavType(t)} style={{...SM,background:favType===t?"#22c55e":"var(--panel)",color:favType===t?"#fff":"var(--text3)"}}>
                {t==="album"?"Albumes":t==="artist"?"Artistas":"Canciones"} ({favorites.filter(f=>f.item_type===t).length})
              </button>
            ))}
          </div>
          {filteredFavs.length===0 ? (
            <div style={{textAlign:"center",padding:30,color:"var(--text5)"}}>
              <p>No tenes {favType==="album"?"albumes":favType==="artist"?"artistas":"canciones"} en favoritos</p>
              <p style={{fontSize:"0.85em",marginTop:8}}><a href="/spotify" style={{color:"var(--accent)",fontWeight:600}}>Buscar musica</a></p>
            </div>
          ) : favType==="track" ? (
            /* Canciones favoritas en LISTA (como Descargadas), con badge
               OFF verde cuando la canción ya está guardada sin internet. */
            <div style={{background:"var(--panel2)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
              {filteredFavs.map(f => {
                let isDl=false;
                try{const m=JSON.parse(localStorage.getItem("ml_mp3")||"{}");const ks=[String(f.item_id),(f.artist+" "+f.name).trim(),(f.name+" "+f.artist).trim(),f.name.trim()];for(const k of ks){if(m[k]?.audio_url){isDl=true;break;}}}catch{}
                return (
                  <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderBottom:"1px solid var(--border2)"}}>
                    <div onClick={()=>irAExplorar({album:f.extra_data?.album_id||f.item_id,source:f.source,track:f.name||""})} style={{flexShrink:0,display:"block",cursor:"pointer"}}>
                      <CoverImg url={f.cover_url} size={46} r={8}/>
                    </div>
                    <div onClick={()=>irAExplorar({album:f.extra_data?.album_id||f.item_id,source:f.source,track:f.name||""})} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                      <div style={{color:"var(--text)",fontSize:"0.9em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.76em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.artist}</div>
                    </div>
                    {isDl && (
                      <span style={{padding:"2px 7px",borderRadius:4,fontSize:"0.6em",fontWeight:800,flexShrink:0,background:"rgba(34,197,94,0.15)",color:"#22c55e",border:"1px solid rgba(34,197,94,0.35)"}}>OFF</span>
                    )}
                    <button onClick={()=>toggleFavorite(f.item_type,f.item_id)} style={{background:"none",border:"none",cursor:"pointer",padding:6,display:"flex",flexShrink:0}} title="Quitar de favoritos">
                      <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={13} stroke="#ef4444"/>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:10}}>
              {filteredFavs.map(f => {
                let isDl=false;
                try{const m=JSON.parse(localStorage.getItem("ml_mp3")||"{}");const ks=[String(f.item_id),(f.artist+" "+f.name).trim(),(f.name+" "+f.artist).trim(),f.name.trim()];for(const k of ks){if(m[k]?.video_id||m[k]?.audio_url){isDl=true;break;}}}catch{}
                return (
                  <div key={f.id} style={{background:"var(--panel)",borderRadius:10,overflow:"hidden",border:"1px solid var(--border)",position:"relative"}}>
                    <div onClick={()=>irAExplorar({album:f.extra_data?.album_id||f.item_id,source:f.source})} style={{display:"block",position:"relative",cursor:"pointer"}}>
                      <CoverImg url={f.cover_url}/>
                      {/* Insignia dentro de la portada, abajo a la izquierda:
                          antes caía sobre el nombre y se empalmaba con el texto. */}
                      {isDl && (
                        <span style={{position:"absolute",bottom:6,left:6,display:"inline-flex",alignItems:"center",gap:3,background:"rgba(8,10,14,0.82)",color:"#22c55e",padding:"3px 6px",borderRadius:5,fontSize:"0.58em",fontWeight:800,letterSpacing:.3,border:"1px solid rgba(34,197,94,0.45)",backdropFilter:"blur(4px)"}}>
                          <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={9} stroke="#22c55e" sw={2.6}/>
                          OFF
                        </span>
                      )}
                    </div>
                    <button onClick={()=>toggleFavorite(f.item_type,f.item_id)} style={{position:"absolute",top:5,right:5,background:"rgba(0,0,0,0.7)",border:"none",borderRadius:"50%",width:24,height:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={12} stroke="#ef4444"/>
                    </button>
                    <div style={{padding:"7px 9px"}}>
                      <div style={{color:"var(--text2)",fontSize:"0.78em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                      <div style={{color:"var(--text4)",fontSize:"0.68em"}}>{f.artist}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: Playlists */}
      {tab==="playlists" && !selectedPlaylist && (
        <div>
          {playlists.length===0 ? (
            <div style={{textAlign:"center",padding:30,color:"var(--text5)"}}><p>No tenes playlists</p><p style={{fontSize:"0.85em",marginTop:8}}><a href="/spotify" style={{color:"var(--accent)",fontWeight:600}}>Buscar musica</a></p></div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
              {playlists.map(pl=>(
                <div key={pl.id} onClick={()=>openPlaylist(pl)} style={{background:"var(--panel)",borderRadius:10,padding:14,cursor:"pointer",border:"1px solid var(--border)",position:"relative"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                    <CoverImg url={pl.cover_url} size={44} r={6}/>
                    <div><div style={{color:"var(--text2)",fontWeight:600,fontSize:"0.9em"}}>{pl.name}</div>{pl.description&&<div style={{color:"var(--text5)",fontSize:"0.72em"}}>{pl.description}</div>}</div>
                  </div>
                  <div style={{color:"var(--text6)",fontSize:"0.7em"}}>{pl.is_public?"Publica":"Privada"} · {new Date(pl.created_at).toLocaleDateString("es")}</div>
                  <button onClick={e=>{e.stopPropagation();deletePlaylist(pl.id);}} style={{position:"absolute",top:8,right:8,background:"none",border:"none",color:"var(--text5)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={14} stroke="var(--text5)"/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlist detail */}
      {tab==="playlists" && selectedPlaylist && (
        <div>
          <button onClick={()=>setSelectedPlaylist(null)} style={{...SM,background:"#333",marginBottom:15,color:"var(--accent)",display:"flex",alignItems:"center",gap:6}}>
            <Ico d={<polyline points="15 18 9 12 15 6"/>} size={14} stroke="var(--accent)"/> Volver
          </button>
          <div style={{background:"var(--panel)",borderRadius:10,padding:16,marginBottom:15,border:"1px solid var(--border)",display:"flex",gap:12,alignItems:"center"}}>
            <CoverImg url={selectedPlaylist.cover_url} size={56} r={8}/>
            <div style={{flex:1,minWidth:0}}><h2 style={{fontSize:"1.2em",marginBottom:2}}>{selectedPlaylist.name}</h2><p style={{color:"var(--text3)",fontSize:"0.8em"}}>{selectedPlaylist.description||"Sin descripcion"} · {playlistItems.length} items</p></div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:15,flexWrap:"wrap"}}>
            <button onClick={descargarPlaylist} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"10px 16px",borderRadius:10,border:"none",background:"#22c55e",color:"#fff",fontSize:"0.85em",fontWeight:800,cursor:"pointer"}}>
              <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={15} stroke="#fff"/> Descargar todas ({playlistItems.filter(i=>i.item_type==="track").length})
            </button>
            <button onClick={()=>setCompartirItem({type:"playlist",title:selectedPlaylist.name,name:selectedPlaylist.name,artist:"",cover_url:selectedPlaylist.cover_url||"",playlist_id:selectedPlaylist.id})} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"10px 16px",borderRadius:10,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text2)",fontSize:"0.85em",fontWeight:700,cursor:"pointer"}}>
              <Ico d={<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>} size={14} stroke="var(--accent)"/> Enviar a un amigo
            </button>
          </div>
          {playlistItems.length===0 ? <p style={{textAlign:"center",color:"var(--text5)",padding:20}}>Playlist vacia</p> : (
            <div style={{background:"var(--panel)",borderRadius:10,border:"1px solid var(--border)",overflow:"hidden"}}>
              {playlistItems.map(item=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:"1px solid var(--border)"}}>
                  <CoverImg url={item.cover_url} size={40} r={6}/>
                  <div style={{flex:1,minWidth:0}}><div style={{color:"var(--text)",fontSize:"0.88em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div><div style={{color:"var(--text4)",fontSize:"0.75em"}}>{item.artist}</div></div>
                  <button onClick={()=>removePlaylistItem(item.id)} style={{background:"none",border:"none",color:"var(--text5)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={14} stroke="var(--text5)"/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ REPRODUCTOR ═══
          Mini-barra abajo. Al tocarla (o deslizar hacia arriba) se despliega
          a pantalla completa estilo iTunes/Apple Music del celular. */}
      {hp && (
        <>
          {/* ── Mini-barra ── */}
          <div
            onClick={()=>setExpanded(true)}
            style={{position:"fixed",bottom:0,left:0,right:0,background:"linear-gradient(180deg,rgba(24,24,40,0.98),rgba(12,12,22,0.99))",borderTop:"1px solid rgba(124,92,252,0.18)",zIndex:9998,backdropFilter:"blur(20px)",boxShadow:"0 -8px 32px rgba(0,0,0,0.5)",cursor:"pointer",transform:expanded?"translateY(100%)":"translateY(0)",transition:"transform 0.32s cubic-bezier(0.32,0.72,0,1)"}}>
            {/* Progreso finito arriba */}
            <div style={{height:2.5,background:"rgba(255,255,255,0.07)"}}>
              <div style={{height:"100%",width:progress+"%",background:"linear-gradient(90deg,#22c55e,#4ade80)",transition:"width 0.25s linear"}}/>
            </div>
            <div style={{maxWidth:900,margin:"0 auto",padding:"9px 14px calc(9px + env(safe-area-inset-bottom))",display:"flex",alignItems:"center",gap:12}}>
              {playingCover
                ? <img src={playingCover} alt="" style={{width:46,height:46,borderRadius:8,objectFit:"cover",flexShrink:0,boxShadow:"0 3px 12px rgba(0,0,0,0.5)"}}/>
                : <div style={{width:46,height:46,borderRadius:8,flexShrink:0,background:"linear-gradient(135deg,var(--panel),var(--border))",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={20} stroke="var(--text5)" sw={1.5}/>
                  </div>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"#f0f0f0",fontSize:"0.88em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingTitle}</div>
                <div style={{color:"#8a8a9a",fontSize:"0.74em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingArtist}</div>
              </div>
              <button
                onClick={e=>{e.stopPropagation();togglePlay();}}
                title={isPlaying?"Pausar":"Reproducir"}
                style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:"50%",width:40,height:40,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"0 3px 12px rgba(34,197,94,0.4)"}}>
                {isPlaying ? <IcoPause size={17}/> : <IcoPlay size={17}/>}
              </button>
              <button onClick={e=>{e.stopPropagation();playNext();}} title="Siguiente"
                style={{background:"none",border:"none",cursor:"pointer",padding:4,display:"flex",flexShrink:0}}>
                <Ico d={<><polygon points="5 4 15 12 5 20 5 4" fill="#9a9aaa" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/></>} size={19} stroke="#9a9aaa" sw={2.2}/>
              </button>
            </div>
          </div>

          {/* ── Pantalla completa (desplegada) ── */}
          <div
            style={{position:"fixed",top:0,left:0,right:0,bottom:0,height:"100dvh",zIndex:9999,background:"linear-gradient(180deg,var(--panel) 0%,var(--panel2) 45%,var(--bg) 100%)",display:"flex",flexDirection:"column",transform:expanded?"translateY(0)":"translateY(100%)",transition:"transform 0.38s cubic-bezier(0.32,0.72,0,1)",overflow:"hidden",pointerEvents:expanded?"auto":"none",visibility:expanded?"visible":"hidden"}}>

            {/* Fondo difuminado con la portada */}
            {playingCover && (
              <div style={{position:"absolute",inset:0,backgroundImage:`url(${playingCover})`,backgroundSize:"cover",backgroundPosition:"center",filter:"blur(70px) saturate(1.5)",opacity:0.32,transform:"scale(1.3)",pointerEvents:"none"}}/>
            )}
            <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(var(--bg-rgb),0.35),rgba(var(--bg-rgb),0.85))",pointerEvents:"none"}}/>

            <div style={{position:"relative",flex:1,minHeight:0,display:"flex",flexDirection:"column",boxSizing:"border-box",padding:"max(8px,env(safe-area-inset-top)) 22px calc(14px + env(safe-area-inset-bottom))",maxWidth:520,width:"100%",margin:"0 auto",overflow:"hidden"}}>

              {/* Barra superior: bajar / cerrar */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                <button onClick={()=>setExpanded(false)} title="Minimizar"
                  style={{background:"none",border:"none",cursor:"pointer",padding:10,display:"flex",marginLeft:-10}}>
                  <Ico d={<polyline points="6 9 12 15 18 9"/>} size={26} stroke="#c8c8d8" sw={2.2}/>
                </button>
                <div style={{color:"#9a9aaa",fontSize:"0.68em",fontWeight:700,letterSpacing:1.4,textTransform:"uppercase"}}>Reproduciendo</div>
                <div style={{display:"flex",alignItems:"center"}}>
                <button onClick={()=>{setShowCola(v=>!v);refrescarCola();}} title="Cola de reproducción"
                  style={{background:"none",border:"none",cursor:"pointer",padding:10,display:"flex"}}>
                  <Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="14" y2="18"/><polygon points="17 15 22 18 17 21 17 15"/></>} size={21} stroke={showCola||colaRef.current.length?"#22c55e":"#8a8a9a"} sw={2}/>
                </button>
                <button onClick={()=>{stopPlayback();setExpanded(false);}} title="Cerrar"
                  style={{background:"none",border:"none",cursor:"pointer",padding:10,display:"flex",marginRight:-10}}>
                  <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={22} stroke="#8a8a9a" sw={2.2}/>
                </button>
                </div>
              </div>

              {/* Portada grande */}
              {/* La portada es lo único que cede espacio: `flex:1 1 auto` +
                  `minHeight:0` la dejan encoger en pantallas bajas en vez de
                  empujar los controles fuera de la pantalla. */}
              <div style={{flex:"1 1 auto",minHeight:0,display:"flex",alignItems:"center",justifyContent:"center",margin:"10px 0 14px"}}>
                {playingCover
                  ? <img src={playingCover} alt="" style={{height:"100%",width:"auto",maxWidth:"100%",aspectRatio:"1",borderRadius:16,objectFit:"cover",boxShadow:isPlaying?"0 22px 60px rgba(0,0,0,0.65)":"0 12px 34px rgba(0,0,0,0.5)",transform:isPlaying?"scale(1)":"scale(0.92)",transition:"transform 0.4s cubic-bezier(0.32,0.72,0,1), box-shadow 0.4s"}}/>
                  : <div style={{height:"100%",width:"auto",maxWidth:"100%",aspectRatio:"1",borderRadius:16,background:"linear-gradient(135deg,var(--panel),var(--border))",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 18px 50px rgba(0,0,0,0.55)"}}>
                      <Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={76} stroke="#3a3a4e" sw={1.2}/>
                    </div>}
              </div>

              {/* Título + artista */}
              <div style={{marginBottom:10,flexShrink:0,textAlign:"center"}}>
                <div style={{color:"var(--text-strong)",fontSize:"1.3em",fontWeight:700,lineHeight:1.25,marginBottom:5,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{playingTitle}</div>
                <div style={{color:"#a0a0b5",fontSize:"0.98em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingArtist}</div>
              </div>

              {/* Barra de progreso grande y arrastrable */}
              <div style={{flexShrink:0,marginBottom:2}}>
                <div ref={barRef} onMouseDown={startSeek} onTouchStart={startSeek}
                  style={{padding:"12px 0",cursor:"pointer",touchAction:"none"}}>
                  <div style={{position:"relative",height:6,borderRadius:3,background:"rgba(255,255,255,0.14)"}}>
                    <div style={{position:"absolute",top:0,left:0,height:"100%",borderRadius:3,width:(seeking?seekPct:progress)+"%",background:"linear-gradient(90deg,#22c55e,#4ade80)",transition:seeking?"none":"width 0.25s linear"}}/>
                    <div style={{position:"absolute",top:"50%",left:(seeking?seekPct:progress)+"%",transform:"translate(-50%,-50%)",width:seeking?20:15,height:seeking?20:15,borderRadius:"50%",background:"#fff",boxShadow:seeking?"0 0 0 7px rgba(34,197,94,0.24),0 3px 10px rgba(0,0,0,0.55)":"0 2px 8px rgba(0,0,0,0.55)",transition:seeking?"width 0.13s,height 0.13s":"left 0.25s linear,width 0.13s,height 0.13s",pointerEvents:"none"}}/>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:-2}}>
                  <span style={{color:"#8a8a9a",fontSize:"0.74em",fontVariantNumeric:"tabular-nums"}}>{fmt(seeking?(seekPct/100)*duration:currentTime)}</span>
                  <span style={{color:"#8a8a9a",fontSize:"0.74em",fontVariantNumeric:"tabular-nums"}}>-{fmt(Math.max(0,duration-(seeking?(seekPct/100)*duration:currentTime)))}</span>
                </div>
              </div>

              {/* Controles principales */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"clamp(18px,7vw,30px)",margin:"10px 0 12px",flexShrink:0}}>
                <button onClick={playPrev} title="Anterior"
                  style={{background:"none",border:"none",cursor:"pointer",padding:8,display:"flex"}}>
                  <Ico d={<><polygon points="19 20 9 12 19 4 19 20" fill="#e0e0ea" stroke="none"/><line x1="5" y1="5" x2="5" y2="19"/></>} size={30} stroke="#e0e0ea" sw={2.4}/>
                </button>

                <button
                  onClick={togglePlay}
                  title={isPlaying?"Pausar":"Reproducir"}
                  style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:"50%",width:70,height:70,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"0 8px 28px rgba(34,197,94,0.45)"}}>
                  {isPlaying ? <IcoPause size={30}/> : <IcoPlay size={30}/>}
                </button>

                <button onClick={playNext} title="Siguiente"
                  style={{background:"none",border:"none",cursor:"pointer",padding:8,display:"flex"}}>
                  <Ico d={<><polygon points="5 4 15 12 5 20 5 4" fill="#e0e0ea" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/></>} size={30} stroke="#e0e0ea" sw={2.4}/>
                </button>
              </div>

              {/* Fila secundaria: -15s, aleatorio, repetir, +15s */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"clamp(20px,8vw,32px)",flexShrink:0,paddingBottom:2}}>
                <button onClick={()=>seekTo(Math.max(0,currentTime-15))} title="Retroceder 15s"
                  style={{background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></>} size={21} stroke="#8a8a9a" sw={2.2}/>
                </button>

                <button onClick={()=>{const nuevo=!shuffle;setShuffle(nuevo);if(nuevo)regenerarOrdenAleatorio(playingKey);toast.info(nuevo?"Aleatorio activado":"Aleatorio desactivado",2000);}} title="Aleatorio"
                  style={{background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></>} size={21} stroke={shuffle?"#22c55e":"#8a8a9a"} sw={2.1}/>
                </button>

                <button onClick={abrirLetra} title="Letra"
                  style={{background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>} size={21} stroke={showLetra?"#22c55e":"#8a8a9a"} sw={2.1}/>
                </button>

                <button onClick={()=>{const o=repeat==="off"?"all":repeat==="all"?"one":"off";setRepeat(o);toast.info(o==="off"?"Repetir desactivado":o==="all"?"Repetir todo":"Repetir esta canción",2000);}} title="Repetir"
                  style={{position:"relative",background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>} size={21} stroke={repeat!=="off"?"#22c55e":"#8a8a9a"} sw={2.1}/>
                  {repeat==="one" && <span style={{position:"absolute",bottom:2,right:3,fontSize:"0.6em",fontWeight:800,color:"#22c55e"}}>1</span>}
                </button>

                <button onClick={()=>seekTo(Math.min(duration,currentTime+15))} title="Adelantar 15s"
                  style={{background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/></>} size={21} stroke="#8a8a9a" sw={2.2}/>
                </button>
              </div>
            </div>

            {/* ── Panel de COLA: qué va a sonar a continuación ── */}
            {showCola && (() => {
              const { manual, resto } = proximas(20);
              const filaCola = (item, esManual) => (
                <div key={(esManual?"m_":"s_")+item.key}
                  onTouchStart={esManual ? (e)=>setSwipeCola({key:item.key,dx:0,x0:e.touches[0].clientX}) : undefined}
                  onTouchMove={esManual ? (e)=>{ if(swipeCola.key===item.key) setSwipeCola(s=>({...s,dx:Math.min(0,e.touches[0].clientX-s.x0)})); } : undefined}
                  onTouchEnd={esManual ? ()=>{ if(swipeCola.key===item.key && swipeCola.dx<-70) quitarDeCola(item.key); setSwipeCola({key:null,dx:0,x0:0}); } : undefined}
                  style={{position:"relative",overflow:"hidden",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                  {esManual && swipeCola.key===item.key && swipeCola.dx<-20 && (
                    <div style={{position:"absolute",inset:0,background:"rgba(239,68,68,0.25)",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:18,color:"#ef4444",fontWeight:800,fontSize:"0.8em"}}>Quitar ✕</div>
                  )}
                  <div onClick={()=>{ if(esManual) quitarDeColaYSonar(item); else startTrack(item); }}
                    style={{display:"flex",alignItems:"center",gap:11,padding:"10px 4px",cursor:"pointer",background:"rgba(10,10,20,0.92)",transform:swipeCola.key===item.key?`translateX(${swipeCola.dx}px)`:"none",transition:swipeCola.key===item.key?"none":"transform 0.2s"}}>
                    <CoverImg url={item.cover_url} size={42} r={7}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:"#e8e8f0",fontSize:"0.88em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
                      <div style={{color:"#7a7a8c",fontSize:"0.72em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.artist}</div>
                    </div>
                    {esManual && (
                      <button onClick={(e)=>{e.stopPropagation();quitarDeCola(item.key);}} title="Quitar de la cola"
                        style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",color:"#8a8a9a",fontSize:"0.75em",flexShrink:0}}>✕</button>
                    )}
                  </div>
                </div>
              );
              return (
                <div onClick={e=>e.stopPropagation()} style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(10,10,20,0.97),rgba(10,10,20,0.99))",zIndex:5,display:"flex",flexDirection:"column",paddingTop:"env(safe-area-inset-top)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",flexShrink:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:9,color:"#fff",fontWeight:800}}>
                      <Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="14" y2="18"/><polygon points="17 15 22 18 17 21 17 15"/></>} size={18} stroke="#22c55e" sw={2}/>
                      A continuación
                    </div>
                    <button onClick={()=>setShowCola(false)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",color:"#fff",fontSize:"1em",flexShrink:0}}>✕</button>
                  </div>
                  <div style={{flex:1,overflowY:"auto",padding:"0 18px calc(110px + env(safe-area-inset-bottom))"}}>
                    {manual.length > 0 && (
                      <>
                        <div style={{color:"#22c55e",fontSize:"0.68em",fontWeight:800,letterSpacing:0.5,margin:"6px 0 4px"}}>TU COLA · deslizá ← para quitar</div>
                        {manual.map(it => filaCola(it, true))}
                      </>
                    )}
                    <div style={{color:"#7a7a8c",fontSize:"0.68em",fontWeight:800,letterSpacing:0.5,margin:"14px 0 4px"}}>{shuffle ? "DESPUÉS · orden aleatorio" : "DESPUÉS"}</div>
                    {resto.length === 0 && manual.length === 0
                      ? <p style={{color:"#7a7a8c",fontSize:"0.85em",textAlign:"center",padding:24}}>Nada en cola. Marcá canciones con el botón de cola en Descargadas.</p>
                      : resto.map(it => filaCola(it, false))}
                  </div>
                </div>
              );
            })()}

            {/* ── Panel de LETRA (karaoke): se desliza sobre el player ── */}
            {showLetra && (
              <div onClick={e=>e.stopPropagation()} style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(10,10,20,0.97),rgba(10,10,20,0.99))",zIndex:5,display:"flex",flexDirection:"column",paddingTop:"env(safe-area-inset-top)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",flexShrink:0}}>
                  <div style={{minWidth:0}}>
                    <div style={{color:"#fff",fontWeight:800,fontSize:"1em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingTitle}</div>
                    <div style={{color:"#8a8a9a",fontSize:"0.78em"}}>{playingArtist}</div>
                  </div>
                  <button onClick={()=>setShowLetra(false)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",color:"#fff",fontSize:"1em",flexShrink:0}}>✕</button>
                </div>
                <div ref={letraContRef} style={{flex:1,overflowY:"auto",position:"relative",padding:"10px 24px calc(120px + env(safe-area-inset-bottom))"}}>
                  {letraCargando && <p style={{color:"var(--accent)",textAlign:"center",padding:30}}>Buscando la letra...</p>}
                  {!letraCargando && letra && !letra.encontrada && (
                    <p style={{color:"#8a8a9a",textAlign:"center",padding:30,lineHeight:1.6}}>No encontramos la letra de esta canción</p>
                  )}
                  {/* Sincronizada: karaoke con línea activa + tocar para saltar */}
                  {!letraCargando && letra && letra.lineas.length > 0 && letra.lineas.map((l, i) => (
                    <p key={i} ref={el=>{lineaRefs.current[i]=el;}} onClick={()=>seekTo(l.t)}
                      style={{
                        color: i===lineaActiva ? "#fff" : i<lineaActiva ? "#5a5a6e" : "#8a8a9a",
                        fontSize: i===lineaActiva ? "1.35em" : "1.05em",
                        fontWeight: i===lineaActiva ? 800 : 600,
                        lineHeight: 1.45, margin: "14px 0", cursor: "pointer",
                        transition: "color 0.25s, font-size 0.25s",
                        textShadow: i===lineaActiva ? "0 2px 18px rgba(34,197,94,0.35)" : "none",
                      }}>{l.texto}</p>
                  ))}
                  {/* Solo texto plano (sin tiempos) */}
                  {!letraCargando && letra && letra.lineas.length === 0 && letra.plain && (
                    <pre style={{color:"#c5c5d2",fontSize:"1.02em",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{letra.plain}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
