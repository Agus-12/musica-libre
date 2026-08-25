from pathlib import Path
p = Path("servidor-casa/servidor.js")
t = p.read_text()
if "function buscarEnDisco" in t:
    print("LISTO")
    raise SystemExit(0)
print("FALLO: abrí aplicar-cache-mac.py del chat anterior o avisame")
