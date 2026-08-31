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

const { spawn, execFile } = require("child_process");

/* launchd trae un PATH pelón: ahí no está cloudflared */
process.env.PATH = [process.env.PATH, "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"]
  .filter(Boolean).join(":");

const TOKEN = process.env.MUSICA_TOKEN || "12345";
const APP = (process.env.AURA_APP || "https://musica-libre.vercel.app").replace(/\/+$/, "");
const LOCAL = process.env.AURA_LOCAL || "http://localhost:8787";

let urlActual = "";
let reintentoTimer = null;
let procesoTunel = null;
let fallosAviso = 0;

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

async function avisar() {
  if (!urlActual) return;
  clearTimeout(reintentoTimer);
  try {
    // En Monterey, el fetch de Node puede fallar por la cadena de
    // certificados aunque curl funcione. Usamos curl del sistema para
    // avisar a Vercel de forma más compatible.
    const payload = JSON.stringify({ url: urlActual, token: TOKEN });
    const salida = await new Promise((resolve, reject) => {
      execFile("/usr/bin/curl", ["-fsS", "-m", "20", "-X", "POST", "-H", "Content-Type: application/json", "--data", payload, `${APP}/api/tunel`], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || "curl falló").slice(0, 160)));
        resolve(String(stdout));
      });
    });
    const d = JSON.parse(salida);
    if (d.ok) { fallosAviso = 0; log("Vercel enterado:", urlActual); return; }
    /* Rechazado (p. ej. el DNS del túnel recién nacido aún no propaga
       y la verificación de /salud falló): reintentar en 45s, no en 10 min */
    fallosAviso++;
    log("Vercel no aceptó (reintento en 45s):", JSON.stringify(d));
    if (fallosAviso >= 3 && procesoTunel) {
      log("el túnel no responde tras 3 intentos; lo reinicio para obtener otra URL");
      fallosAviso = 0;
      try { procesoTunel.kill(); } catch {}
      return;
    }
    reintentoTimer = setTimeout(avisar, 45 * 1000);
  } catch (e) {
    fallosAviso++;
    log("no pude avisar a Vercel (reintento en 1 min):", String(e.message || "").slice(0, 60));
    if (fallosAviso >= 3 && procesoTunel) {
      log("el túnel no responde tras 3 intentos; lo reinicio para obtener otra URL");
      fallosAviso = 0;
      try { procesoTunel.kill(); } catch {}
      return;
    }
    reintentoTimer = setTimeout(avisar, 60 * 1000);
  }
}

function arrancarTunel() {
  log("arrancando cloudflared...");
  const p = spawn("cloudflared", ["tunnel", "--url", LOCAL, "--no-autoupdate", "--protocol", "http2", "--edge-ip-version", "4"], { env: process.env });
  procesoTunel = p;
  fallosAviso = 0;

  const leer = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== urlActual) {
      urlActual = m[0];
      log("URL del túnel:", urlActual);
      /* Esperamos 3s a que el túnel de verdad enrute antes de avisar
         (Vercel verifica /salud a través de él) */
      setTimeout(avisar, 10000);
    }
  };
  p.stdout.on("data", leer);
  p.stderr.on("data", leer);   // cloudflared imprime la URL por stderr

  p.on("exit", (code) => {
    if (procesoTunel === p) procesoTunel = null;
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
