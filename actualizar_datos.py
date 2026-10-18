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

# 4b. Lluvia pronosticada en las cuencas (Open-Meteo), con la misma regla del simulador "Cuenta regresiva Mazar":
#     seco si se esperan < 15 mm en 7 días; lluvia sostenida ("nino") si se esperan > 70 mm y ya llovieron > 40 mm
#     la semana anterior; en otro caso, un pulso de lluvia ("inamhi").
try:
    url_lluvia = ("https://api.open-meteo.com/v1/forecast?latitude=-2.75,-2.55,-0.20,-0.05"
                  "&longitude=-78.85,-78.60,-77.70,-77.55&daily=precipitation_sum&past_days=7&forecast_days=7"
                  "&timezone=America%2FGuayaquil")
    req_ll = urllib.request.Request(url_lluvia, headers={"User-Agent": "MonitorSNI-Lluvia/1.0"})
    with urllib.request.urlopen(req_ll, timeout=20) as resp:
        locs = json.loads(resp.read().decode("utf-8"))
    hoy_iso = ahora.date().isoformat()

    def _cuenca(idx):
        pas, fut = [], []
        for j in idx:
            d = locs[j]["daily"]
            k = d["time"].index(hoy_iso)
            pas.append(sum(x or 0 for x in d["precipitation_sum"][k - 7:k]))
            fut.append(sum(x or 0 for x in d["precipitation_sum"][k:k + 7]))
        return sum(pas) / len(pas), sum(fut) / len(fut)

    def _categoria(pasado, futuro):
        if futuro < 15:
            return "seco"
        if futuro > 70 and pasado > 40:
            return "nino"
        return "inamhi"

    for nombre, idx in (("paute", [0, 1]), ("coca", [2, 3])):
        pas, fut = _cuenca(idx)
        datos[f"lluvia_{nombre}"] = _categoria(pas, fut)
        datos[f"lluvia_{nombre}_mm"] = {"ultimos_7d": round(pas), "proximos_7d": round(fut)}
        print(f"Lluvia cuenca {nombre}: {pas:.0f} mm pasados, {fut:.0f} mm previstos → {datos[f'lluvia_{nombre}']}")
except Exception as e:
    print(f"Aviso lluvia Open-Meteo: {e}. Se conservan valores previos.")

# 5. CENACE (página "Información Operativa"): generación real cada media hora
#    Térmica, renovable, importación desde Colombia, demanda atendida, hidráulica total y energía por central.
#    El servidor de Cenace no envía su certificado intermedio (Sectigo DV R36): se descarga desde la dirección
#    que indica el propio certificado y se agrega a la lista de confianza, sin desactivar la verificación.
import ssl, base64, struct, math, html as htmllib

INTERMEDIO_CENACE = "http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt"
MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
               "septiembre", "octubre", "noviembre", "diciembre"]
_FMT = {"f8": "d", "f4": "f", "i1": "b", "u1": "B", "i2": "h", "u2": "H", "i4": "i", "u4": "I"}
_CLAVE = {"Hidráulica": "h", "Térmica": "t", "Importación": "i", "Renovable": "r",
          "Exportación": "e", "DEMANDA NACIONAL": "d"}


def _contexto_cenace():
    ctx = ssl.create_default_context()
    der = urllib.request.urlopen(INTERMEDIO_CENACE, timeout=30).read()
    ctx.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(der))
    return ctx


def _plotly_y(y):
    if isinstance(y, dict) and "bdata" in y:
        dt = y.get("dtype", "f8").lstrip("<|")
        raw = base64.b64decode(y["bdata"])
        n = len(raw) // struct.calcsize(_FMT[dt])
        vals = struct.unpack("<" + _FMT[dt] * n, raw)
    else:
        vals = y
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v) for v in vals]


def _filas(curva):
    series = {tr["name"]: _plotly_y(tr["y"]) for tr in curva}
    out = {}
    for k, hh in enumerate(curva[0]["x"]):
        fila = {}
        for nombre, c in _CLAVE.items():
            arr = series.get(nombre)
            if arr is None or k >= len(arr) or arr[k] is None:
                fila = None
                break
            fila[c] = arr[k]
        if fila and fila["d"] > 1000:
            out[hh] = fila
    return out


def _fecha_bloque(texto, titulo):
    m = re.search(titulo + r" \w+, (\d{1,2}) de (\w+) de (\d{4})", texto)
    if not m:
        return None
    return datetime(int(m.group(3)), MESES_LARGO.index(m.group(2).lower()) + 1, int(m.group(1))).date()


try:
    req_cenace = urllib.request.Request("https://www.cenace.gob.ec/info-operativa/InformacionOperativa.htm",
                                        headers={"User-Agent": "Mozilla/5.0 (MonitorSNI)"})
    with urllib.request.urlopen(req_cenace, timeout=40, context=_contexto_cenace()) as resp:
        page = resp.read().decode("utf-8", errors="replace")
    texto = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", " ", page, flags=re.S))))
    fecha_rt = _fecha_bloque(texto, "PRODUCCIÓN EN TIEMPO REAL")
    fecha_perfil = _fecha_bloque(texto, "INFORMACIÓN OPERATIVA DIARIA")
    if fecha_rt != ahora.date():
        raise ValueError(f"la página de Cenace muestra el {fecha_rt}, no hoy")
    dec = json.JSONDecoder()
    plots = []
    for mm in re.finditer(r'Plotly\.newPlot\(\s*"[^"]+",\s*', page):
        plots.append(dec.raw_decode(page, mm.end())[0])
    curvas = [p for p in plots if any(tr.get("name") == "DEMANDA NACIONAL" for tr in p)]
    tortas = [p for p in plots if any("HIDROELÉCTRICA" in (tr.get("labels") or []) for tr in p)]
    barras = [p for p in plots if any(tr.get("name") == "Coca Codo" for tr in p)]
    hoy_f = _filas(curvas[0])
    perfil = _filas(curvas[1]) if len(curvas) > 1 else {}
    if len(hoy_f) < 8:
        raise ValueError(f"solo {len(hoy_f)} medias horas de hoy")

    # Promedios de las últimas 24 h; las medias horas de ayer se toman del último día completo publicado
    ultimo = datetime.combine(fecha_rt, datetime.strptime(max(hoy_f), "%H:%M").time())
    ventana = []
    for k in range(48):
        ts = ultimo - timedelta(minutes=30 * k)
        hh = ts.strftime("%H:%M")
        if ts.date() == fecha_rt and hh in hoy_f:
            ventana.append(hoy_f[hh])
        elif hh in perfil:
            ventana.append(perfil[hh])
    prom = {c: sum(f[c] for f in ventana) / len(ventana) for c in "htirde"}

    def _energia(i):
        tr = tortas[i][0]
        e = {"hidro": float(tr["values"][tr["labels"].index("HIDROELÉCTRICA")])}
        e.update({t["name"].strip(): float(t["y"][0]) for t in barras[i] if isinstance(t.get("y"), list) and t["y"]})
        return e

    horas_hoy = len(hoy_f) / 2.0
    e_hoy = _energia(0)
    e_dia = _energia(1) if len(tortas) > 1 and len(barras) > 1 else None
    # Coca Codo: lo generado hoy (si ya hay 4 h); otras hidro: hoy si hay 12 h, si no, el último día completo
    ccs_mw = e_hoy.get("Coca Codo", 0) / horas_hoy if horas_hoy >= 4 else (e_dia or {}).get("Coca Codo", 0) / 24
    base_e, base_h = (e_hoy, horas_hoy) if (horas_hoy >= 12 or not e_dia) else (e_dia, 24.0)
    paute_e = sum(base_e.get(k, 0.0) for k in ("Paute", "Sopladora", "Mazar"))
    otras_mw = (base_e["hidro"] - base_e.get("Coca Codo", 0.0) - paute_e) / base_h

    datos["importacion_colombia_mw"] = int(round(prom["i"]))
    datos["demanda_atendida_mw"] = int(round(prom["d"]))
    datos["coca_codo_mw"] = int(round(ccs_mw))
    datos["caudal_coca"] = round(ccs_mw / 4.79, 1)   # caudal equivalente con la fórmula de la página
    datos["caudal_coca_fuente"] = "Cenace (generación medida de Coca Codo)"
    datos["termica_mw"] = int(round(prom["t"] + prom["r"]))
    datos["otras_hidro_mw"] = int(round(otras_mw))
    datos["generacion_firme_mw"] = int(round(prom["t"] + prom["r"] + otras_mw))
    datos["cenace_ok"] = True
    print(f"CENACE: demanda {prom['d']:.0f} MW, térmica {prom['t']:.0f} + renovable {prom['r']:.0f}, "
          f"importación {prom['i']:.0f}, Coca Codo {ccs_mw:.0f}, otras hidro {otras_mw:.0f} MW "
          f"(perfil completado con {fecha_perfil})")
except Exception as e:
    datos["cenace_ok"] = False
    print(f"Aviso CENACE: {e}. Se conservan valores previos.")

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
    if datos.get("coca_codo_mw"):
        ccs = float(datos["coca_codo_mw"])
    else:
        qc = float(datos.get("caudal_coca", 170))
        ccs = min(1350, round(qc * 4.79))
        if qc >= 245:
            ccs = round(ccs * 0.52)
        elif qc >= 220:
            ccs = round(ccs * 0.85)
    firme = float(datos.get("generacion_firme_mw", 2500))
    ac = max(0, round((float(datos.get("temp_costa_c", 30)) - 28.0) * 49))
    imp = float(datos.get("importacion_colombia_mw", 0))
    cortes = float(datos.get("cortes_mw", 0))
    datos["demanda_base_mw"] = int(round((fis["paute_prom_mw"] + firme + ccs + imp + cortes - ac) / 5) * 5)
    # Cotas de Amaluza y Sopladora (Celec Sur)
    for clave, mrid in (("cota_amaluza", 24019), ("cota_sopladora", 90919)):
        pts = _celec_puntos(mrid, ahora.date()) or _celec_puntos(mrid, ahora.date() - timedelta(days=1))
        if pts:
            datos[clave] = round(pts[-1][1], 2)
    print(f"Física Paute (Celec Sur): {datos['k_mw_por_m3s']} MW por m³/s, Paute 7 días {datos['paute_7d_mw']} MW, "
          f"{datos['hm3_por_metro']} hm³ por metro; demanda base equivalente {datos['demanda_base_mw']} MW")
except Exception as e:
    print(f"Aviso física Paute: {e}. Se conservan valores previos.")

# 5c. Sincronización con el simulador "Mazar y generación" (luiscampozano/simulador-mazar).
#     Para que ambos simuladores den exactamente el mismo resultado, se usan los mismos datos de partida
#     que ya calculó su robot (corre a la misma hora). Si en una corrida programada su robot aún no
#     terminó, se espera hasta ~12 minutos. Si sus datos tienen más de 3 h, se conservan los propios.
def _json_api(url):
    import os
    h = {"User-Agent": "MonitorSNI-Sync/1.0", "Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def _datos_a():
    import base64
    c = _json_api("https://api.github.com/repos/luiscampozano/simulador-mazar/contents/datos.json?ref=main")
    return json.loads(base64.b64decode(c["content"]).decode("utf-8"))

def _a_en_curso():
    for estado in ("in_progress", "queued"):
        r = _json_api(f"https://api.github.com/repos/luiscampozano/simulador-mazar/actions/runs?status={estado}&per_page=5")
        if r.get("total_count", 0) > 0:
            return True
    return False

try:
    import os, time, math
    programada = os.environ.get("GITHUB_EVENT_NAME") == "schedule"
    limite = time.time() + 12 * 60
    while True:
        A = _datos_a()
        ult = datetime.fromisoformat(A["robot"]["ultima_ejecucion"])
        edad_min = (datetime.now(EC) - ult).total_seconds() / 60
        if edad_min <= 20 or time.time() > limite:
            break
        if not (programada or _a_en_curso()):
            break
        print(f"Esperando al robot del otro simulador (sus datos tienen {edad_min:.0f} min)...")
        time.sleep(30)
    if edad_min <= 180:
        h = A["hoy"]
        T = float(h["tCosta"])
        datos["cota_mazar"] = float(A["cota"])
        datos["caudal_mazar"] = float(h["qMazar"])
        datos["caudal_coca"] = float(h["qCoca"])
        ccs_a = min(5 * float(h["qCoca"]), 1200) * (0.5 if float(h["qCoca"]) > 450 else 1)
        datos["coca_codo_mw"] = int(round(ccs_a))
        datos["importacion_colombia_mw"] = int(h["imp"])
        datos["termica_mw"] = int(h["therm"])
        datos["otras_hidro_mw"] = int(h["other"])
        datos["generacion_firme_mw"] = int(h["therm"]) + int(h["other"])
        datos["temp_costa_c"] = T
        datos["cortes_mw"] = int(h["cut"])
        datos["lluvia_paute"] = h["wPaute"]
        datos["lluvia_coca"] = h["wCoca"]
        fa = A.get("fisica") or {}
        if fa.get("k_mw_por_m3s"):
            datos["k_mw_por_m3s"] = fa["k_mw_por_m3s"]
            datos["paute_7d_mw"] = fa.get("paute_prom_mw", datos.get("paute_7d_mw"))
            datos["fisica_periodo"] = f"{fa.get('desde')} a {fa.get('hasta')}"
        datos["hm3_por_metro"] = round(3.758 + 0.2177 * (datos["cota_mazar"] - 2115), 2)
        # Misma demanda neta que el otro simulador: dBase + 50·(T − 32) − cortes.
        # Esta página calcula max(0, redondeo((T − 28)·49)) para el aire acondicionado (redondeo como JavaScript).
        ac_b = max(0, math.floor((T - 28.0) * 49 + 0.5))
        datos["demanda_base_mw"] = int(h["dBase"] + 50 * (T - 32) - ac_b)
        # Modelo calibrado (curva, Amaluza, pronóstico de caudales, día de la semana, rango): el mismo de A
        datos["modelo"] = A.get("modelo")
        datos["sincronizado_con"] = {"simulador": "Mazar y generación (luiscampozano/simulador-mazar)",
                                     "datos_de": A["robot"]["ultima_ejecucion"], "cota_hora": A.get("fecha")}
        print(f"Sincronizado con el otro simulador (datos de {A['robot']['ultima_ejecucion']}, {edad_min:.0f} min).")
    else:
        datos["sincronizado_con"] = None
        print(f"Los datos del otro simulador tienen {edad_min:.0f} min; se conservan los propios.")
except Exception as e:
    print(f"Aviso sincronización: {e}. Se conservan los valores propios.")

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
print(f"- Demanda base equivalente: {datos.get('demanda_base_mw')} MW (atendida medida: {datos.get('demanda_atendida_mw')} MW)")
print(f"- Generación firme (térmica + renovable + otras hidro): {datos.get('generacion_firme_mw')} MW")
print(f"- Factor Paute: {datos.get('k_mw_por_m3s')} MW por m³/s; Paute 7 días: {datos.get('paute_7d_mw')} MW")
print(f"- Cortes Empresas: {datos.get('cortes_mw')} MW")
print(f"- Lluvia: Paute {datos.get('lluvia_paute')} {datos.get('lluvia_paute_mm')}, Coca {datos.get('lluvia_coca')} {datos.get('lluvia_coca_mm')}")
