#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   AURA · Guardián del túnel — el túnel se AUTO-CURA
   ─────────────────────────────────────────────────
   1. Arranca cloudflared (túnel gratis de trycloudflare)
   2. Lee la URL que le tocó (cambia en cada arranque)
   3. Se la avisa a Vercel (/api/tunel, protegido con tu token)
      → Vercel la guarda y TODAS las descargas usan la nueva
   4. Si cloudflared se muere, lo revive solo
   5. Re-avisa cada 10 minutos por si acaso

   Correr con launchd (com.aura.tunel.plist): así arranca solo
   cuando la Mac prende y revive si se cae.
   ═══════════════════════════════════════════════════════════════ */

const { spawn } = require("child_process");

/* launchd trae un PATH pelón: ahí no está cloudflared */
process.env.PATH = [process.env.PATH, "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"]
  .filter(Boolean).join(":");

const TOKEN = process.env.MUSICA_TOKEN || "12345";
const APP = (process.env.AURA_APP || "https://musica-libre.vercel.app").replace(/\/+$/, "");
const LOCAL = process.env.AURA_LOCAL || "http://localhost:8787";

let urlActual = "";

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

async function avisar() {
  if (!urlActual) return;
  try {
    const r = await fetch(`${APP}/api/tunel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlActual, token: TOKEN }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.ok) log("Vercel enterado:", urlActual);
    else log("Vercel no aceptó:", JSON.stringify(d));
  } catch (e) {
    log("no pude avisar a Vercel (reintento en 1 min):", String(e.message || "").slice(0, 60));
    setTimeout(avisar, 60 * 1000);
  }
}

function arrancarTunel() {
  log("arrancando cloudflared...");
  const p = spawn("cloudflared", ["tunnel", "--url", LOCAL, "--no-autoupdate"], { env: process.env });

  const leer = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== urlActual) {
      urlActual = m[0];
      log("URL del túnel:", urlActual);
      /* Esperamos 3s a que el túnel de verdad enrute antes de avisar
         (Vercel verifica /salud a través de él) */
      setTimeout(avisar, 3000);
    }
  };
  p.stdout.on("data", leer);
  p.stderr.on("data", leer);   // cloudflared imprime la URL por stderr

  p.on("exit", (code) => {
    log("cloudflared se murió (código", code + "), lo revivo en 5s");
    urlActual = "";
    setTimeout(arrancarTunel, 5000);
  });
  p.on("error", (e) => {
    log("no pude arrancar cloudflared:", e.message, "— reintento en 30s");
    setTimeout(arrancarTunel, 30 * 1000);
  });
}

arrancarTunel();
/* Re-aviso periódico: si Vercel perdió el dato o el primer aviso
   falló por red, esto lo repara solo. */
setInterval(avisar, 10 * 60 * 1000);
