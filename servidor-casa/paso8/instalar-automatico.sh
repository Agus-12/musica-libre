#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  AURA — Paso 8 · Instalador automático para la Mac mini
#  (esto corre SOLO en macOS)
#
#  Hace TODO el paso 8 de la guía en un solo comando:
#   8.1  El servidor arranca solo al prender la Mac  (LaunchAgent)
#   8.2  El túnel arranca solo                       (LaunchAgent)
#   8.3  yt-dlp se actualiza solo (lunes 4 AM)       (cron)
#   8.4  La Mac no se duerme                         (pmset)
#   8.5  Chequeo final
#
#  Uso:   bash instalar-automatico.sh
#  ═══════════════════════════════════════════════════════════════

ROJO='\033[0;31m'; VERDE='\033[0;32m'; AMAR='\033[0;33m'; AZUL='\033[0;36m'; SIN='\033[0m'
ok()  { echo -e "  ${VERDE}✅ $1${SIN}"; }
mal() { echo -e "  ${ROJO}❌ $1${SIN}"; }
avis(){ echo -e "  ${AMAR}⚠️  $1${SIN}"; }
tit() { echo -e "\n${AZUL}──────────────────────────────────────────────${SIN}"; echo -e "${AZUL} $1${SIN}"; }

echo ""
echo -e "  ${AZUL}🎵  AURA — Paso 8 · Instalador automático${SIN}"
echo "  ═════════════════════════════════════════════════════"

# ── ¿Estamos en la Mac? ────────────────────────────────────────
if [ "$(uname)" != "Darwin" ]; then
  mal "Esto corre en la Mac, no acá. Pasá el archivo a la Mac (AirDrop, USB, WhatsApp…) y ejecutalo allá."
  exit 1
fi

USUARIO=$(whoami)
AVISOS=""

# ── 8.0 · Estado actual ────────────────────────────────────────
tit "8.0 · Estado actual de la Mac"

NODE_BIN=$(command -v node || true)
if [ -n "$NODE_BIN" ]; then ok "node encontrado: $NODE_BIN"; else mal "node NO está en el PATH (¿lo instalaste? — paso 3.2)"; fi

YTDLP_BIN=$(command -v yt-dlp || true)
if [ -n "$YTDLP_BIN" ]; then ok "yt-dlp encontrado: $YTDLP_BIN"; else mal "yt-dlp NO está en el PATH (paso 3.1)"; fi

CLOUDFLARED_BIN=$(command -v cloudflared || true)
if [ -n "$CLOUDFLARED_BIN" ]; then ok "cloudflared encontrado: $CLOUDFLARED_BIN"; else mal "cloudflared NO está en el PATH (paso 4)"; fi

# ── Datos que pedimos ──────────────────────────────────────────
tit "Datos para la configuración"

echo -n "  Escribí la MUSICA_TOKEN (la clave del paso 3.4): "
read -s CLAVE
echo ""
if [ -z "$CLAVE" ] && [ -n "${MUSICA_TOKEN:-}" ]; then
  CLAVE="$MUSICA_TOKEN"
  avis "Usé la MUSICA_TOKEN que ya estaba en la terminal."
fi
if [ -z "$CLAVE" ]; then
  avis "Sin token el servidor queda SIN protección. Mejor poné la clave."
fi

echo -n "  Límite de disco en GB (Enter = 10): "
read MAX_GB
MAX_GB="${MAX_GB:-10}"

COOKIES_XML=""
if [ -f "$HOME/aura-servidor/cookies.txt" ]; then
  ok "Encontré $HOME/aura-servidor/cookies.txt — el servidor usará tus cookies de YouTube."
  COOKIES_XML="    <key>MUSICA_COOKIES</key><string>$HOME/aura-servidor/cookies.txt</string>"
else
  avis "No hay cookies.txt. Si YouTube te bloqueaba, mirá el paso 3.7 de la guía."
fi

# ── 8.1 · Servidor automático (LaunchAgent) ────────────────────
tit "8.1 · El servidor arranca solo"

if [ ! -f "$HOME/aura-servidor/servidor.js" ]; then
  mal "No encuentro $HOME/aura-servidor/servidor.js"
  echo -n "  ¿Lo descargo de GitHub? [s/N]: "
  read R0
  if [ "$R0" = "s" ] || [ "$R0" = "S" ]; then
    mkdir -p "$HOME/aura-servidor"
    curl -fsSL "https://raw.githubusercontent.com/Agus-12/musica-libre/main/servidor-casa/servidor.js" -o "$HOME/aura-servidor/servidor.js" && ok "servidor.js descargado" || mal "No se pudo descargar (¿internet?)"
    curl -fsSL "https://raw.githubusercontent.com/Agus-12/musica-libre/main/servidor-casa/probar.sh" -o "$HOME/aura-servidor/probar.sh" 2>/dev/null || true
  fi
fi

PLIST_SERVIDOR="$HOME/Library/LaunchAgents/com.aura.servidor.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_SERVIDOR" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.aura.servidor</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$HOME/aura-servidor/servidor.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MUSICA_TOKEN</key><string>$CLAVE</string>
    <key>MUSICA_MAX_GB</key><string>$MAX_GB</string>
$COOKIES_XML
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/aura-servidor.log</string>
  <key>StandardOutPath</key><string>/tmp/aura-servidor.log</string>
</dict>
</plist>
EOF
ok "plist creado: $PLIST_SERVIDOR"
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST_SERVIDOR" >/dev/null 2>&1 && ok "El plist es válido (plutil)" || mal "El plist no es válido — revisá que las rutas no tengan caracteres raros."
fi

# Si hay un servidor corriendo a mano (Terminal), avisamos para no chocar con el puerto
PROCEDER_8_1="si"
PUERTO_OCUPADO=$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$PUERTO_OCUPADO" ]; then
  avis "El puerto 8787 está ocupado: tenés el servidor corriendo A MANO en otra ventana de Terminal."
  echo -n "  ¿Cierro ese servidor manual y activo el automático? [s/N]: "
  read R1
  if [ "$R1" = "s" ] || [ "$R1" = "S" ]; then
    kill "$PUERTO_OCUPADO" 2>/dev/null
    sleep 1
    ok "Servidor manual cerrado."
  else
    PROCEDER_8_1="no"
    avis "OK, no toco nada. El servidor automático queda creado pero SIN activar:"
    avis "  cerralo a mano cuando puedas y corré: launchctl load $PLIST_SERVIDOR"
  fi
fi

if [ "$PROCEDER_8_1" = "si" ]; then
  launchctl bootout gui/$(id -u) "$PLIST_SERVIDOR" 2>/dev/null
  if launchctl bootstrap gui/$(id -u) "$PLIST_SERVIDOR" 2>/dev/null; then
    ok "Servidor automático ACTIVADO."
  else
    launchctl unload "$PLIST_SERVIDOR" 2>/dev/null
    launchctl load "$PLIST_SERVIDOR" 2>/dev/null && ok "Servidor automático ACTIVADO." || mal "No se pudo activar. Probá a mano: launchctl load $PLIST_SERVIDOR"
  fi
fi

if launchctl list 2>/dev/null | grep -q "com.aura.servidor"; then
  ok "com.aura.servidor cargado en macOS (se levantará solo en cada inicio)."
else
  avis "com.aura.servidor todavía no aparece cargado."
fi

sleep 2
SALUD=$(curl -s --max-time 5 http://localhost:8787/salud 2>/dev/null || true)
if [ -n "$SALUD" ]; then
  ok "El servidor responde: $SALUD"
else
  avis "El servidor todavía no responde (esperá unos segundos y probá: curl http://localhost:8787/salud)."
  avis "  Mirá el log con: tail -f /tmp/aura-servidor.log"
fi

# ── 8.2 · El túnel arranca solo ────────────────────────────────
tit "8.2 · El túnel arranca solo"

TUNEL_NAMED="no"
if [ -n "$CLOUDFLARED_BIN" ] && ls "$HOME"/.cloudflared/*.json >/dev/null 2>&1; then
  TUNEL_NAMED="si"
fi

if [ "$TUNEL_NAMED" = "si" ]; then
  # Opción B: túnel con dominio propio. La URL nunca cambia.
  ok "Detecté un túnel con dominio propio (Opción B)."
  if [ -f "/Library/LaunchDaemons/com.cloudflare.cloudflared.plist" ]; then
    ok "El servicio de cloudflared está instalado como servicio del sistema."
    if pgrep -f cloudflared >/dev/null 2>&1; then
      ok "cloudflared está corriendo."
    else
      avis "cloudflared no está corriendo ahora. Probá: sudo launchctl load /Library/LaunchDaemons/com.cloudflare.cloudflared.plist"
    fi
  else
    avis "Falta instalar el servicio del túnel. Corré en la Terminal:"
    avis "  sudo cloudflared service install"
  fi
else
  # Opción A: trycloudflare. URL temporal, cambia en cada reinicio.
  avis "No detecté dominio propio → asumo Opción A (trycloudflare, URL temporal)."
  avis "  La URL CAMBIA en cada reinicio de la Mac; tras reiniciar hay que actualizarla en Vercel (abajo te digo cómo)."

  PLIST_TUNEL="$HOME/Library/LaunchAgents/com.aura.tunel.plist"
  cat > "$PLIST_TUNEL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.aura.tunel</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CLOUDFLARED_BIN</string>
    <string>tunnel</string>
    <string>--url</string>
    <string>http://localhost:8787</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/aura-tunel.log</string>
  <key>StandardOutPath</key><string>/tmp/aura-tunel.log</string>
</dict>
</plist>
EOF
  ok "plist del túnel creado: $PLIST_TUNEL"

  CARGAR_TUNEL="si"
  if launchctl list 2>/dev/null | grep -q "com.aura.tunel"; then
    ok "El túnel automático ya estaba activo."
    CARGAR_TUNEL="no"
  elif pgrep -f "cloudflared tunnel" >/dev/null 2>&1; then
    avis "Hay un cloudflared corriendo A MANO en otra ventana de Terminal."
    echo -n "  ¿Lo cierro para que arranque el automático? [s/N]: "
    read R2
    if [ "$R2" = "s" ] || [ "$R2" = "S" ]; then
      pkill -f "cloudflared tunnel" 2>/dev/null
      sleep 1
      ok "Túnel manual cerrado."
    else
      CARGAR_TUNEL="no"
      avis "OK, dejo el tuyo. El automático se activa cuando cierres el manual o al reiniciar la Mac."
    fi
  fi

  if [ "$CARGAR_TUNEL" = "si" ]; then
    launchctl bootout gui/$(id -u) "$PLIST_TUNEL" 2>/dev/null
    if launchctl bootstrap gui/$(id -u) "$PLIST_TUNEL" 2>/dev/null; then
      ok "Túnel automático ACTIVADO."
    else
      launchctl unload "$PLIST_TUNEL" 2>/dev/null
      launchctl load "$PLIST_TUNEL" 2>/dev/null && ok "Túnel automático ACTIVADO." || mal "No se pudo activar el túnel. Probá a mano: launchctl load $PLIST_TUNEL"
    fi
  fi

  # Esperamos a que aparezca la URL nueva en el log
  URL_TUNEL=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    URL_TUNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/aura-tunel.log 2>/dev/null | tail -1)
    [ -n "$URL_TUNEL" ] && break
    sleep 1
  done
  if [ -n "$URL_TUNEL" ]; then
    ok "Tu URL actual del túnel: $URL_TUNEL"
    avis "⚡ Si esta URL cambió, actualizala en Vercel (Settings → Environment Variables → MUSICA_SERVER) y hacé Redeploy."
  else
    avis "La URL todavía no aparece en el log. Esperá 10 s y corré:"
    avis "  grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' /tmp/aura-tunel.log | tail -1"
  fi
fi

# ── 8.3 · yt-dlp se actualiza solo (cron) ─────────────────────
tit "8.3 · yt-dlp se mantiene al día (lunes 4 AM)"

if [ -n "$YTDLP_BIN" ]; then
  CASO_BREW="no"
  if command -v brew >/dev/null 2>&1; then
    case "$YTDLP_BIN" in
      /opt/homebrew/*|/usr/local/Cellar/*) CASO_BREW="si";;
    esac
  fi
  CRON_CMD="$YTDLP_BIN -U >/dev/null 2>&1"
  [ "$CASO_BREW" = "si" ] && CRON_CMD="brew upgrade yt-dlp >/dev/null 2>&1"

  if crontab -l 2>/dev/null | grep -q "yt-dlp"; then
    ok "El cron de yt-dlp ya existía — no toqué nada."
  else
    (crontab -l 2>/dev/null; echo "0 4 * * 1 $CRON_CMD") | crontab -
    ok "Agendado: todos los lunes a las 4 AM → $CRON_CMD"
  fi
else
  avis "Sin yt-dlp no puedo agendar la actualización."
fi

# ── 8.4 · La Mac no se duerme ──────────────────────────────────
tit "8.4 · La Mac no se duerme (pmset)"

echo "  Te va a pedir tu contraseña de administrador (la de tu Mac)."
if sudo pmset -a sleep 0 disksleep 0 womp 1 2>/dev/null; then
  ok "Aplicado: nunca duerme, el disco tampoco, y despierta si llega tráfico de red (womp 1)."
else
  mal "No se pudo aplicar pmset (¿contraseña incorrecta?). Podés correrlo a mano:"
  mal "  sudo pmset -a sleep 0 disksleep 0 womp 1"
fi
echo ""
echo "  Estado actual:"
pmset -g 2>/dev/null | grep -E "sleep|disksleep|womp" | sed 's/^/    /' || true

# ── 8.5 · Chequeo final ────────────────────────────────────────
tit "8.5 · Chequeo final"

echo ""
echo "  ✅ Listo. Resumen de lo que quedó activo:"
launchctl list 2>/dev/null | grep -q "com.aura.servidor" && echo "   · Servidor:  com.aura.servidor   (arranca solo, se revive solo)"
launchctl list 2>/dev/null | grep -q "com.aura.tunel" && echo "   · Túnel:     com.aura.tunel      (arranca solo, se revive solo)"
crontab -l 2>/dev/null | grep -q "yt-dlp" && echo "   · yt-dlp:    actualización semanal (lunes 4 AM)"
pmset -g 2>/dev/null | grep -q "sleep[[:space:]]*0" && echo "   · Energía:    la Mac no se duerme"
echo ""
echo "  Comandos útiles:"
echo "   · Ver el log del servidor:   tail -f /tmp/aura-servidor.log"
echo "   · Ver el log del túnel:      tail -f /tmp/aura-tunel.log"
echo "   · Reiniciar el servidor:     launchctl unload ~/Library/LaunchAgents/com.aura.servidor.plist && launchctl load ~/Library/LaunchAgents/com.aura.servidor.plist"
echo "   · Saber la URL del túnel:    grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' /tmp/aura-tunel.log | tail -1"
echo ""
echo "  Después de un REINICIO de la Mac, comprobá:"
echo "   · curl http://localhost:8787/salud   (servidor)"
if [ "$TUNEL_NAMED" = "si" ]; then
  echo "   · Abrí tu URL fija del túnel/salud en el celular (no cambia)."
else
  echo "   · Corré el comando de arriba para ver la URL NUEVA y actualizala en Vercel."
  echo "     Luego: Vercel → Deployments → último → ⋯ → Redeploy."
fi
echo "   · En la app: Modo avión → Perfil → Descargadas → play. 🎧"
echo ""
