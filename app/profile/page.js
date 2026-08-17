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

function Ico({ d, size = 14, fill = "none", stroke = "currentColor", sw = 2 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw}>{d}</svg>;
}

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
  const [downloadedMusic, setDownloadedMusic] = useState([]);

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
      items.sort((a, b) => b.saved_at - a.saved_at);
      setDownloadedMusic(items);
    } catch { setDownloadedMusic([]); }
  }

  useEffect(() => { refreshDownloads(); }, [favorites]);
  useEffect(() => { loadYTAPI(); }, []);

  useEffect(() => {
    if (isPlaying && playerRef.current) {
      progressRef.current = setInterval(() => {
        try { const t = playerRef.current.getCurrentTime(); const d = playerRef.current.getDuration(); setCurrentTime(t||0); setDuration(d||0); setProgress(d>0?(t/d)*100:0); } catch {}
      }, 500);
    } else { if (progressRef.current) clearInterval(progressRef.current); }
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [isPlaying]);

  async function playDownloaded(item) {
    if (playingKey === item.key && playerRef.current) {
      try { const s = playerRef.current.getPlayerState(); if (s===1) { playerRef.current.pauseVideo(); setIsPlaying(false); return; } else { playerRef.current.playVideo(); setIsPlaying(true); return; } } catch {}
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
    if (playerRef.current) { try{playerRef.current.destroy();}catch{} playerRef.current=null; }
    setPlayingKey(item.key); setPlayingTitle(item.title); setPlayingArtist(item.artist); setPlayingCover(item.cover_url); setIsPlaying(false); setProgress(0); setCurrentTime(0); setDuration(0);
    await loadYTAPI();
    const c = document.getElementById("yt-player-container"); if(c) c.innerHTML="";
    try {
      playerRef.current = new window.YT.Player("yt-player-container", {
        videoId: item.video_id, height:"1", width:"1",
        playerVars: { autoplay:1, controls:0, disablekb:1, fs:0, modestbranding:1, rel:0, showinfo:0, iv_load_policy:3, playsinline:1 },
        events: {
          onReady: (e) => {
            e.target.playVideo(); setIsPlaying(true); setDuration(e.target.getDuration()||0);
            toast.success("Reproduciendo: "+item.title, 3000);
            if ("mediaSession" in navigator) {
              const as = item.cover_url ? "/api/proxy?url="+encodeURIComponent(item.cover_url) : "";
              try { navigator.mediaSession.metadata = new MediaMetadata({ title:item.title||"", artist:item.artist||"", album:"", artwork:as?[{src:as,sizes:"96x96",type:"image/jpeg"},{src:as,sizes:"256x256",type:"image/jpeg"},{src:as,sizes:"512x512",type:"image/jpeg"}]:[] }); } catch {}
              navigator.mediaSession.playbackState="playing";
              navigator.mediaSession.setActionHandler("play",()=>{if(playerRef.current)playerRef.current.playVideo();setIsPlaying(true);navigator.mediaSession.playbackState="playing";});
              navigator.mediaSession.setActionHandler("pause",()=>{if(playerRef.current)playerRef.current.pauseVideo();setIsPlaying(false);navigator.mediaSession.playbackState="paused";});
              try{navigator.mediaSession.setActionHandler("stop",()=>{if(playerRef.current)playerRef.current.stopVideo();setIsPlaying(false);navigator.mediaSession.playbackState="none";setPlayingKey(null);});}catch{}
              try{navigator.mediaSession.setActionHandler("nexttrack",null);}catch{}
              try{navigator.mediaSession.setActionHandler("previoustrack",null);}catch{}
            }
          },
          onStateChange: (e) => { if(e.data===0){setIsPlaying(false);setPlayingKey(null);} else if(e.data===1)setIsPlaying(true); else if(e.data===2)setIsPlaying(false); },
          onError: () => { toast.error("Error reproduciendo",3000); setPlayingKey(null); setIsPlaying(false); },
        },
      });
    } catch { toast.error("No se pudo crear el player",3000); setPlayingKey(null); }
  }

  function stopPlayback() {
    if(playerRef.current){try{playerRef.current.stopVideo();}catch{} try{playerRef.current.destroy();}catch{} playerRef.current=null;}
    setPlayingKey(null);setIsPlaying(false);setPlayingTitle("");setPlayingArtist("");setPlayingCover("");setProgress(0);
    if("mediaSession" in navigator){navigator.mediaSession.playbackState="none";navigator.mediaSession.metadata=null;}
  }

  async function reDownload(item) {
    setDownloadingItems(p=>({...p,[item.key]:true}));
    toast.info("Buscando: "+item.title,3000);
    try {
      const res = await fetch("/api/download-mp3?q="+encodeURIComponent((item.artist+" "+item.title).trim()||item.key));
      const data = await res.json();
      if(data.video_id){try{const s=JSON.parse(localStorage.getItem("ml_mp3")||"{}");s[item.key]={...s[item.key],video_id:data.video_id,saved_at:Date.now()};localStorage.setItem("ml_mp3",JSON.stringify(s));}catch{} toast.success("Encontrada: "+item.title,4000);refreshDownloads();}
      else toast.warning("No se encontro",4000);
    } catch { toast.error("Error buscando",3000); }
    setDownloadingItems(p=>({...p,[item.key]:false}));
  }

  async function deleteDownload(item) {
    try {
      const s=JSON.parse(localStorage.getItem("ml_mp3")||"{}");delete s[item.key];localStorage.setItem("ml_mp3",JSON.stringify(s));
      if(item.audio_url&&"caches" in window){try{const c=await caches.open("ml-saved-v1");await c.delete(item.audio_url);}catch{}}
      if(playingKey===item.key)stopPlayback();
      toast.success("Eliminada: "+item.title,3000);refreshDownloads();
    } catch {}
  }

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
    <div style={{maxWidth:900,margin:"0 auto",padding:20,paddingBottom:hp?90:20}}>
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
            <div style={{background:"#1a1a2e",borderRadius:12,border:"1px solid #2a2a3e",overflow:"hidden"}}>
              {downloadedMusic.map(item => {
                const cp = playingKey===item.key;
                const dl = downloadingItems[item.key];
                return (
                  <div key={item.key} onClick={()=>playDownloaded(item)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:"1px solid #2a2a3e",background:cp?"rgba(34,197,94,0.08)":"transparent",cursor:"pointer",transition:"background 0.2s"}}>
                    {/* Cover + play */}
                    <div style={{position:"relative",flexShrink:0}}>
                      <CoverImg url={item.cover_url} size={52} r={8}/>
                      <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:cp&&isPlaying?"rgba(34,197,94,0.9)":"rgba(0,0,0,0.65)",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
                        {cp&&isPlaying ? <Ico d={<><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></>} size={8} stroke="#fff" fill="#fff"/> : <Ico d={<polygon points="0,0 10,6 0,12"/>} size={8} stroke="#fff" fill="#fff"/>}
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

      {/* Now Playing Bar */}
      {hp && (
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(10,10,20,0.97)",borderTop:"1px solid #2a2a3e",padding:0,zIndex:9999,backdropFilter:"blur(16px)"}}>
          <div style={{height:3,background:"#1a1a2e",cursor:"pointer"}} onClick={e=>{if(!playerRef.current||!duration)return;const r=e.currentTarget.getBoundingClientRect();const p=(e.clientX-r.left)/r.width;playerRef.current.seekTo(p*duration,true);setProgress(p*100);}}>
            <div style={{height:"100%",background:"#22c55e",width:progress+"%",transition:"width 0.3s linear"}}/>
          </div>
          <div style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:12}}>
            {playingCover && <img src={playingCover} style={{width:44,height:44,borderRadius:8,objectFit:"cover",flexShrink:0,boxShadow:"0 2px 10px rgba(0,0,0,0.3)"}}/>}
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:"#22c55e",fontSize:"0.88em",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{playingTitle}</div>
              <div style={{color:"#888",fontSize:"0.75em"}}>{playingArtist} · {fmt(currentTime)} / {fmt(duration)}</div>
            </div>
            <button onClick={()=>{if(!playerRef.current)return;if(isPlaying){playerRef.current.pauseVideo();setIsPlaying(false);}else{playerRef.current.playVideo();setIsPlaying(true);}}} style={{background:isPlaying?"rgba(34,197,94,0.2)":"rgba(34,197,94,0.9)",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {isPlaying ? <Ico d={<><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></>} size={12} stroke="#22c55e" fill="#22c55e"/> : <Ico d={<polygon points="0,0 10,6 0,12"/>} size={12} stroke="#fff" fill="#fff"/>}
            </button>
            <button onClick={stopPlayback} style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:"50%",width:32,height:32,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <Ico d={<rect x="0" y="0" width="10" height="10" rx="2"/>} size={10} stroke="#ef4444" fill="#ef4444"/>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
