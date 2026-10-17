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


# ---------------------------------------------------------------- Física de Paute (Celec Sur)
# Cuánto baja Mazar por cada MW que genera el complejo Paute no es un número fijo: Molino y
# Sopladora también usan el agua que llega a Amaluza entre las dos presas. Por eso se calcula
# con datos reales: energía diaria de Mazar, Molino y Sopladora, caudal de entrada y variación
# de la cota de los últimos días completos.
CELEC_ORDS = "https://generacioncsr.celec.gob.ec:8443/ords/csr/"
ENERGIA_PAUTE = ("sardommaz/mazEnerDia", "sardommol/molEnerDia", "sardomsop/sopEnerDia")


def _celec_items(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (simulador-mazar)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("items", [])


def _celec_puntos(mrid, dia):
    ini = datetime(dia.year, dia.month, dia.day, 1, tzinfo=timezone(timedelta(hours=-5))).astimezone(timezone.utc)
    fin = ini + timedelta(hours=23)
    url = (f"{CELEC_ORDS}sardomcsr/pointValues?mrid={mrid}&fechaInicio={ini:%Y-%m-%dT%H:%M:%S.000Z}"
           f"&fechaFin={fin:%Y-%m-%dT%H:%M:%S.000Z}&fecha={dia:%d/%m/%Y}%2001:00:00")
    return sorted((i["loctimestamp"], float(i["valueedit"])) for i in _celec_items(url) if i.get("valueedit") is not None)


def fisica_paute(hoy_local, dias_k=10, dias_p=7):
    """Devuelve k (MW por m³/s que sale de Mazar), Paute medio de los últimos días y el detalle."""
    area = lambda c: 3.758 + 0.2177 * (c - 2115)   # hm³ por metro de cota
    filas = []
    for n in range(dias_k, 0, -1):
        d = hoy_local - timedelta(days=n)
        cota_fin = _celec_puntos(30031, d)
        cota_ini = _celec_puntos(30031, d - timedelta(days=1))
        caudal = _celec_puntos(30538, d)
        horas = []
        energia = 0.0
        for ep in ENERGIA_PAUTE:
            vals = [float(i["valueedit"]) for i in _celec_items(f"{CELEC_ORDS}{ep}?fecha={d:%d/%m/%Y}%2000:00:00")
                    if i.get("valueedit") is not None]
            horas.append(len(vals))
            energia += sum(vals)
        if len(cota_fin) < 20 or len(cota_ini) < 20 or len(caudal) < 20 or min(horas) < 20:
            continue  # día incompleto
        c0, c1 = cota_ini[-1][1], cota_fin[-1][1]
        q = sum(v for _, v in caudal) / len(caudal)
        p = energia / 24.0
        salida = q - (c1 - c0) * area((c0 + c1) / 2) * 1e6 / 86400   # m³/s que salieron de Mazar
        filas.append({"dia": d.isoformat(), "paute_mw": round(p), "caudal": round(q, 1),
                      "cota": round(c1, 2), "variacion": round(c1 - c0, 2), "salida": round(salida, 1)})
    if len(filas) < 5:
        raise ValueError(f"solo {len(filas)} días completos en Celec")
    k = sum(f["paute_mw"] for f in filas) / max(1.0, sum(f["salida"] for f in filas))
    ult = filas[-dias_p:]
    p7 = sum(f["paute_mw"] for f in ult) / len(ult)
    return {"k_mw_por_m3s": round(min(20.0, max(7.0, k)), 2), "paute_prom_mw": round(p7),
            "dias_k": len(filas), "dias_p": len(ult), "desde": filas[0]["dia"], "hasta": filas[-1]["dia"],
            "detalle": filas}


# 5b. Física de Paute calculada con datos reales de Celec Sur
#     - k: MW que genera el complejo Paute por cada m³/s que sale de Mazar (últimos 10 días completos)
#     - paute_7d_mw: generación real promedio de Paute en los últimos 7 días completos
#     - hm3_por_metro: volumen de Mazar por metro de cota a la cota actual
#     La demanda base se ajusta para que, con las fórmulas de la página, Paute genere su promedio real
#     de la última semana (así un fin de semana no distorsiona la proyección).
try:
    fis = fisica_paute(ahora.date())
    datos["k_mw_por_m3s"] = fis["k_mw_por_m3s"]
    datos["paute_7d_mw"] = fis["paute_prom_mw"]
    datos["fisica_periodo"] = f"{fis['desde']} a {fis['hasta']}"
    cota_act = float(datos.get("cota_mazar", 2123.0))
    datos["hm3_por_metro"] = round(3.758 + 0.2177 * (cota_act - 2115), 2)
    qc = float(datos.get("caudal_coca", 170))
    ccs = min(1350, round(qc * 4.79))
    if qc >= 245:
        ccs = round(ccs * 0.52)
    elif qc >= 220:
        ccs = round(ccs * 0.85)
    ac = max(0, round((float(datos.get("temp_costa_c", 30)) - 28.0) * 49))
    imp = float(datos.get("importacion_colombia_mw", 0))
    cortes = float(datos.get("cortes_mw", 0))
    datos["demanda_base_mw"] = int(round((fis["paute_prom_mw"] + 2500 + ccs + imp + cortes - ac) / 5) * 5)
    print(f"Física Paute (Celec Sur): {datos['k_mw_por_m3s']} MW por m³/s, Paute 7 días {datos['paute_7d_mw']} MW, "
          f"{datos['hm3_por_metro']} hm³ por metro; demanda base equivalente {datos['demanda_base_mw']} MW")
except Exception as e:
    print(f"Aviso física Paute: {e}. Se conservan valores previos.")

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
