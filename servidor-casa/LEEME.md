# Servidor de música en tu Mac mini

Esto hace que la descarga offline funcione **de verdad y gratis**.

## Por qué hace falta

Vercel no puede bajar audio de YouTube: bloquea las IPs de los datacenters
con el error *"Sign in to confirm you're not a bot"*. Tu Mac usa la IP de tu
casa, que **no** está bloqueada. Por eso el trabajo pesado lo hace ella.

```
Tu celular  →  Vercel (la app)  →  Tu Mac mini  →  YouTube
                                   (baja el audio y lo sirve)
```

Si la Mac está apagada, la app **no se rompe**: vuelve a reproducir por
YouTube como hasta ahora.

---

## Instalación (una sola vez, ~10 minutos)

### 1. Instalar yt-dlp

Abrí la Terminal en la Mac y pegá:

```bash
# Si no tenés Homebrew:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install yt-dlp ffmpeg node
```

Comprobá que quedó bien:

```bash
yt-dlp --version
```

### 2. Copiar el servidor

Copiá el archivo `servidor.js` (esta misma carpeta) a la Mac, por ejemplo a
`~/musica-servidor/servidor.js`.

### 3. Elegir una clave

Para que nadie más pueda usar tu Mac para bajar cosas. Generá una:

```bash
openssl rand -hex 16
```

Guardá el resultado, lo vas a usar dos veces.

### 4. Probarlo

```bash
cd ~/musica-servidor
MUSICA_TOKEN=tu_clave_aca node servidor.js
```

Deberías ver "Servidor de Música Libre andando". Probá en otra terminal:

```bash
curl "http://localhost:8787/salud?token=tu_clave_aca"
```

Tiene que decir `"ytdlp": true`.

---

## Sacarlo a internet (gratis, sin tocar el router)

Vercel necesita llegar a tu Mac. **No abras puertos en el router** — usá un
túnel de Cloudflare, que es gratis y más seguro:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8787
```

Te va a imprimir una dirección tipo:

```
https://algo-random-cosas.trycloudflare.com
```

Esa es la URL de tu servidor. Dejá esa terminal abierta.

> **Ojo:** con `trycloudflare` la URL **cambia cada vez** que reiniciás el
> túnel. Para una fija hace falta un dominio en Cloudflare (también gratis,
> pero el dominio se paga). Para probar, la temporal alcanza.

---

## Conectarlo con la app

En **vercel.com** → tu proyecto → **Settings** → **Environment Variables**,
agregá estas dos:

| Nombre | Valor |
|---|---|
| `MUSICA_SERVER` | `https://algo-random-cosas.trycloudflare.com` |
| `MUSICA_TOKEN` | la clave que generaste |

Después **Deployments → Redeploy** para que las tome.

---

## Que arranque solo al prender la Mac

Para no tener que abrir la terminal cada vez. Creá el archivo
`~/Library/LaunchAgents/com.musicalibre.servidor.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.musicalibre.servidor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/TU_USUARIO/musica-servidor/servidor.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MUSICA_TOKEN</key><string>tu_clave_aca</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/musica-servidor.log</string>
  <key>StandardOutPath</key><string>/tmp/musica-servidor.log</string>
</dict>
</plist>
```

Cambiá `TU_USUARIO` y la clave. Después:

```bash
launchctl load ~/Library/LaunchAgents/com.musicalibre.servidor.plist
```

En Macs con chip Intel, `node` suele estar en `/usr/local/bin/node`.

---

---

## Si tu Mac ya funciona como servidor 24/7

Si ya la tenés configurada para no dormirse y reencender sola, la mayor
parte del trabajo está hecha. Igual conviene revisar estas tres cosas,
porque son las que rompen este servidor en particular.

### 1. El túnel también tiene que arrancar solo

**Este es el punto que más se olvida.** De nada sirve que el servidor
reviva si el túnel de Cloudflare no. Y con `trycloudflare` hay un
problema extra: **la URL cambia cada vez que se reinicia**, así que
después de un corte de luz Vercel apuntaría a una dirección muerta.

Dos opciones:

- **Rápida:** dejar `trycloudflare` y actualizar la variable en Vercel
  cuando cambie. Sirve para probar, es molesto a la larga.
- **Estable (recomendada):** un túnel con nombre. Necesitás un dominio
  en Cloudflare, y la URL ya no cambia nunca:

```bash
cloudflared tunnel login
cloudflared tunnel create aura
# apuntá un subdominio, ej: aura.tudominio.com
cloudflared tunnel route dns aura aura.tudominio.com
```

Y que corra como servicio del sistema, que sobrevive a los reinicios:

```bash
sudo cloudflared service install
```

### 2. Que el disco no se llene

Cada canción pesa 3-8 MB. El servidor ya borra lo más viejo cuando pasa
el límite, pero si vas a dejarlo meses, subilo o bajalo a gusto con
`MUSICA_MAX_GB` (por defecto 5 GB, unas 800-1500 canciones).

### 3. Que yt-dlp se mantenga al día

**Esto es lo que más se rompe.** YouTube cambia seguido y un yt-dlp
viejo deja de funcionar de un día para el otro. Poné una actualización
automática semanal:

```bash
crontab -e
```

Y agregá:

```
0 4 * * 1 /opt/homebrew/bin/brew upgrade yt-dlp >/dev/null 2>&1
```

(en Macs Intel es `/usr/local/bin/brew`)

### Sobre "no dormirse"

Si ya lo tenés resuelto, saltealo. Si no, lo importante es que **el disco
tampoco duerma**, no solo la pantalla:

```bash
sudo pmset -a sleep 0 disksleep 0 womp 1
```

`womp 1` la despierta si llega tráfico de red. Para ver cómo está:
`pmset -g`.

### Comprobar que todo revivió

Después de un reinicio, desde cualquier lado:

```bash
curl "https://TU-URL-DEL-TUNEL/salud?token=tu_clave"
```

Si responde `"ytdlp": true`, está todo funcionando.

---

## Opciones

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto | `8787` |
| `MUSICA_DIR` | Dónde guarda los audios | `~/musica-libre-audio` |
| `MUSICA_TOKEN` | Clave de acceso | vacío (sin protección) |
| `MUSICA_MAX_GB` | Límite de disco; borra lo más viejo | `5` |
| `MUSICA_COOKIES` | Archivo de cookies de YouTube | — |

---

## Si algo falla

**"no se pudo bajar"** → actualizá yt-dlp: `brew upgrade yt-dlp`. YouTube
cambia seguido y yt-dlp se actualiza rápido.

**Sigue pidiendo verificación de bot** → exportá las cookies de tu sesión de
YouTube con una extensión tipo *Get cookies.txt*, guardalas y arrancá con
`MUSICA_COOKIES=/ruta/cookies.txt`.

**La app no lo usa** → revisá que `MUSICA_SERVER` esté en Vercel **y** que
hayas hecho Redeploy. Probá la URL del túnel desde el navegador del celu:
tiene que responder algo en `/salud?token=...`.

---

## Sobre el uso

Bajar música con derechos de autor puede ir contra los términos de YouTube y
la ley de copyright, según el país. Esto es para uso personal con contenido
que tengas derecho a usar. La responsabilidad es tuya.
