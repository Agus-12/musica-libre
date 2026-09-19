# Instrucciones de continuidad para AURA

Antes de tocar código, leer `AURA_HANDOFF.md`.

## Reglas
- Responder en español.
- Diagnosticar con evidencia antes de afirmar.
- No mostrar ni guardar secretos (tokens, contraseñas, cookies, PAT, llaves Supabase).
- UI sin emojis; usar el componente `Ico`.
- Correr `npm install --no-audit --no-fund` y `npx next build` antes de publicar.
- Verificar producción con `/profile` y `public/sw.js` después del despliegue.
- No tocar `public/sw.js` salvo que el cambio lo requiera.
- No borrar ni formatear discos sin confirmar el identificador y el respaldo.
- No reactivar automatizaciones de UDC que trabajen con identidades o documentos sensibles sin confirmar que el flujo es legítimo y autorizado.

## Ubicaciones clave
- Web: `app/profile/page.js`, `app/spotify/page.js`
- API música: `app/api/music/route.js`
- API descargas: `app/api/download-mp3/route.js`
- Mac: `servidor-casa/servidor.js`, `servidor-casa/tunel.js`
- SQL: `supabase-*.sql`
