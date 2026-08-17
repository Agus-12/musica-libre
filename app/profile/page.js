"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import { useToast } from "../components/ToastContext";

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
  const [downloadedMusic, setDownloadedMusic] = useState([]);

  // Arrastre de la barra de progreso estilo iTunes
  const [seeking, setSeeking] = useState(false);
  const [seekPct, setSeekPct] = useState(0);
  const barRef = useRef(null);

  // Buscador, orden aleatorio, repetición y vista ampliada (celular)
  const [search, setSearch] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off");   // off | all | one
  const [expanded, setExpanded] = useState(false);

  // Espejo del estado para los callbacks del player (que se registran una vez
  // y si no, verían valores viejos).
  const liveRef = useRef({ list: [], playingKey: null, shuffle: false, repeat: "off" });

  function refreshDownloads() {
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const offline = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      const items = [];
      for (const [key, entry] of Object.entries(mp3s)) {
        if (!entry.video_id && !entry.apple_url && !entry.audio_url) continue;
        let coverUrl = "", artistName = "", trackName = entry.title || key;
        const oe = offline[key];
        if (oe) { coverUrl = oe.cover_url || ""; artistName = oe.artist || ""; trackName = oe.name || trackName; }
        if (!coverUrl) {
          const fm = favorites.find(f => [String(f.item_id), (f.artist+" "+f.name).trim(), (f.name+" "+f.artist).trim(), f.name.trim()].includes(key));
          if (fm) { coverUrl = fm.cover_url || ""; artistName = fm.artist || ""; trackName = fm.name || trackName; }
        }
        items.push({ key, title: trackName, artist: artistName, cover_url: coverUrl, video_id: entry.video_id || "", audio_url: entry.audio_url || "", apple_url: entry.apple_url || "", method: entry.method || (entry.video_id ? "youtube" : "apple"), saved_at: entry.saved_at || 0 });
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

  useEffect(() => { refreshDownloads(); }, [favorites]);

  /* CLAVE PARA EL AUTOPLAY: creamos el reproductor apenas carga la página,
     NO cuando tocás una canción. Antes el iframe nacía dentro del click y
     tardaba en estar listo; para cuando respondía, el navegador ya había
     descartado el "gesto del usuario" y bloqueaba el sonido — por eso había
     que darle play una segunda vez. Ahora, al tocar, el player ya existe y
     playVideo() se ejecuta dentro del mismo gesto. */
  useEffect(() => { ensurePlayer(); }, []);

  useEffect(() => {
    if (isPlaying && playerRef.current) {
      progressRef.current = setInterval(() => {
        // Mientras el dedo/mouse arrastra, no pisamos la posición manual
        if (seeking) return;
        try { const t = playerRef.current.getCurrentTime(); const d = playerRef.current.getDuration(); setCurrentTime(t||0); setDuration(d||0); setProgress(d>0?(t/d)*100:0); } catch {}
      }, 250);
    } else { if (progressRef.current) clearInterval(progressRef.current); }
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [isPlaying, seeking]);

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

  // Limpieza de los reintentos de play al desmontar
  useEffect(() => () => { if (kickRef.current) clearInterval(kickRef.current); }, []);

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
    setSeeking(true);
    setSeekPct(pctFromEvent(e) * 100);
  }

  useEffect(() => {
    if (!seeking) return;
    const move = (e) => { setSeekPct(pctFromEvent(e) * 100); if (e.cancelable) e.preventDefault(); };
    const end = () => {
      setSeeking(false);
      setSeekPct((p) => { seekTo((p / 100) * (duration || 0)); return p; });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
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

  function startTrack(item) {
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

    if (liveRef.current.shuffle) {
      if (lista.length === 1) return lista[0];
      let r = i;
      while (r === i) r = Math.floor(Math.random() * lista.length);
      return lista[r];
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

  function setupMediaSession(item) {
    if (!("mediaSession" in navigator)) return;
    const as = item.cover_url ? "/api/proxy?url=" + encodeURIComponent(item.cover_url) : "";
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || "", artist: item.artist || "", album: "",
        artwork: as ? [{src:as,sizes:"96x96",type:"image/jpeg"},{src:as,sizes:"256x256",type:"image/jpeg"},{src:as,sizes:"512x512",type:"image/jpeg"}] : [],
      });
    } catch {}
    navigator.mediaSession.playbackState = "playing";
    navigator.mediaSession.setActionHandler("play", () => { playerRef.current?.playVideo(); setIsPlaying(true); });
    navigator.mediaSession.setActionHandler("pause", () => { playerRef.current?.pauseVideo(); setIsPlaying(false); });
    try { navigator.mediaSession.setActionHandler("stop", () => stopPlayback()); } catch {}
    try { navigator.mediaSession.setActionHandler("seekto", (d) => { if (d.seekTime != null) seekTo(d.seekTime); }); } catch {}
    // Botones de anterior/siguiente en la pantalla de bloqueo del celular
    try { navigator.mediaSession.setActionHandler("nexttrack", () => playNext()); } catch {}
    try { navigator.mediaSession.setActionHandler("previoustrack", () => playPrev()); } catch {}
  }

  async function playDownloaded(item) {
    // Misma canción → alternar play/pausa
    if (playingKey === item.key && playerRef.current && playerReadyRef.current) {
      try {
        const s = playerRef.current.getPlayerState();
        if (s === 1) { playerRef.current.pauseVideo(); setIsPlaying(false); }
        else { playerRef.current.playVideo(); setIsPlaying(true); }
      } catch {}
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
    if (!playerRef.current || !playerReadyRef.current) return;
    const d = duration || 0;
    const t = Math.max(0, Math.min(seconds, d || seconds));
    try {
      playerRef.current.seekTo(t, true);
      setCurrentTime(t);
      if (d > 0) setProgress((t / d) * 100);
    } catch {}
  }

  function stopPlayback() {
    // Ojo: NO destruimos el player, solo paramos. Así sigue listo para la
    // próxima canción y el play responde al primer toque.
    if (playerRef.current && playerReadyRef.current) { try { playerRef.current.stopVideo(); } catch {} }
    setPlayingKey(null);setIsPlaying(false);setPlayingTitle("");setPlayingArtist("");setPlayingCover("");
    setProgress(0);setCurrentTime(0);setDuration(0);
    if("mediaSession" in navigator){navigator.mediaSession.playbackState="none";navigator.mediaSession.metadata=null;}
  }

  async function reDownload(item) {
    setDownloadingItems(p=>({...p,[item.key]:true}));
    toast.info("Buscando: "+item.title,3000);
    try {
      const res = await fetch("/api/download-mp3?q="+encodeURIComponent((item.artist+" "+item.title).trim()||item.key));
      const data = await res.json();
      if(data.video_id){try{const s=JSON.parse(localStorage.getItem("ml_mp3")||"{}");const ks=item.keys&&item.keys.length?item.keys:[item.key];for(const k of ks)s[k]={...s[k],video_id:data.video_id,saved_at:Date.now()};localStorage.setItem("ml_mp3",JSON.stringify(s));}catch{} toast.success("Encontrada: "+item.title,4000);refreshDownloads();}
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

      // También la metadata offline
      try {
        const off = JSON.parse(localStorage.getItem("ml_offline") || "{}");
        for (const k of claves) delete off[k];
        localStorage.setItem("ml_offline", JSON.stringify(off));
      } catch {}

      if (item.audio_url && "caches" in window) {
        try { const c = await caches.open("ml-saved-v1"); await c.delete(item.audio_url); } catch {}
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

  if(loading) return <div style={{textAlign:"center",padding:60,color:"#7c5cfc"}}>Cargando...</div>;

  const filteredFavs = favorites.filter(f=>f.item_type===favType);
  async function openPlaylist(pl){setSelectedPlaylist(pl);const r=await fetch("/api/playlists?id="+pl.id);const d=await r.json();setPlaylistItems(d.items||[]);}
  async function deletePlaylist(id){if(!confirm("Borrar esta playlist?"))return;await fetch("/api/playlists",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({playlist_id:id})});loadPlaylists();if(selectedPlaylist?.id===id)setSelectedPlaylist(null);}
  async function removePlaylistItem(iid){await fetch("/api/playlists",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove-item",item_id:iid})});if(selectedPlaylist)openPlaylist(selectedPlaylist);}

  const SM = {padding:"6px 14px",borderRadius:6,border:"none",color:"#fff",fontSize:"0.85em",cursor:"pointer",fontWeight:600};

  function CoverImg({url,size="100%",r=0}) {
    const w=typeof size==="string"?size:size+"px";
    if(url) return <img src={url} style={{width:w,height:w,borderRadius:r,objectFit:"cover",display:"block"}}/>;
    return <div style={{width:w,height:w,borderRadius:r,background:"linear-gradient(135deg,#1a1a2e,#2a2a3e)",display:"flex",alignItems:"center",justifyContent:"center"}}><Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={32} stroke="#444" sw={1.5}/></div>;
  }

  function fmt(s){if(!s||isNaN(s))return"0:00";const m=Math.floor(s/60);return m+":"+String(Math.floor(s%60)).padStart(2,"0");}
  const hp = playingKey!==null;

  const iconBtn = (onClick, icon, color="#555", bg="none", title="", sz=14) => (
    <button onClick={onClick} title={title} style={{background:bg,border:"none",color,cursor:"pointer",padding:2,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{icon}</button>
  );

  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:20,paddingBottom:hp?86:20}}>
      <div id="yt-player-container" style={{position:"absolute",top:-9999,left:-9999,width:1,height:1,overflow:"hidden"}}/>

      {/* Header */}
      <div style={{background:"#1a1a2e",borderRadius:14,padding:22,marginBottom:22,border:"1px solid #2a2a3e",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,#7c5cfc,#1ed760)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"2em",flexShrink:0}}>
          {(profile?.display_name||profile?.username||"U")[0].toUpperCase()}
        </div>
        <div style={{flex:1,minWidth:120}}>
          <h1 style={{fontSize:"1.3em",marginBottom:2}}>{profile?.display_name||profile?.username||"Usuario"}</h1>
          <p style={{color:"#888",fontSize:"0.82em"}}>@{profile?.username||"user"}</p>
          <div style={{display:"flex",gap:12,color:"#555",fontSize:"0.78em",marginTop:4}}>
            <span>{favorites.length} favoritos</span>
            <span>{downloadedMusic.length} descargadas</span>
            <span>{playlists.length} playlists</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        <button onClick={()=>{setTab("downloads");setSelectedPlaylist(null);}} style={{...SM,background:tab==="downloads"?"#22c55e":"#1a1a2e",color:tab==="downloads"?"#fff":"#888",padding:"8px 16px",display:"flex",alignItems:"center",gap:6}}>
          <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={14}/> Descargadas ({downloadedMusic.length})
        </button>
        <button onClick={()=>{setTab("favorites");setSelectedPlaylist(null);}} style={{...SM,background:tab==="favorites"?"#7c5cfc":"#1a1a2e",color:tab==="favorites"?"#fff":"#888",padding:"8px 16px",display:"flex",alignItems:"center",gap:6}}>
          <Ico d={<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>} size={14} fill="currentColor"/> Favoritos ({favorites.length})
        </button>
        <button onClick={()=>{setTab("playlists");setSelectedPlaylist(null);}} style={{...SM,background:tab==="playlists"?"#7c5cfc":"#1a1a2e",color:tab==="playlists"?"#fff":"#888",padding:"8px 16px",display:"flex",alignItems:"center",gap:6}}>
          <Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>} size={14}/> Playlists ({playlists.length})
        </button>
      </div>

      {/* TAB: Descargadas */}
      {tab==="downloads" && (
        <div>
          {downloadedMusic.length===0 ? (
            <div style={{textAlign:"center",padding:40,color:"#555"}}>
              <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={40} stroke="#555"/>
              <p style={{fontSize:"1.1em",color:"#888",marginBottom:8,marginTop:12}}>No tenes musica descargada</p>
              <p style={{fontSize:"0.85em"}}>Anda a <a href="/spotify" style={{color:"#7c5cfc",fontWeight:600}}>Musica</a> y dale corazn a una cancion</p>
            </div>
          ) : (
            <>
            {/* Buscador + controles */}
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{position:"relative",flex:1,minWidth:190}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",display:"flex",pointerEvents:"none"}}>
                  <Ico d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} size={15} stroke="#666"/>
                </span>
                <input
                  value={search}
                  onChange={e=>setSearch(e.target.value)}
                  placeholder="Buscar en tus descargas..."
                  style={{width:"100%",padding:"11px 34px 11px 36px",borderRadius:10,border:"1px solid #2a2a3e",background:"#12121f",color:"#e0e0e0",fontSize:"0.9em",outline:"none"}}
                />
                {search && (
                  <button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:4,display:"flex"}}>
                    <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={14} stroke="#666"/>
                  </button>
                )}
              </div>

              {/* Reproducir todo */}
              <button
                onClick={()=>{ const l=listaVisible; if(!l.length)return; startTrack(shuffle ? l[Math.floor(Math.random()*l.length)] : l[0]); }}
                title="Reproducir todo"
                style={{display:"flex",alignItems:"center",gap:7,padding:"11px 16px",borderRadius:10,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",fontWeight:700,fontSize:"0.85em",boxShadow:"0 3px 12px rgba(34,197,94,0.3)"}}>
                <IcoPlay size={14}/> Reproducir
              </button>

              {/* Aleatorio */}
              <button
                onClick={()=>{ setShuffle(s=>!s); toast.info(!shuffle?"Aleatorio activado":"Aleatorio desactivado",2000); }}
                title="Reproducción aleatoria"
                style={{display:"flex",alignItems:"center",justifyContent:"center",width:42,height:42,borderRadius:10,cursor:"pointer",background:shuffle?"rgba(34,197,94,0.16)":"#12121f",border:shuffle?"1px solid rgba(34,197,94,0.5)":"1px solid #2a2a3e"}}>
                <Ico d={<><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></>} size={17} stroke={shuffle?"#22c55e":"#777"}/>
              </button>

              {/* Repetir */}
              <button
                onClick={()=>{ const o=repeat==="off"?"all":repeat==="all"?"one":"off"; setRepeat(o); toast.info(o==="off"?"Repetir desactivado":o==="all"?"Repetir todo":"Repetir esta canción",2000); }}
                title="Repetir"
                style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center",width:42,height:42,borderRadius:10,cursor:"pointer",background:repeat!=="off"?"rgba(34,197,94,0.16)":"#12121f",border:repeat!=="off"?"1px solid rgba(34,197,94,0.5)":"1px solid #2a2a3e"}}>
                <Ico d={<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>} size={17} stroke={repeat!=="off"?"#22c55e":"#777"}/>
                {repeat==="one" && <span style={{position:"absolute",bottom:4,right:5,fontSize:"0.55em",fontWeight:800,color:"#22c55e"}}>1</span>}
              </button>
            </div>

            {listaVisible.length===0 ? (
              <div style={{textAlign:"center",padding:34,color:"#666",background:"#1a1a2e",borderRadius:12,border:"1px solid #2a2a3e"}}>
                <Ico d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} size={30} stroke="#444"/>
                <p style={{marginTop:10,fontSize:"0.9em"}}>Sin resultados para “{search}”</p>
              </div>
            ) : (
            <div style={{background:"#1a1a2e",borderRadius:12,border:"1px solid #2a2a3e",overflow:"hidden"}}>
              {listaVisible.map(item => {
                const cp = playingKey===item.key;
                const dl = downloadingItems[item.key];
                return (
                  <div key={item.key} onClick={()=>playDownloaded(item)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:"1px solid #2a2a3e",background:cp?"rgba(34,197,94,0.08)":"transparent",cursor:"pointer",transition:"background 0.2s"}}>
                    {/* Cover + play */}
                    <div style={{position:"relative",flexShrink:0}}>
                      <CoverImg url={item.cover_url} size={52} r={8}/>
                      <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:cp&&isPlaying?"rgba(34,197,94,0.95)":"rgba(0,0,0,0.7)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",boxShadow:"0 2px 8px rgba(0,0,0,0.4)"}}>
                        {cp&&isPlaying ? <IcoPause size={15}/> : <IcoPlay size={15}/>}
                      </div>
                    </div>
                    {/* Info */}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:cp?"#22c55e":"#e0e0e0",fontSize:"0.92em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
                      <div style={{color:"#666",fontSize:"0.78em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.artist}</div>
                      {cp && <div style={{marginTop:4,height:3,borderRadius:2,background:"#2a2a3e",overflow:"hidden"}}><div style={{height:"100%",borderRadius:2,background:"#22c55e",width:progress+"%",transition:"width 0.5s linear"}}/></div>}
                    </div>
                    {cp && <span style={{color:"#22c55e",fontSize:"0.72em",flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{fmt(currentTime)} / {fmt(duration)}</span>}
                    {/* OFF badge */}
                    {item.video_id && <span style={{padding:"2px 6px",borderRadius:4,fontSize:"0.6em",fontWeight:700,flexShrink:0,background:"rgba(34,197,94,0.15)",color:"#22c55e",border:"1px solid rgba(34,197,94,0.3)"}}>OFF</span>}
                    {/* Refresh */}
                    {iconBtn(e=>{e.stopPropagation();reDownload(item);}, dl ? <span style={{fontSize:"0.8em"}}>...</span> : <Ico d={<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></>} size={14}/>, "#555", "none", "Buscar de nuevo")}
                    {/* Delete */}
                    {iconBtn(e=>{e.stopPropagation();deleteDownload(item);}, <Ico d={<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>} size={14}/>, "#555", "none", "Eliminar")}
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
              <button key={t} onClick={()=>setFavType(t)} style={{...SM,background:favType===t?"#22c55e":"#1a1a2e",color:favType===t?"#fff":"#888"}}>
                {t==="album"?"Albumes":t==="artist"?"Artistas":"Canciones"} ({favorites.filter(f=>f.item_type===t).length})
              </button>
            ))}
          </div>
          {filteredFavs.length===0 ? (
            <div style={{textAlign:"center",padding:30,color:"#555"}}>
              <p>No tenes {favType==="album"?"albumes":favType==="artist"?"artistas":"canciones"} en favoritos</p>
              <p style={{fontSize:"0.85em",marginTop:8}}><a href="/spotify" style={{color:"#7c5cfc",fontWeight:600}}>Buscar musica</a></p>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:10}}>
              {filteredFavs.map(f => {
                let isDl=false;
                try{const m=JSON.parse(localStorage.getItem("ml_mp3")||"{}");const ks=[String(f.item_id),(f.artist+" "+f.name).trim(),(f.name+" "+f.artist).trim(),f.name.trim()];for(const k of ks){if(m[k]?.video_id||m[k]?.audio_url){isDl=true;break;}}}catch{}
                return (
                  <div key={f.id} style={{background:"#1a1a2e",borderRadius:10,overflow:"hidden",border:"1px solid #2a2a3e",position:"relative"}}>
                    <a href={`/spotify?album=${f.extra_data?.album_id||f.item_id}&source=${f.source}`} style={{textDecoration:"none",display:"block"}}><CoverImg url={f.cover_url}/></a>
                    {isDl && <span style={{position:"absolute",bottom:28,left:4,background:"rgba(34,197,94,0.9)",color:"#fff",padding:"1px 5px",borderRadius:4,fontSize:"0.6em",fontWeight:700}}>OFF</span>}
                    <button onClick={()=>toggleFavorite(f.item_type,f.item_id)} style={{position:"absolute",top:5,right:5,background:"rgba(0,0,0,0.7)",border:"none",borderRadius:"50%",width:24,height:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={12} stroke="#ef4444"/>
                    </button>
                    <div style={{padding:"7px 9px"}}>
                      <div style={{color:"#ccc",fontSize:"0.78em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                      <div style={{color:"#666",fontSize:"0.68em"}}>{f.artist}</div>
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
            <div style={{textAlign:"center",padding:30,color:"#555"}}><p>No tenes playlists</p><p style={{fontSize:"0.85em",marginTop:8}}><a href="/spotify" style={{color:"#7c5cfc",fontWeight:600}}>Buscar musica</a></p></div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
              {playlists.map(pl=>(
                <div key={pl.id} onClick={()=>openPlaylist(pl)} style={{background:"#1a1a2e",borderRadius:10,padding:14,cursor:"pointer",border:"1px solid #2a2a3e",position:"relative"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                    <CoverImg url={pl.cover_url} size={44} r={6}/>
                    <div><div style={{color:"#ccc",fontWeight:600,fontSize:"0.9em"}}>{pl.name}</div>{pl.description&&<div style={{color:"#555",fontSize:"0.72em"}}>{pl.description}</div>}</div>
                  </div>
                  <div style={{color:"#444",fontSize:"0.7em"}}>{pl.is_public?"Publica":"Privada"} · {new Date(pl.created_at).toLocaleDateString("es")}</div>
                  <button onClick={e=>{e.stopPropagation();deletePlaylist(pl.id);}} style={{position:"absolute",top:8,right:8,background:"none",border:"none",color:"#555",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={14} stroke="#555"/>
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
          <button onClick={()=>setSelectedPlaylist(null)} style={{...SM,background:"#333",marginBottom:15,color:"#7c5cfc",display:"flex",alignItems:"center",gap:6}}>
            <Ico d={<polyline points="15 18 9 12 15 6"/>} size={14} stroke="#7c5cfc"/> Volver
          </button>
          <div style={{background:"#1a1a2e",borderRadius:10,padding:16,marginBottom:15,border:"1px solid #2a2a3e",display:"flex",gap:12,alignItems:"center"}}>
            <CoverImg url={selectedPlaylist.cover_url} size={56} r={8}/>
            <div><h2 style={{fontSize:"1.2em",marginBottom:2}}>{selectedPlaylist.name}</h2><p style={{color:"#888",fontSize:"0.8em"}}>{selectedPlaylist.description||"Sin descripcion"} · {playlistItems.length} items</p></div>
          </div>
          {playlistItems.length===0 ? <p style={{textAlign:"center",color:"#555",padding:20}}>Playlist vacia</p> : (
            <div style={{background:"#1a1a2e",borderRadius:10,border:"1px solid #2a2a3e",overflow:"hidden"}}>
              {playlistItems.map(item=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:"1px solid #2a2a3e"}}>
                  <CoverImg url={item.cover_url} size={40} r={6}/>
                  <div style={{flex:1,minWidth:0}}><div style={{color:"#e0e0e0",fontSize:"0.88em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div><div style={{color:"#666",fontSize:"0.75em"}}>{item.artist}</div></div>
                  <button onClick={()=>removePlaylistItem(item.id)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={14} stroke="#555"/>
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
            <div style={{maxWidth:900,margin:"0 auto",padding:"9px 14px",display:"flex",alignItems:"center",gap:12}}>
              {playingCover
                ? <img src={playingCover} alt="" style={{width:46,height:46,borderRadius:8,objectFit:"cover",flexShrink:0,boxShadow:"0 3px 12px rgba(0,0,0,0.5)"}}/>
                : <div style={{width:46,height:46,borderRadius:8,flexShrink:0,background:"linear-gradient(135deg,#1a1a2e,#2a2a3e)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={20} stroke="#555" sw={1.5}/>
                  </div>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"#f0f0f0",fontSize:"0.88em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingTitle}</div>
                <div style={{color:"#8a8a9a",fontSize:"0.74em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingArtist}</div>
              </div>
              <button
                onClick={e=>{e.stopPropagation();if(!playerRef.current||!playerReadyRef.current)return;if(isPlaying){playerRef.current.pauseVideo();setIsPlaying(false);}else{playerRef.current.playVideo();setIsPlaying(true);kickPlay();}}}
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
            style={{position:"fixed",inset:0,zIndex:9999,background:"linear-gradient(180deg,#1a1a2e 0%,#12121f 45%,#0a0a14 100%)",display:"flex",flexDirection:"column",transform:expanded?"translateY(0)":"translateY(100%)",transition:"transform 0.38s cubic-bezier(0.32,0.72,0,1)",overflow:"hidden"}}>

            {/* Fondo difuminado con la portada */}
            {playingCover && (
              <div style={{position:"absolute",inset:0,backgroundImage:`url(${playingCover})`,backgroundSize:"cover",backgroundPosition:"center",filter:"blur(70px) saturate(1.5)",opacity:0.32,transform:"scale(1.3)",pointerEvents:"none"}}/>
            )}
            <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(10,10,20,0.35),rgba(10,10,20,0.85))",pointerEvents:"none"}}/>

            <div style={{position:"relative",flex:1,display:"flex",flexDirection:"column",padding:"10px 24px 30px",maxWidth:520,width:"100%",margin:"0 auto",overflowY:"auto"}}>

              {/* Barra superior: bajar / cerrar */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                <button onClick={()=>setExpanded(false)} title="Minimizar"
                  style={{background:"none",border:"none",cursor:"pointer",padding:10,display:"flex",marginLeft:-10}}>
                  <Ico d={<polyline points="6 9 12 15 18 9"/>} size={26} stroke="#c8c8d8" sw={2.2}/>
                </button>
                <div style={{color:"#9a9aaa",fontSize:"0.68em",fontWeight:700,letterSpacing:1.4,textTransform:"uppercase"}}>Reproduciendo</div>
                <button onClick={()=>{stopPlayback();setExpanded(false);}} title="Cerrar"
                  style={{background:"none",border:"none",cursor:"pointer",padding:10,display:"flex",marginRight:-10}}>
                  <Ico d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} size={22} stroke="#8a8a9a" sw={2.2}/>
                </button>
              </div>

              {/* Portada grande */}
              <div style={{flex:"0 1 auto",display:"flex",alignItems:"center",justifyContent:"center",margin:"14px 0 22px"}}>
                {playingCover
                  ? <img src={playingCover} alt="" style={{width:"100%",maxWidth:330,aspectRatio:"1",borderRadius:16,objectFit:"cover",boxShadow:isPlaying?"0 22px 60px rgba(0,0,0,0.65)":"0 12px 34px rgba(0,0,0,0.5)",transform:isPlaying?"scale(1)":"scale(0.9)",transition:"transform 0.4s cubic-bezier(0.32,0.72,0,1), box-shadow 0.4s"}}/>
                  : <div style={{width:"100%",maxWidth:330,aspectRatio:"1",borderRadius:16,background:"linear-gradient(135deg,#1a1a2e,#2a2a3e)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 18px 50px rgba(0,0,0,0.55)"}}>
                      <Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={76} stroke="#3a3a4e" sw={1.2}/>
                    </div>}
              </div>

              {/* Título + artista */}
              <div style={{marginBottom:18,flexShrink:0}}>
                <div style={{color:"#fff",fontSize:"1.3em",fontWeight:700,lineHeight:1.25,marginBottom:5,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{playingTitle}</div>
                <div style={{color:"#a0a0b5",fontSize:"0.98em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingArtist}</div>
              </div>

              {/* Barra de progreso grande y arrastrable */}
              <div style={{flexShrink:0,marginBottom:6}}>
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:24,margin:"14px 0 20px",flexShrink:0}}>
                <button onClick={playPrev} title="Anterior"
                  style={{background:"none",border:"none",cursor:"pointer",padding:8,display:"flex"}}>
                  <Ico d={<><polygon points="19 20 9 12 19 4 19 20" fill="#e0e0ea" stroke="none"/><line x1="5" y1="5" x2="5" y2="19"/></>} size={30} stroke="#e0e0ea" sw={2.4}/>
                </button>

                <button
                  onClick={()=>{if(!playerRef.current||!playerReadyRef.current)return;if(isPlaying){playerRef.current.pauseVideo();setIsPlaying(false);}else{playerRef.current.playVideo();setIsPlaying(true);kickPlay();}}}
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:26,flexShrink:0,paddingBottom:6}}>
                <button onClick={()=>seekTo(Math.max(0,currentTime-15))} title="Retroceder 15s"
                  style={{background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></>} size={21} stroke="#8a8a9a" sw={2.2}/>
                </button>

                <button onClick={()=>{setShuffle(s=>!s);toast.info(!shuffle?"Aleatorio activado":"Aleatorio desactivado",2000);}} title="Aleatorio"
                  style={{background:"none",border:"none",cursor:"pointer",padding:7,display:"flex"}}>
                  <Ico d={<><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></>} size={21} stroke={shuffle?"#22c55e":"#8a8a9a"} sw={2.1}/>
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
          </div>
        </>
      )}
    </div>
  );
}
