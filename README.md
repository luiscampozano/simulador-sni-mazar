# Simulador Hidrológico y Termodinámico del SNI Ecuador (Embalse Mazar)

Simulador interactivo del Sistema Nacional Interconectado (SNI) de Ecuador. Modela la cuenta regresiva de días hasta que el embalse de Mazar (Complejo Paute) toque la cota crítica de 2.115 m s.n.m., en función del clima en la Costa (demanda por A/C en Guayaquil), despacho de Coca Codo Sinclair, generación térmica y compras de energía a Colombia.

* **Sitio Web Oficial en Vivo:** [https://luiscampozano.github.io/simulador-sni-mazar/](https://luiscampozano.github.io/simulador-sni-mazar/)

---

## 📁 Estructura de Archivos

* `index.html`: La aplicación web del simulador con los modelos físicos, gráficos y tanque de corte transversal. No requiere edición manual.
* `datos_sni.json`: Datos operativos del día. Es el archivo que lee la web al abrirse y el que actualiza el robot.
  * `fecha_reporte`: Estampa oficial de fecha y hora de la última sincronización.
  * `cota_mazar`: Cota actual de Mazar en metros sobre el nivel del mar (m s.n.m.).
  * `caida_24h`: Variación del nivel del embalse en las últimas 24 horas (m).
  * `caudal_mazar`: Caudal de entrada al embalse (m³/s).
  * `caudal_coca`: Caudal del río Coca para Coca Codo Sinclair (m³/s).
  * `importacion_colombia_mw`: Energía suministrada desde Colombia a través del enlace binacional (MW).
  * `temp_costa_c`: Temperatura de Guayaquil obtenida vía satélite para calcular la sobrecarga de aires acondicionados (°C).
  * `demanda_base_mw`: Demanda nacional base del SNI (MW).
  * `cortes_mw`: Restricción de carga y racionamiento a industrias (MW).
* `actualizar_datos.py`: Script en Python que consulta Open-Meteo y el portal de CENACE, y sobrescribe `datos_sni.json`.
* `.github/workflows/actualizar_diario.yml`: Automatización en GitHub Actions programada para ejecutarse cada 3 horas.

---

## ⚙️ Quién actualiza qué

| Quién | Cuándo | Qué actualiza | Fuente |
| :--- | :--- | :--- | :--- |
| **Robot (GitHub Actions)** | **Cada 3 horas** (00:45, 03:45, 06:45, 09:45, 12:45, 15:45, 18:45, 21:45 UTC) | Clima y temperatura máxima en Guayaquil, fecha/hora y monitoreo de importación en portal operativo. | [Open-Meteo API](https://open-meteo.com/) y portal [CENACE](https://www.cenace.gob.ec/info-operativa/InformacionOperativa.htm). |
| **Actualización Manual** | Cuando se emita nuevo boletín oficial (mañana / tarde) | Cota oficial de Mazar, caudales hidrológicos de los ríos y cortes programados. | Boletines diarios de CELEC Sur y CENACE en `datos_sni.json`. |

> **Nota:** Cada vez que el robot o tú hagan un cambio en la rama `main`, GitHub Pages reconstruye y publica el sitio automáticamente en menos de 60 segundos.
