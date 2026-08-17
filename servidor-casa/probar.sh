#!/bin/bash
# Diagnóstico del servidor AURA. Corrélo en la Mac: te dice
# exactamente qué anda y qué no.

echo ""
echo "  Diagnóstico de AURA"
echo "  ═══════════════════"
echo ""

ok=0; mal=0
chk(){ if eval "$2" >/dev/null 2>&1; then echo "  ✅ $1"; ok=$((ok+1)); else echo "  ❌ $1"; mal=$((mal+1)); fi; }

chk "yt-dlp instalado"  "command -v yt-dlp"
chk "node instalado"    "command -v node"
chk "ffmpeg instalado"  "command -v ffmpeg"

echo ""
if command -v yt-dlp >/dev/null 2>&1; then
  echo "  yt-dlp versión: $(yt-dlp --version 2>/dev/null)"
  # Avisar si tiene más de 60 días: es la causa #1 de fallos
  v=$(yt-dlp --version 2>/dev/null | tr -d '.')
  hoy=$(date +%Y%m%d)
  if [ -n "$v" ] && [ "$v" -lt "$((hoy - 200))" ]; then
    echo "  ⚠  Parece viejo. Actualizá:  brew upgrade yt-dlp"
  fi
fi

echo ""
echo "  Probando descarga real desde YouTube..."
tmp=$(mktemp -d)
if yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o "$tmp/t.%(ext)s" \
     --no-playlist --quiet --no-warnings \
     "https://www.youtube.com/watch?v=1ZJCDGUGc1o" 2>"$tmp/err"; then
  echo "  ✅ ¡FUNCIONA! Tu IP no está bloqueada."
  echo "     $(ls -lh $tmp | tail -1 | awk '{print $5}') descargados"
  ok=$((ok+1))
else
  err=$(head -c 200 "$tmp/err")
  if echo "$err" | grep -qi "bot\|sign in"; then
    echo "  ⚠  YouTube pide verificación en esta red."
    echo ""
    echo "     Solución (5 min): exportá las cookies de tu sesión."
    echo "     1. Instalá la extensión 'Get cookies.txt LOCALLY' en Chrome"
    echo "     2. Entrá a youtube.com logueado"
    echo "     3. Exportá y guardá como ~/aura-servidor/cookies.txt"
    echo "     4. Arrancá el servidor con MUSICA_COOKIES=~/aura-servidor/cookies.txt"
  else
    echo "  ❌ Falló: $err"
  fi
  mal=$((mal+1))
fi
rm -rf "$tmp"

echo ""
echo "  Probando el servidor local..."
if curl -s --max-time 5 http://localhost:8787/salud 2>/dev/null | grep -q '"ok":true'; then
  echo "  ✅ El servidor responde en el puerto 8787"
  curl -s --max-time 5 http://localhost:8787/salud | python3 -m json.tool 2>/dev/null | sed 's/^/     /'
  ok=$((ok+1))
else
  echo "  ⚠  No responde. ¿Lo arrancaste?  node servidor.js"
fi

echo ""
echo "  ─────────────────────────────"
echo "  $ok bien, $mal con problemas"
echo ""
