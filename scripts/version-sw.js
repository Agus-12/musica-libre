/* Inyecta una huella única de build en public/sw.js.
   Corre solo (npm prebuild) en cada deploy de Vercel: al cambiar el
   byte-contenido del service worker, los navegadores detectan la
   versión nueva y muestran el modal de novedades. */
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "public", "sw.js");
const huella = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());
let src = fs.readFileSync(f, "utf8");
src = src.replace(/const AURA_BUILD = "[^"]*";/, `const AURA_BUILD = "${huella.slice(0, 12)}";`);
fs.writeFileSync(f, src);
console.log("sw.js versionado:", huella.slice(0, 12));
