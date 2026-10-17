import json
import urllib.request
import re
from datetime import datetime, timezone, timedelta

# Zona horaria de Ecuador (UTC-5)
tz_ecuador = timezone(timedelta(hours=-5))
ahora = datetime.now(tz_ecuador)

# 1. Leer el archivo JSON actual para conservar valores base
try:
    with open("datos_sni.json", "r", encoding="utf-8") as f:
        datos_actuales = json.load(f)
except Exception as e:
    print(f"Aviso al leer datos_sni.json: {e}")
    datos_actuales = {}

# 2. Obtener temperatura máxima prevista hoy en Guayaquil desde Open-Meteo
temp_max_gye = None
try:
    url_clima = "https://api.open-meteo.com/v1/forecast?latitude=-2.1894&longitude=-79.8891&current=temperature_2m&daily=temperature_2m_max&timezone=America%2FGuayaquil"
    req_clima = urllib.request.Request(url_clima, headers={"User-Agent": "MonitorSNI/1.0"})
    with urllib.request.urlopen(req_clima, timeout=12) as resp:
        datos_clima = json.loads(resp.read().decode("utf-8"))
        temp_actual = datos_clima.get("current", {}).get("temperature_2m")
        temp_max_dia = datos_clima.get("daily", {}).get("temperature_2m_max", [None])[0]
        temp_usar = temp_max_dia if temp_max_dia is not None else temp_actual
        if temp_usar is not None:
            temp_max_gye = round(float(temp_usar), 1)
            print(f"Temperatura Guayaquil (Open-Meteo): {temp_max_gye} °C")
except Exception as e:
    print(f"Aviso Open-Meteo: {e}. Se conserva valor previo.")

# 3. Intentar consultar portal operativo de CENACE para importación y demanda
# URL oficial de CENACE de información operativa en tiempo real
importacion_cenace_mw = None
demanda_cenace_mw = None

try:
    url_cenace = "https://www.cenace.gob.ec/info-operativa/InformacionOperativa.htm"
    headers_cenace = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
    req_cenace = urllib.request.Request(url_cenace, headers=headers_cenace)
    with urllib.request.urlopen(req_cenace, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
        
        # Búsqueda de demanda nacional instantánea en el portal
        match_dem = re.search(r"DEMANDA\s*TOTAL[^\d]{1,100}?(\d{1,2}[\s\.]?\d{3})", html, re.IGNORECASE)
        if match_dem:
            d_str = match_dem.group(1).replace(" ", "").replace(".", "").strip()
            if d_str.isdigit() and 2500 <= int(d_str) <= 6000:
                demanda_cenace_mw = int(d_str)
                print(f"Demanda detectada en CENACE: {demanda_cenace_mw} MW")
        
        # Búsqueda de importación en el portal de tiempo real
        match_imp = re.search(r"IMPORTACI[ÓO]N[^\d]{1,100}?(\d{1,4})", html, re.IGNORECASE)
        if match_imp:
            imp_val = int(match_imp.group(1).strip())
            # Si CENACE reporta menos de 5 MWh, la importación comercial real es 0 MW
            importacion_cenace_mw = imp_val if imp_val >= 5 else 0
            print(f"Importación reportada en portal CENACE: {importacion_cenace_mw} MW")
except Exception as e:
    print(f"Aviso CENACE: No disponible en este ciclo ({e}). Se conserva valor previo.")

# 4. Formatear fecha y hora en formato estándar
meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
dias_semana = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"]
dia_sem = dias_semana[ahora.weekday()]
fecha_str = f"{dia_sem} {ahora.day:02d} {meses[ahora.month - 1]} {ahora.year} ({ahora.strftime('%Hh%M')})"

# 5. Asignar cambios
datos_actuales["fecha_reporte"] = fecha_str
if temp_max_gye is not None:
    datos_actuales["temp_costa_c"] = temp_max_gye
if demanda_cenace_mw is not None:
    datos_actuales["demanda_base_mw"] = demanda_cenace_mw
if importacion_cenace_mw is not None:
    datos_actuales["importacion_colombia_mw"] = importacion_cenace_mw

# 6. Guardar en datos_sni.json
with open("datos_sni.json", "w", encoding="utf-8") as f:
    json.dump(datos_actuales, f, indent=2, ensure_ascii=False)

print(f"Actualización completada: {fecha_str} | Temp GYE: {datos_actuales.get('temp_costa_c')} °C | Col: {datos_actuales.get('importacion_colombia_mw')} MW | Demanda: {datos_actuales.get('demanda_base_mw')} MW")
