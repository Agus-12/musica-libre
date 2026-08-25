from pathlib import Path
p = Path("app/profile/page.js")
t = p.read_text()
t = t.replace(
    "      unicos.sort((a, b) => b.saved_at - a.saved_at);\n",
    """      unicos.sort((a, b) => {
        const aOff = a.audio_url ? 1 : 0;
        const bOff = b.audio_url ? 1 : 0;
        if (aOff !== bOff) return aOff - bOff;
        return b.saved_at - a.saved_at;
      });
""",
    1,
)
t = t.replace(
    "    const p = playerRef.current;\n    if (!p) return;\n",
    """    const p = playerRef.current;
    if (!p || !playerReadyRef.current) {
      pendingRef.current = item;
      setPlayingKey(item.key); setPlayingTitle(item.title);
      setPlayingArtist(item.artist); setPlayingCover(item.cover_url);
      ensurePlayer();
      return;
    }
""",
    1,
)
t = t.replace(
    '<div id="yt-player-container" style={{position:"absolute",top:-9999,left:-9999,width:1,height:1,overflow:"hidden"}}/>',
    '<div id="yt-player-container" style={{position:"fixed",left:0,bottom:0,width:1,height:1,opacity:0.02,pointerEvents:"none",overflow:"hidden",zIndex:0}}/>',
    1,
)
p.write_text(t)
print("LISTO" if "aOff" in t and "opacity:0.02" in t else "FALLO")
