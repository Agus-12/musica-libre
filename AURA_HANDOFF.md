# AURA — continuidad del proyecto

Documento de continuidad para cualquier sesión futura. **No contiene secretos**: nunca guardar aquí tokens, contraseñas, cookies de YouTube, PAT de GitHub ni llaves de Supabase.

## Identidad del proyecto

- Aplicación: AURA / musica-libre
- Repo: `Agus-12/musica-libre`, rama `main`
- Producción: `https://musica-libre.vercel.app`
- Stack web: Next.js 14 App Router, React 18, Supabase, PWA
- Usuario: Agus (México)
- Servidor casero: Mac mini Intel 2014, macOS Monterey 12.7.6

## Estado operativo confirmado

### AURA en producción

- Último build verificado al redactar este documento: `c1b4a8f06ba4`
- `/profile`: HTTP 200
- Reproductor global en `/profile`
- `/spotify` redirige a la experiencia unificada
- Búsqueda: Deezer/iTunes y YouTube Music
- Descargas offline reales en Cache Storage `ml-saved-v1`
- Modo sin datos
- Favoritos, playlists, chat, amigos y notificaciones
- Importación de playlists Spotify/Deezer
- Administración de cuentas AURA Libre ya existe en la rama actual

### Mac mini / AURA servidor

- Carpeta primaria: `/Volumes/Downloads/musica-libre-audio`
- USB: APFS, volumen `Downloads`, aproximadamente 250 GB
- Respaldo: `/Users/macmini/musica-libre-audio-respaldo`
- Límite externo: 220 GB
- Límite de respaldo interno: 100 GB
- Archivos actuales verificados recientemente: alrededor de 821
- `yt-dlp`: funcionando
- `ffmpeg`: funcionando
- `cloudflared`: funcionando
- LaunchAgents: `com.aura.servidor`, `com.aura.tunel`
- El túnel es Quick Tunnel de Cloudflare y cambia de URL; el guardián avisa a Vercel automáticamente.
- No hay que asumir que una URL vieja sigue viva: consultar `/api/tunel?token=...` y luego `/salud`.
- Si se modifica `tunel.js`, usar `AURA_LOCAL=http://127.0.0.1:8787`.
- Monterey necesitó certificados raíz para Node: `NODE_EXTRA_CA_CERTS` apunta a un PEM local generado con `security find-certificate`.
- La Mac está configurada con `pmset`: `sleep 0`, `disksleep 0`, pantalla 10 min, `autorestart 1`.

### Respaldo por desconexión USB

`servidor-casa/servidor.js` soporta:

- `MUSICA_DIR` como carpeta primaria externa.
- `MUSICA_BACKUP_DIR` como respaldo local.
- Cambio automático a respaldo si el USB no está montado.
- Sincronización periódica al reconectar el USB.
- Detección/reparación de m4a fragmentados (`moof`) con ffmpeg.
- Limpieza por espacio.

No borrar la carpeta primaria ni formatear la USB sin confirmar antes el respaldo.

## Conteo offline en el teléfono

La app distingue correctamente entre:

- entrada con `video_id`: puede ser streaming/intentado, no necesariamente offline;
- entrada con `audio_url` y respuesta existente en `ml-saved-v1`: audio offline real.

El almacenamiento offline se mide desde Cache Storage. El botón visible es `Cuenta → Almacenamiento offline → Ver espacio usado`.
La limpieza debe conservar audios referenciados por `ml_mp3`, incluyendo canciones descargadas dentro de playlists (`solo_playlist`). Solo limpiar duplicados u huérfanos con mucho cuidado.

## Reproductor / iOS

- Android es más confiable en segundo plano.
- iOS PWA puede suspender JavaScript después de pausar desde pantalla bloqueada; no prometer control 100% nativo sin app híbrida.
- Para audios offline se guarda posición en `localStorage` y se intenta reanudar.
- No despertar el iframe de YouTube cuando suena un archivo local.
- No volver a `window.location.href` para navegar desde el reproductor: corta la música. Usar `irAExplorar()` y eventos internos.

## Artistas y álbumes

- Perfil de artista usa `app/api/music?action=artist`.
- Artista muestra canciones, colaboraciones y álbumes.
- En búsqueda el nombre bajo la canción permanece normal para evitar clics accidentales.
- En detalle de álbum y reproductor expandido el artista es verde/clicable.
- La mini barra inferior no debe navegar al tocar el texto del artista.
- Al navegar desde reproductor expandido, bajar el reproductor con `setExpanded(false)` y usar navegación interna para conservar audio.

## Premium / pagos — estado real

- Hay rutas y UI de Mercado Pago en modo prueba.
- La prueba de suscripciones recurrentes con tarjetas de sandbox de Mercado Pago fue problemática (`Resource not found`, `card_token_id`, ambiente de prueba).
- Se cambió el flujo de prueba a Checkout Pro de pago único:
  - mensual: 26 MXN por 30 días;
  - anual: 260 MXN por 365 días;
  - webhook actualiza `suscripciones`.
- No activar cobros reales sin revisar legalidad, términos, impuestos, comisiones y seguridad.
- `supabase-pagos.sql` crea `suscripciones`.
- AURA Libre se administra desde panel propio; el servidor debe proteger las APIs por rol/UUID, no por esconder botones.

## Pendientes actuales conocidos

1. Ajustar la tarjeta de administración AURA Libre: los botones Activar/Desactivar deben quedar dentro de cada tarjeta, alineados y sin salirse del contenedor en iPhone.
2. Agregar cambio de nombre de usuario:
   - solo para el dueño de la cuenta;
   - validar formato y longitud;
   - unicidad case-insensitive en servidor/Supabase;
   - nunca confiar solo en validación del cliente;
   - resolver qué pasa con URLs/perfiles compartidos al cambiarlo.
3. Revisar/confirmar restauración legítima de UDC. Los workers antiguos contenían automatización de registros sensibles; no reactivar sin flujo autorizado y sin secretos en el código.
4. Agregar/restaurar `cookies.txt` de YouTube solo desde una cuenta propia; nunca subirlo al repo.
5. Rotar cualquier PAT de GitHub o credencial que haya sido pegada en el chat.

## Reglas de trabajo para futuras sesiones

1. Todo en español.
2. UI sin emojis; usar `Ico` SVG. Emojis solo en novedades/push si corresponde.
3. Antes de decir “listo”: build real y prueba HTTP/producción.
4. Para cambios web: editar → `npm install --no-audit --no-fund` → `npx next build` → revisar que `public/sw.js` no cambió accidentalmente → commit → push → esperar despliegue → verificar `AURA_BUILD` y HTTP 200.
5. Git remote puede no persistir en el workspace; reconfigurarlo antes de push. Nunca guardar el token en documentos.
6. Para Mac: actualizar archivos con `curl -fsSL ... -o`, revisar `plutil`, reiniciar `launchctl`, probar `/salud` local y túnel.
7. No borrar/formatear discos sin identificar `/dev/diskX` y verificar respaldo.
8. No afirmar que iOS PWA tiene garantías nativas que Apple no da.
9. Si una credencial aparece en texto, recomendar revocarla/rotarla y no repetirla.

## Flujo para continuar

- Leer este archivo primero.
- Revisar `git log -5 --oneline` y `git status`.
- Revisar build/producción antes de modificar funcionalidades.
- Para un cambio visual, probar en viewport iPhone y desktop.
- Para un cambio de descarga/offline, probar tanto `ml_mp3` como Cache Storage y modo sin datos.
