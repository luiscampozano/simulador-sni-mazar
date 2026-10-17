import json
import urllib.request
import re
from datetime import datetime, timezone, timedelta

# Zona horaria de Ecuador (UTC-5)
EC = timezone(timedelta(hours=-5))
ahora = datetime.now(EC)

# 1. Cargar archivo datos_sni.json actual
try:
    with open("datos_sni.json", "r", encoding="utf-8") as f:
        datos = json.load(f)
except Exception as e:
    print(f"Aviso al leer datos_sni.json: {e}")
    datos = {}

# 2. Consultar Telemetría Oficial de CELEC Sur (Cota Mazar y Caudal Mazar)
# Servidor ORDS oficial de la central hidroeléctrica Mazar
BASE_CELEC = "https://generacioncsr.celec.gob.ec:8443/ords/csr/sardomcsr/pointValues"
MRID_COTA_MAZAR = 30031    # Cota Mazar en m s.n.m.
MRID_CAUDAL_MAZAR = 30538  # Caudal entrada Mazar en m³/s

def obtener_lecturas_celec(mrid, fecha_dia):
    """Consulta valores horarios de CELEC Sur para un día dado."""
    ini = datetime(fecha_dia.year, fecha_dia.month, fecha_dia.day, 1, tzinfo=EC).astimezone(timezone.utc)
    fin = ini + timedelta(hours=23)
    url = (
        f"{BASE_CELEC}?mrid={mrid}&fechaInicio={ini:%Y-%m-%dT%H:%M:%S.000Z}"
        f"&fechaFin={fin:%Y-%m-%dT%H:%M:%S.000Z}&fecha={fecha_dia:%d/%m/%Y}%2001:00:00"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "MonitorSNI-Celec/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        items = json.load(r).get("items", [])
        res = []
        for it in items:
            v = it.get("valueedit")
            if v is not None:
                t = datetime.strptime(it["loctimestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                res.append((t.astimezone(EC), float(v)))
        return sorted(res)

try:
    hoy_dia = ahora.date()
    ayer_dia = hoy_dia - timedelta(days=1)
    
    # Lecturas de cota (ayer y hoy para calcular variación en 24h)
    cotas_serie = obtener_lecturas_celec(MRID_COTA_MAZAR, ayer_dia) + obtener_lecturas_celec(MRID_COTA_MAZAR, hoy_dia)
    if cotas_serie:
        t_ult, cota_ult = cotas_serie[-1]
        if 2090.0 < cota_ult < 2160.0:
            cota_nueva = round(cota_ult, 2)
            datos["cota_mazar"] = cota_nueva
            print(f"Cota Mazar actualizada (Celec Sur): {cota_nueva} m s.n.m.")
            
            # Buscar lectura de hace aproximadamente 24 horas
            hace24 = [v for (tt, v) in cotas_serie if abs((tt - (t_ult - timedelta(hours=24))).total_seconds()) <= 3600]
            if hace24:
                datos["caida_24h"] = round(cota_nueva - hace24[0], 2)
                print(f"Variación 24h Mazar: {datos['caida_24h']} m")
                
    # Lecturas de caudal entrante Mazar (promedio últimas 24h)
    caudales_serie = obtener_lecturas_celec(MRID_CAUDAL_MAZAR, ayer_dia) + obtener_lecturas_celec(MRID_CAUDAL_MAZAR, hoy_dia)
    if caudales_serie:
        t_ult_q = caudales_serie[-1][0]
        ult24_q = [v for (tt, v) in caudales_serie if tt > t_ult_q - timedelta(hours=24) and 0 <= v < 1500]
        if len(ult24_q) >= 6:
            q24_prom = round(sum(ult24_q) / len(ult24_q), 2)
            datos["caudal_mazar"] = q24_prom
            print(f"Caudal Mazar 24h actualizado (Celec Sur): {q24_prom} m³/s")
except Exception as e:
    print(f"Aviso Celec Sur: {e}. Se conservan valores previos de Mazar.")

# 3. Consultar Caudal del Río Coca para Coca Codo Sinclair (Open-Meteo Flood / GloFAS)
# Coordenadas exactas de la obra de captación del río Coca: -0.198, -77.685
try:
    url_coca = "https://flood-api.open-meteo.com/v1/flood?latitude=-0.198&longitude=-77.685&daily=river_discharge&forecast_days=1"
    req_coca = urllib.request.Request(url_coca, headers={"User-Agent": "MonitorSNI-Coca/1.0"})
    with urllib.request.urlopen(req_coca, timeout=12) as resp:
        coca_data = json.loads(resp.read().decode("utf-8"))
        q_coca_dia = coca_data.get("daily", {}).get("river_discharge", [None])[0]
        if q_coca_dia is not None and 50 <= float(q_coca_dia) <= 1000:
            datos["caudal_coca"] = round(float(q_coca_dia), 1)
            print(f"Caudal Coca Codo Sinclair actualizado (GloFAS/Open-Meteo): {datos['caudal_coca']} m³/s")
except Exception as e:
    print(f"Aviso Coca Codo: {e}. Se conserva valor previo.")

# 4. Consultar Clima en Guayaquil (Open-Meteo Weather)
try:
    url_clima = "https://api.open-meteo.com/v1/forecast?latitude=-2.1894&longitude=-79.8891&current=temperature_2m&daily=temperature_2m_max&timezone=America%2FGuayaquil"
    req_clima = urllib.request.Request(url_clima, headers={"User-Agent": "MonitorSNI-Weather/1.0"})
    with urllib.request.urlopen(req_clima, timeout=12) as resp:
        datos_clima = json.loads(resp.read().decode("utf-8"))
        temp_actual = datos_clima.get("current", {}).get("temperature_2m")
        temp_max_dia = datos_clima.get("daily", {}).get("temperature_2m_max", [None])[0]
        temp_usar = temp_max_dia if temp_max_dia is not None else temp_actual
        if temp_usar is not None:
            datos["temp_costa_c"] = round(float(temp_usar), 1)
            print(f"Temperatura Guayaquil: {datos['temp_costa_c']} °C")
except Exception as e:
    print(f"Aviso Open-Meteo Clima: {e}")

# 5. Consultar Portal CENACE (Demanda SNI e Importación de Colombia)
try:
    url_cenace = "https://www.cenace.gob.ec/info-operativa/InformacionOperativa.htm"
    req_cenace = urllib.request.Request(url_cenace, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    })
    with urllib.request.urlopen(req_cenace, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
        
        # Demanda nacional
        match_dem = re.search(r"DEMANDA\s*TOTAL[^\d]{1,100}?(\d{1,2}[\s\.]?\d{3})", html, re.IGNORECASE)
        if match_dem:
            d_str = match_dem.group(1).replace(" ", "").replace(".", "").strip()
            if d_str.isdigit() and 2500 <= int(d_str) <= 6000:
                datos["demanda_base_mw"] = int(d_str)
                print(f"Demanda CENACE: {datos['demanda_base_mw']} MW")
        
        # Importación de Colombia
        match_imp = re.search(r"IMPORTACI[ÓO]N[^\d]{1,100}?(\d{1,4})", html, re.IGNORECASE)
        if match_imp:
            imp_val = int(match_imp.group(1).strip())
            datos["importacion_colombia_mw"] = imp_val if imp_val >= 5 else 0
            print(f"Importación Colombia (CENACE): {datos['importacion_colombia_mw']} MW")
except Exception as e:
    print(f"Aviso CENACE: {e}")

# 6. Actualizar fecha y hora del reporte
meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
dias_semana = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"]
dia_sem = dias_semana[ahora.weekday()]
fecha_str = f"{dia_sem} {ahora.day:02d} {meses[ahora.month - 1]} {ahora.year} ({ahora.strftime('%Hh%M')})"
datos["fecha_reporte"] = fecha_str

# 7. Guardar cambios en datos_sni.json
with open("datos_sni.json", "w", encoding="utf-8") as f:
    json.dump(datos, f, indent=2, ensure_ascii=False)

print(f"\n✅ REPORTE GENERADO CON ÉXITO: {fecha_str}")
print(f"- Cota Mazar: {datos.get('cota_mazar')} m")
print(f"- Caída 24h: {datos.get('caida_24h')} m")
print(f"- Caudal Mazar: {datos.get('caudal_mazar')} m³/s")
print(f"- Caudal Coca Codo: {datos.get('caudal_coca')} m³/s")
print(f"- Colombia: {datos.get('importacion_colombia_mw')} MW")
print(f"- Temp Guayaquil: {datos.get('temp_costa_c')} °C")
print(f"- Demanda: {datos.get('demanda_base_mw')} MW")
print(f"- Cortes Empresas: {datos.get('cortes_mw')} MW")
