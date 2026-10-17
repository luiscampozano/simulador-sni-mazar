import json
import urllib.request
from datetime import datetime, timezone, timedelta

# Zona horaria de Ecuador (UTC-5)
tz_ecuador = timezone(timedelta(hours=-5))
ahora = datetime.now(tz_ecuador)

# 1. Obtener temperatura máxima prevista hoy en Guayaquil desde Open-Meteo
url_clima = "https://api.open-meteo.com/v1/forecast?latitude=-2.1894&longitude=-79.8891&daily=temperature_2m_max&timezone=America%2FGuayaquil"
req_clima = urllib.request.urlopen(url_clima, timeout=10)
datos_clima = json.loads(req_clima.read().decode("utf-8"))
temp_max_gye = round(float(datos_clima["daily"]["temperature_2m_max"][0]), 1)

# 2. Leer el JSON del día anterior para conservar valores base o calcular variación 24h
with open("datos_sni.json", "r", encoding="utf-8") as f:
    datos_actuales = json.load(f)

cota_ayer = datos_actuales.get("cota_mazar", 2123.09)

# 3. Aquí puedes conectar el endpoint de CELEC Sur / CENACE o tu hoja de Google Sheets
# Por defecto actualiza fecha y temperatura de la Costa automáticamente:
meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
fecha_str = f"{ahora.day:02d} {meses[ahora.month - 1]} {ahora.year} ({ahora.strftime('%Hh%M')})"

datos_actuales["fecha_reporte"] = fecha_str
datos_actuales["temp_costa_c"] = temp_max_gye

with open("datos_sni.json", "w", encoding="utf-8") as f:
    json.dump(datos_actuales, f, indent=2, ensure_ascii=False)

print(f"Actualizado con éxito: {fecha_str} | Temp GYE: {temp_max_gye} °C")
