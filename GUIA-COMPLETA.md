# AURA — Guía completa desde cero

Todo lo que hay que hacer, en orden, sin dar nada por sabido.

**Tiempo:** ~30 minutos. **Costo:** $0.

---

## Índice

1. [Qué vas a armar](#1-qué-vas-a-armar)
2. [Subir los cambios a GitHub](#2-subir-los-cambios-a-github)
3. [Preparar la Mac mini](#3-preparar-la-mac-mini)
4. [Sacar la Mac a internet](#4-sacar-la-mac-a-internet)
5. [Conectar la app con la Mac](#5-conectar-la-app-con-la-mac)
6. [Reinstalar la app en el iPhone](#6-reinstalar-la-app-en-el-iphone)
7. [Comprobar que todo anda](#7-comprobar-que-todo-anda)
8. [Que funcione solo para siempre](#8-que-funcione-solo-para-siempre)
9. [Problemas frecuentes](#9-problemas-frecuentes)

---

## 1. Qué vas a armar

```
   iPhone                Vercel                Mac mini            YouTube
  (la app)  ──────►  (sirve la web)  ──────►  (baja audio)  ──────►
                                                    │
                                              guarda los MP3
```

**Por qué hace falta la Mac:** Vercel no puede bajar de YouTube. Bloquea las
IPs de datacenter con el error *"Sign in to confirm you're not a bot"*. Tu Mac
usa la IP de tu casa, que no está bloqueada.

**Si la Mac se apaga, la app NO se rompe:** vuelve a reproducir por YouTube
como siempre. Lo único que perdés es guardar canciones nuevas para escuchar
sin internet.

---

## 2. Subir los cambios a GitHub

Todo el código está listo, pero **sin subir**. Decime "subilo" y lo hago, o
si preferís hacerlo vos:

```bash
git add -A
git commit -m "AURA: rebranding, fix del menú y servidor casero"
git push
```

Después mirá en **vercel.com → Deployments** que aparezca un build nuevo.

> ⚠️ Ya nos pasó que Vercel **no** despliega solo (el webhook falló). Si tras
> 3 minutos no aparece nada, entrá al último deploy → menú **⋯** → **Redeploy**.

**Verificá que desplegó** abriendo esto en el navegador:

```
https://TU-APP.vercel.app/manifest.json
```

Tiene que decir `"name": "AURA"`. Si dice "Música Libre", todavía no salió.

---

## 3. Preparar la Mac mini

Abrí la **Terminal** (Cmd+Espacio → escribí "Terminal").

### 3.1 Instalar yt-dlp

Es un archivo único, no necesita nada más:

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

> **Mac con Apple Silicon (M1/M2/M3/M4):** el mismo comando sirve, pero si
> preferís Homebrew, `brew install yt-dlp` también funciona.

Si macOS lo bloquea con un aviso de seguridad:

```bash
sudo xattr -d com.apple.quarantine /usr/local/bin/yt-dlp
```

### 3.2 Instalar Node

Bajá el instalador oficial y hacé doble clic:

**https://nodejs.org/dist/v24.19.0/node-v24.19.0.pkg**

Ese `.pkg` es para **Intel**. Si tu Mac es Apple Silicon, usá
`node-v24.19.0-arm64.pkg` de la misma carpeta.

Después abrí una Terminal **nueva** (importante) y comprobá que los dos
respondan:

```bash
yt-dlp --version    # ej: 2026.07.04
node --version      # ej: v24.19.0
```

> **¿Y ffmpeg?** No hace falta. El servidor baja el audio ya listo (`.m4a`)
> y no lo convierte, así que ffmpeg nunca se usa.

> **¿Por qué no Homebrew?** En macOS 13 y anteriores con procesador Intel,
> Homebrew ya no tiene paquetes precompilados: intenta compilar todo desde
> cero (LLVM, Rust, Python…), tarda horas y suele fallar. Los binarios
> oficiales de arriba tardan dos minutos.

### 3.3 Crear la carpeta y copiar el servidor

```bash
mkdir -p ~/aura-servidor
```

Copiá ahí el archivo **`servidor-casa/servidor.js`** del repo. Si tenés el
proyecto clonado en la Mac:

```bash
cp ~/ruta/al/repo/servidor-casa/servidor.js ~/aura-servidor/
```

Si no, bajalo directo de GitHub (una vez subido), junto con el script de
diagnóstico:

```bash
cd ~/aura-servidor
curl -O https://raw.githubusercontent.com/Agus-12/musica-libre/main/servidor-casa/servidor.js
curl -O https://raw.githubusercontent.com/Agus-12/musica-libre/main/servidor-casa/probar.sh
```

### 3.4 Generar tu clave

Sirve para que nadie más use tu Mac para bajar cosas:

```bash
openssl rand -hex 16
```

Te da algo como `4f8a2c9e1b7d3a6f5e8c2b9d4a7f1e3c`.
**Copiala y guardala** — la vas a usar 3 veces.

### 3.5 Probarlo

```bash
cd ~/aura-servidor
MUSICA_TOKEN=TU_CLAVE node servidor.js
```

Deberías ver:

```
  🎵 Servidor de Música Libre andando
  Puerto  : 8787
  Protegido con token: sí
```

**Dejá esa ventana abierta.** Abrí **otra** pestaña de Terminal (Cmd+T) y probá:

```bash
curl http://localhost:8787/salud
```

Tiene que responder algo así:

```json
{"ok":true,"ytdlp":true,"version":"2026.07.04","protegido":true}
```

> `"ytdlp": true` es la parte importante. Si dice `false`, yt-dlp no está
> instalado o no está en el PATH.

### 3.6 La prueba de fuego: bajar una canción

Hay un script que revisa todo de una:

```bash
cd ~/aura-servidor
bash probar.sh
```

Te dice qué falta y, si YouTube bloquea, cómo resolverlo.

O probalo a mano:

```bash
curl "http://localhost:8787/resolver?q=bad+bunny+titi+me+pregunto&token=TU_CLAVE"
```

Tarda 10-30 segundos. Si responde:

```json
{"ok":true,"audio_path":"/audio/xxxx.m4a","bytes":4567890,"tipo":"audio/mp4"}
```

🎉 **Funcionó.** Tu Mac puede bajar de YouTube. Seguí al paso 4.

---

### 3.7 Si dice "Sign in to confirm you're not a bot"

**No entres en pánico y no cambies de plan: la Mac sigue siendo la solución
correcta.** Esto se arregla en 5 minutos y queda andando para siempre.

El servidor ya reintenta solo con 4 clientes distintos de YouTube (web,
android, ios, tv). Si los cuatro fallan, es que YouTube quiere ver una
sesión iniciada. Se la damos:

**Exportar tus cookies de YouTube**

1. En Chrome (o Firefox) instalá la extensión **"Get cookies.txt LOCALLY"**
2. Entrá a **youtube.com** con tu cuenta iniciada
3. Clic en la extensión → **Export** → guardá el archivo
4. Movelo a la Mac como `~/aura-servidor/cookies.txt`

**Arrancá el servidor usándolas:**

```bash
MUSICA_TOKEN=TU_CLAVE MUSICA_COOKIES=~/aura-servidor/cookies.txt node servidor.js
```

Probá de nuevo el `curl` de arriba. Con cookies funciona prácticamente
siempre, porque YouTube te ve como el usuario que sos.

> **Consejo:** usá una cuenta secundaria de Google, no la principal. Y no
> compartas ese archivo: es tu sesión.
>
> Las cookies duran meses. Cuando caduquen, repetís la exportación.

Cuando lo dejes automático (paso 8.1), acordate de agregar `MUSICA_COOKIES`
en el plist.

---

## 4. Sacar la Mac a internet

Vercel necesita poder llegar a tu Mac. **No abras puertos en el router** —
usá un túnel de Cloudflare, que es gratis y más seguro.

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz -o /tmp/cf.tgz
tar -xzf /tmp/cf.tgz -C /tmp
sudo mv /tmp/cloudflared /usr/local/bin/
sudo chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

> Ese `.tgz` es para **Intel**. En Apple Silicon cambiá `amd64` por `arm64`,
> o usá `brew install cloudflared`.

### Opción A — Rápida (para probar hoy)

```bash
cloudflared tunnel --url http://localhost:8787
```

Entre el texto vas a ver una dirección:

```
https://algo-random-cosas.trycloudflare.com
```

**Copiala.** Dejá esa ventana abierta.

> ⚠️ Esta URL **cambia cada vez que reiniciás el túnel**. Si se corta la luz,
> vas a tener que actualizarla en Vercel. Para algo permanente, mirá la
> opción B.

### Opción B — Estable (recomendada si la Mac va a estar 24/7)

Necesitás un dominio en Cloudflare (el servicio es gratis, el dominio se
paga ~$10/año). La URL nunca cambia:

```bash
cloudflared tunnel login
cloudflared tunnel create aura
cloudflared tunnel route dns aura aura.TUDOMINIO.com
sudo cloudflared service install
```

### Comprobar el túnel

Desde **cualquier** dispositivo (incluso el celular con datos móviles):

```
https://TU-URL-DEL-TUNEL/salud
```

Si ves el JSON con `"ytdlp":true`, el túnel anda.

---

## 5. Conectar la app con la Mac

En **vercel.com** → tu proyecto → **Settings** → **Environment Variables**.

Agregá estas dos:

| Name | Value |
|---|---|
| `MUSICA_SERVER` | `https://tu-url-del-tunel.trycloudflare.com` |
| `MUSICA_TOKEN` | la clave del paso 3.4 |

> **Sin barra final** en la URL. `https://algo.com` ✅ · `https://algo.com/` ❌
>
> Marcá los tres entornos (Production, Preview, Development).

**Importante:** las variables solo se aplican en un deploy nuevo. Andá a
**Deployments** → último → **⋯** → **Redeploy**.

---

## 6. Reinstalar la app en el iPhone

Como cambió el nombre y el icono, **hay que reinstalarla**. iOS cachea el
icono muy agresivamente y si no lo hacés vas a seguir viendo el viejo.

1. Mantené presionado el icono de "Música Libre" → **Eliminar app**
2. Abrí **Safari** → entrá a `https://TU-APP.vercel.app`
3. Botón **Compartir** (el cuadradito con la flecha)
4. **Agregar a pantalla de inicio**
5. Debería decir **AURA** con el logo nuevo

> Tiene que ser **Safari**. Desde Chrome en iPhone no se puede instalar como app.

---

## 7. Comprobar que todo anda

Hacelo en este orden. Si algo falla, sabés exactamente dónde.

| # | Qué probás | Cómo | Esperado |
|---|---|---|---|
| 1 | La Mac responde | `curl http://localhost:8787/salud` | `"ytdlp":true` |
| 2 | El túnel anda | Abrir `https://TU-TUNEL/salud` en el celu | el mismo JSON |
| 3 | Vercel desplegó | Abrir `TU-APP.vercel.app/manifest.json` | `"name":"AURA"` |
| 4 | La app ve la Mac | ↓ ver abajo | `"offline":true` |
| 5 | Se guarda de verdad | Descargar una canción en la app | dice *"Guardada sin internet"* |
| 6 | Suena sin internet | Modo avión → Perfil → Descargadas → play | suena |

**Para el paso 4**, abrí esto en el navegador:

```
https://TU-APP.vercel.app/api/download-mp3?q=bad+bunny+titi+me+pregunto
```

Buscá estas dos líneas en la respuesta:

```json
"offline": true,
"fuente": "casa"
```

- `"fuente": "casa"` → **todo bien**, está usando tu Mac
- `"fuente": null` y `"offline": false` → Vercel no llega a la Mac
  (revisá el paso 5, y que el túnel siga abierto)

**El paso 6 es el definitivo.** Si suena en modo avión, está todo funcionando.

---

## 8. Que funcione solo para siempre

### 8.1 Que el servidor arranque solo

Creá el archivo `~/Library/LaunchAgents/com.aura.servidor.plist`:

```bash
nano ~/Library/LaunchAgents/com.aura.servidor.plist
```

Pegá esto (cambiá `TU_USUARIO` y `TU_CLAVE`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.aura.servidor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/TU_USUARIO/aura-servidor/servidor.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MUSICA_TOKEN</key><string>TU_CLAVE</string>
    <key>MUSICA_MAX_GB</key><string>10</string>
    <!-- Solo si necesitaste cookies (paso 3.7). Ruta COMPLETA, sin ~ -->
    <key>MUSICA_COOKIES</key><string>/Users/TU_USUARIO/aura-servidor/cookies.txt</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/aura-servidor.log</string>
  <key>StandardOutPath</key><string>/tmp/aura-servidor.log</string>
</dict>
</plist>
```

Guardá con `Ctrl+O`, Enter, `Ctrl+X`. Después:

```bash
launchctl load ~/Library/LaunchAgents/com.aura.servidor.plist
```

`KeepAlive` hace que si el servidor se cae, macOS lo reviva solo.

> **Comprobá la ruta de node antes de guardar:** corré `which node` y usá
> exactamente lo que devuelva. Con el instalador `.pkg` o en Mac Intel es
> `/usr/local/bin/node`; con Homebrew en Apple Silicon es
> `/opt/homebrew/bin/node`.

### 8.2 Que el túnel arranque solo

**Este es el que más se olvida.** De nada sirve que reviva el servidor si el
túnel no.

Con la opción B del paso 4 ya quedó resuelto (`cloudflared service install`).

Si usás `trycloudflare`, no hay forma prolija: tras cada reinicio vas a tener
que levantarlo a mano **y actualizar la URL en Vercel**.

### 8.3 Que yt-dlp se mantenga al día

**Esto es lo que más se rompe.** YouTube cambia seguido y un yt-dlp viejo deja
de funcionar de golpe (el síntoma: `HTTP Error 403: Forbidden` en todo).

> **Lección aprendida (2026-08):** el canal *stable* puede tardar semanas en
> traer el fix. El canal **nightly** sale casi a diario y fue lo que resolvió
> el 403. Usá nightly.

```bash
crontab -e
```

Agregá (todos los días a las 4 AM):

```
0 4 * * * /usr/local/bin/yt-dlp --update-to nightly >/dev/null 2>&1
```

(Si lo instalaste con Homebrew, usá `brew upgrade yt-dlp` en su lugar.)

### 8.4 Que la Mac no duerma

Si ya la tenés configurada, saltealo. Lo importante es que **el disco tampoco
duerma**, no solo la pantalla:

```bash
sudo pmset -a sleep 0 disksleep 0 womp 1
```

`womp 1` la despierta si llega tráfico de red. Ver cómo está: `pmset -g`

### 8.5 Comprobar después de un reinicio

```bash
curl "https://TU-URL-DEL-TUNEL/salud"
```

---

## 9. Problemas frecuentes

### "Sign in to confirm you're not a bot"

Ver el [paso 3.7](#37-si-dice-sign-in-to-confirm-youre-not-a-bot) — se
resuelve con cookies en 5 minutos.

Resumen por orden de efectividad:

1. **Cookies** (paso 3.7) — funciona casi siempre
2. **Actualizar yt-dlp**: `sudo yt-dlp -U`  (con Homebrew: `brew upgrade yt-dlp`)
3. **Bajar el ritmo**: subí `MUSICA_PAUSA_MS` a `10000` (10 s entre
   descargas). Pedir muchas seguidas es lo que dispara el bloqueo.

El servidor ya prueba solo 4 clientes distintos antes de rendirse, así que
si llegás a ver este error es que hacen falta las cookies.

### La app dice `"fuente": null`

Vercel no llega a la Mac. Revisá en orden:

- ¿El túnel sigue abierto? Probá `https://TU-TUNEL/salud` desde el celular
- ¿La URL en Vercel es exacta y **sin barra final**?
- ¿Hiciste **Redeploy** después de agregar las variables?
- ¿La URL de `trycloudflare` cambió? Pasa en cada reinicio

### La canción se descarga pero no suena sin internet

- Fijate que al descargar diga **"Guardada sin internet"**, no "Listo para
  reproducir". Si dice lo segundo, no se guardó el archivo (mirá el punto
  anterior)
- Cerrá la app por completo y volvé a abrirla, para que tome el service
  worker nuevo

### Cambié algo y el celular sigue igual

Ahora la app se actualiza sola y te avisa con una barra verde arriba.
**Pero esta primera vez** todavía tenés el service worker viejo: cerrá la app
del todo (deslizándola del multitarea) y volvé a abrirla. De ahí en adelante
es automático.

### El icono viejo sigue apareciendo

iOS lo cachea fuerte. Hay que borrar la app de la pantalla de inicio y
volver a agregarla (paso 6).

### Ver qué está pasando en el servidor

```bash
tail -f /tmp/aura-servidor.log
```

### Reiniciar el servidor

```bash
launchctl unload ~/Library/LaunchAgents/com.aura.servidor.plist
launchctl load ~/Library/LaunchAgents/com.aura.servidor.plist
```

---

## Referencia rápida

**Variables del servidor (Mac)**

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto | `8787` |
| `MUSICA_DIR` | Dónde guarda los audios | `~/musica-libre-audio` |
| `MUSICA_TOKEN` | Clave de acceso | vacío (sin protección) |
| `MUSICA_MAX_GB` | Límite de disco; borra lo más viejo | `5` |
| `MUSICA_COOKIES` | Cookies de YouTube (ruta completa) | — |
| `MUSICA_PAUSA_MS` | Pausa mínima entre descargas | `4000` |

**Variables de la app (Vercel)**

| Variable | Para qué |
|---|---|
| `MUSICA_SERVER` | URL del túnel, sin barra final |
| `MUSICA_TOKEN` | La misma clave del servidor |

**Rutas del servidor**

| Ruta | Para qué | ¿Pide token? |
|---|---|---|
| `/salud` | Ver si está vivo | no |
| `/resolver?v=ID` o `?q=texto` | Bajar y obtener la ruta | sí |
| `/audio/<archivo>` | El MP3, con soporte de Range | sí |
| `/borrar?v=ID` o `?q=texto` | Borra de la Mac el audio de una canción (lo llama la app al sacarla de Descargadas) | sí |

---

## Sobre el uso

Bajar música con derechos de autor puede ir contra los términos de YouTube y
la ley de copyright, según el país. Esto es para uso personal con contenido
que tengas derecho a usar. La responsabilidad es tuya.
