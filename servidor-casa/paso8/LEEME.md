# PASO 8 · Que funcione solo para siempre 🎵

Todo el paso 8 de la guía en **un solo comando**. No tenés que escribir nada a mano:
el instalador detecta tu Mac, tu carpeta, tu Node, tu yt-dlp, tu túnel… y configura todo.

---

## 1 · Llevá el instalador a la Mac

Descargá el archivo **`instalar-automatico.sh`** (está en la carpeta `paso8`, junto con
este LEEME) y pasalo a la Mac. Cualquiera de estas formas sirve:

- **AirDrop** (Mac y iPhone/Mac cerca, bluetooth y wifi prendidos)
- **WhatsApp / Telegram** (te lo mandás a vos mismo y lo bajás en la Mac)
- **iCloud Drive** o **Google Drive**
- **USB**

No importa dónde lo guardes en la Mac (Escritorio, Descargas…).

## 2 · Ejecutalo

Abrí **Terminal** (Cmd+Espacio → escribí "Terminal") y escribí, cambiando la ruta si hace falta:

```bash
cd ~/Desktop && bash instalar-automatico.sh
```

> Si lo guardaste en Descargas: `cd ~/Downloads && bash instalar-automatico.sh`
> Si lo dejaste en el Escritorio pero tu Mac tiene la carpeta en español: `cd ~/Escritorio && bash instalar-automatico.sh`

Te va a preguntar:

| Pregunta | Qué ponés |
|---|---|
| `MUSICA_TOKEN` | La clave del paso 3.4 (la que usaste para arrancar el servidor a mano) |
| `Límite de disco en GB` | Enter (deja 10) |
| `¿Cierro el servidor manual?` | `s` — para que el automático tome el puerto (cerrá la ventana vieja de Terminal) |
| `¿Cierro el túnel manual?` | `s` — igual que arriba |
| Contraseña de admin | La contraseña de tu Mac (la pide para `pmset`) |

## 3 · Qué hace (paso a paso de la guía)

| De la guía | Lo que hace |
|---|---|
| **8.1** | Crea `~/Library/LaunchAgents/com.aura.servidor.plist` con tus datos (usuario, ruta de node, token, límite de disco y cookies si existen) y lo activa. `KeepAlive` lo revive solo si se cae. |
| **8.2** | Si tenés túnel con dominio (Opción B): verifica que el servicio esté instalado. Si es `trycloudflare` (Opción A): crea y activa `com.aura.tunel.plist` para que el túnel también arranque solo, y te muestra la URL actual. |
| **8.3** | Agenda en `crontab` la actualización semanal de yt-dlp (lunes 4 AM). |
| **8.4** | `sudo pmset -a sleep 0 disksleep 0 womp 1` — la Mac no duerme ni el disco, y despierta con tráfico de red. |
| **8.5** | Te muestra el resumen y los comandos de verificación. |

## 4 · ⚠️ Importante si tu túnel es trycloudflare (Opción A)

La URL **cambia en cada reinicio de la Mac**. Es inherente a esa opción gratis.
Por eso, después de cada reinicio (o corte de luz), hacé esto:

```bash
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/aura-tunel.log | tail -1
```

Ese comando te da la URL **nueva**. Luego:

1. **Vercel** → tu proyecto → **Settings** → **Environment Variables** → actualizá `MUSICA_SERVER` con la URL nueva (sin barra final).
2. **Deployments** → último → **⋯** → **Redeploy**.

> 💡 Si querés que eso también desaparezca (URL fija para siempre, cero mantenimiento),
> la Opción B de la guía (dominio propio, ~$10/año) resuelve justo eso. Con tu Mac 24/7
> vale la pena cuando puedas.

## 5 · Verificación final (después de un reinicio de la Mac)

```bash
curl http://localhost:8787/salud        # el servidor anduvo solo
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/aura-tunel.log | tail -1   # URL del túnel (si es Opción A)
```

Y en el celular: abrí `TU-URL-DEL-TUNEL/salud` → tiene que salir `"ytdlp":true`.
Prueba de fuego: **Modo avión** → Perfil → Descargadas → play. 🎧

## 6 · Si preferís hacerlo a mano (los comandos de la guía)

El instalador hace exactamente esto; acá está por si querés comparar o hacerlo manual:

**8.1** — `nano ~/Library/LaunchAgents/com.aura.servidor.plist` (pegá el modelo de
`com.aura.servidor.plist` de esta carpeta, cambiando `TU_USUARIO` y `TU_CLAVE`) y luego:

```bash
launchctl load ~/Library/LaunchAgents/com.aura.servidor.plist
```

**8.2** — Opción B: `sudo cloudflared service install`. Opción A: `com.aura.tunel.plist`
(está en esta carpeta) → mismo procedimiento que arriba.

**8.3** — `crontab -e` y agregar:

```
0 4 * * 1 /usr/local/bin/yt-dlp -U >/dev/null 2>&1
```

(Si instalaste yt-dlp con Homebrew: `0 4 * * 1 brew upgrade yt-dlp >/dev/null 2>&1`)

**8.4** — `sudo pmset -a sleep 0 disksleep 0 womp 1`

## 7 · Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `curl http://localhost:8787/salud` no responde | `tail -f /tmp/aura-servidor.log` para ver el error. ¿Node está en la ruta correcta? Corré `which node` y fijate que el plist use esa ruta. |
| El servidor se cae y no revive | `launchctl list \| grep aura` — si no aparece, `launchctl load ~/Library/LaunchAgents/com.aura.servidor.plist` |
| El túnel no arranca solo | `tail -f /tmp/aura-tunel.log`. Fijate que cloudflared esté en `which cloudflared` y que la ruta del plist sea la misma. |
| YouTube bloquea ("no eres un bot") | Paso 3.7: cookies. Asegurate de que el archivo `cookies.txt` exista en `~/aura-servidor/` (el instalador lo detecta solo, pero tenés que correrlo de nuevo si lo agregás después). |
| Quiero re-ejecutar el instalador | Tranquilo, es idempotente: se puede correr las veces que quieras, no duplica nada. |

---

## 8 · Ya está en GitHub (alternativa a AirDrop/USB)

El paquete quedó en el repo en `servidor-casa/paso8/`. Si preferís bajarlo directo
en la Mac con `curl` (como hiciste con `servidor.js`):

```bash
cd ~/aura-servidor
curl -O https://raw.githubusercontent.com/Agus-12/musica-libre/main/servidor-casa/paso8/instalar-automatico.sh
curl -O https://raw.githubusercontent.com/Agus-12/musica-libre/main/servidor-casa/paso8/LEEME.md
bash instalar-automatico.sh
```

(las plantillas `com.aura.servidor.plist` y `com.aura.tunel.plist` también están en
esa carpeta por si las querés para referencia manual).
