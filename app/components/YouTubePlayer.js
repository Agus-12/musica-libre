"use client";
import { useEffect, useRef, useState } from "react";

// YouTube IFrame API player for full song playback
// Loads the API once, creates a hidden player, and controls it

let ytApiLoaded = false;
let ytApiPromise = null;

function loadYouTubeAPI() {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  
  ytApiPromise = new Promise((resolve) => {
    // This function is called by the YouTube IFrame API when it's ready
    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      resolve();
    };
    
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    
    // Timeout fallback
    setTimeout(() => {
      if (!ytApiLoaded) {
        ytApiLoaded = true;
        resolve();
      }
    }, 5000);
  });
  
  return ytApiPromise;
}

export default function YouTubePlayer({ videoId, title, artist, coverUrl, onEnded, onReady, onError }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerState, setPlayerState] = useState(-1); // -1 = unstarted
  const progressInterval = useRef(null);

  useEffect(() => {
    if (!videoId) return;

    let mounted = true;

    async function initPlayer() {
      await loadYouTubeAPI();

      if (!mounted || !containerRef.current) return;

      // Destroy old player
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }

      // Create new player
      try {
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          height: "1", // Minimal size - we control playback ourselves
          width: "1",
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3, // No annotations
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (!mounted) return;
              setIsReady(true);
              setDuration(event.target.getDuration());
              if (onReady) onReady();
              
              // Auto-play
              event.target.playVideo();
              setIsPlaying(true);
              
              // Set Media Session
              if ("mediaSession" in navigator) {
                const artworkSrc = coverUrl ? "/api/proxy?url=" + encodeURIComponent(coverUrl) : "";
                try {
                  navigator.mediaSession.metadata = new MediaMetadata({
                    title: title || "Canción",
                    artist: artist || "",
                    album: "",
                    artwork: artworkSrc ? [
                      { src: artworkSrc, sizes: "96x96", type: "image/jpeg" },
                      { src: artworkSrc, sizes: "256x256", type: "image/jpeg" },
                      { src: artworkSrc, sizes: "512x512", type: "image/jpeg" },
                    ] : [],
                  });
                } catch {}
                navigator.mediaSession.playbackState = "playing";
                navigator.mediaSession.setActionHandler("play", () => {
                  if (playerRef.current) playerRef.current.playVideo();
                  navigator.mediaSession.playbackState = "playing";
                  setIsPlaying(true);
                });
                navigator.mediaSession.setActionHandler("pause", () => {
                  if (playerRef.current) playerRef.current.pauseVideo();
                  navigator.mediaSession.playbackState = "paused";
                  setIsPlaying(false);
                });
                try { navigator.mediaSession.setActionHandler("stop", () => {
                  if (playerRef.current) { playerRef.current.stopVideo(); }
                  navigator.mediaSession.playbackState = "none";
                  setIsPlaying(false);
                }); } catch {}
                try { navigator.mediaSession.setActionHandler("nexttrack", null); } catch {}
                try { navigator.mediaSession.setActionHandler("previoustrack", null); } catch {}
              }
              
              // Progress tracking
              if (progressInterval.current) clearInterval(progressInterval.current);
              progressInterval.current = setInterval(() => {
                if (playerRef.current && mounted) {
                  try {
                    setCurrentTime(playerRef.current.getCurrentTime());
                  } catch {}
                }
              }, 1000);
            },
            onStateChange: (event) => {
              if (!mounted) return;
              const state = event.data;
              setPlayerState(state);
              // YT.PlayerState: ENDED=0, PLAYING=1, PAUSED=2, BUFFERING=3, CUED=5
              if (state === 0) { // ENDED
                setIsPlaying(false);
                if (onEnded) onEnded();
                if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
                if (progressInterval.current) clearInterval(progressInterval.current);
              } else if (state === 1) { // PLAYING
                setIsPlaying(true);
                if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
              } else if (state === 2) { // PAUSED
                setIsPlaying(false);
                if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
              }
            },
            onError: (event) => {
              if (onError) onError(event.data);
            },
          },
        });
      } catch (e) {
        if (onError) onError(e.message);
      }
    }

    initPlayer();

    return () => {
      mounted = false;
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [videoId]);

  function togglePlay() {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  }

  function seekTo(time) {
    if (!playerRef.current) return;
    playerRef.current.seekTo(time, true);
  }

  function stop() {
    if (!playerRef.current) return;
    playerRef.current.stopVideo();
    setIsPlaying(false);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return {
    isReady,
    isPlaying,
    duration,
    currentTime,
    progress,
    playerState,
    togglePlay,
    seekTo,
    stop,
    playerElement: (
      <div ref={containerRef} style={{ position: "absolute", top: -9999, left: -9999, width: 1, height: 1, overflow: "hidden" }} />
    ),
  };
}
