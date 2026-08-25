from pathlib import Path
p = Path("app/profile/page.js")
t = p.read_text()
t = t.replace(
    'import { aliasesDe, gruposAliasLocales, LIMITE_FREE } from "../utils/offlineCupo";',
    'import { aliasesDe, gruposAliasLocales, LIMITE_FREE, unicasOfflineLocales } from "../utils/offlineCupo";',
    1,
)
if "const syncCupoRef = useRef(false);" not in t:
    t = t.replace(
        '  const [syncCupo, setSyncCupo] = useState({ haciendo: false, listo: false });\n',
        '  const [syncCupo, setSyncCupo] = useState({ haciendo: false, listo: false });\n  const syncCupoRef = useRef(false);\n',
        1,
    )
t = t.replace(
'''  async function sincronizarCupoOffline(purge = false) {
    if (syncCupo.haciendo) return null;
    setSyncCupo({ haciendo: true, listo: false });''',
'''  async function sincronizarCupoOffline(purge = false) {
    if (syncCupoRef.current) return null;
    syncCupoRef.current = true;
    setSyncCupo({ haciendo: true, listo: false });''',
    1,
)
t = t.replace(
'''    } catch {}
    setSyncCupo({ haciendo: false, listo: false });
    return null;
  }
  async function cargarEstadoPremium() {''',
'''    } catch {}
    finally { syncCupoRef.current = false; }
    setSyncCupo({ haciendo: false, listo: false });
    return null;
  }
  async function cargarEstadoPremium() {''',
    1,
)
t = t.replace(
'''    if (!ilimitado && usados >= LIMITE_FREE) {
      toast.warning(`Límite Free: ${usados}/${LIMITE_FREE} offline. Borra una o pásate a Premium`, 5000);
      return;
    }''',
'''    let locales = 0;
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      locales = unicasOfflineLocales(mp3s).length;
    } catch {}
    if (!ilimitado && usados >= LIMITE_FREE) {
      toast.info("El contador de la cuenta está lleno: ajustando a este teléfono…", 2800);
      for (let i = 0; i < 20 && syncCupoRef.current; i++) await new Promise(r => setTimeout(r, 200));
      const d = await sincronizarCupoOffline(true);
      if (typeof d?.count === "number") usados = d.count;
      else {
        try {
          const ra = await fetch("/api/pagos/acceso", { cache: "no-store" });
          const acc = await ra.json();
          if (ra.ok) usados = Number(acc.offline_count) || usados;
        } catch {}
      }
    }
    if (!ilimitado && Math.max(usados, locales) >= LIMITE_FREE) {
      toast.warning(`Límite Free: teléfono ${locales}/${LIMITE_FREE}, cuenta ${usados}/${LIMITE_FREE}. Borra una OFF o pásate a Premium`, 6000);
      return;
    }''',
    1,
)
t = t.replace(
'''          if (!rr.ok) {
            const ed = await rr.json().catch(() => ({}));
            guardado = false;
            toast.warning(ed.error || "No hay cupo offline en tu cuenta", 4500);
          } else {
            const ed = await rr.json().catch(() => ({}));
            if (typeof ed.count === "number") setEstadoPremium(v => ({ ...v, offline_count: ed.count }));
          }''',
'''          if (!rr.ok) {
            for (let i = 0; i < 20 && syncCupoRef.current; i++) await new Promise(r => setTimeout(r, 200));
            const dSync = await sincronizarCupoOffline(true);
            const rr2 = await fetch("/api/pagos/offline", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ track_key: String(item.key).slice(0, 300), aliases })
            });
            if (!rr2.ok) {
              const ed = await rr2.json().catch(() => ({}));
              guardado = false;
              const n = typeof dSync?.count === "number" ? dSync.count : (ed.count ?? usados);
              toast.warning(ed.error || `No hay cupo offline (${n}/${LIMITE_FREE})`, 4500);
            } else {
              const ed = await rr2.json().catch(() => ({}));
              if (typeof ed.count === "number") setEstadoPremium(v => ({ ...v, offline_count: ed.count }));
            }
          } else {
            const ed = await rr.json().catch(() => ({}));
            if (typeof ed.count === "number") setEstadoPremium(v => ({ ...v, offline_count: ed.count }));
          }''',
    1,
)
p.write_text(t)
print("LISTO" if "rr2" in t and "ajustando a este teléfono" in t else "FALLO")
