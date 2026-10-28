/* Pestañas "2026 vs. años anteriores" y "Región de proyección" del simulador "Proyección del embalse Mazar".
   Solo leen datos (datos_sni.json y el historial diario de Celec Sur que guarda el otro simulador)
   y usan el mismo modelo (modelo.js); no cambian nada de la pestaña principal. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const f = (n, d = 0) => n.toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d });
  const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const sgn = (v, d = 1) => (v >= 0 ? "+" : "−") + f(Math.abs(v), d);
  const HIST_URLS = ["https://raw.githubusercontent.com/luiscampozano/simulador-mazar/main/historial/celec_diario.json",
    "https://luiscampozano.github.io/simulador-mazar/historial/celec_diario.json"];
  const HISTV_URLS = ["https://luiscampozano.github.io/simulador-mazar/historial/celec_2010_2022.json",
    "https://raw.githubusercontent.com/luiscampozano/simulador-mazar/main/historial/celec_2010_2022.json"];
  const ZC = 2116, PARADA = 2115;
  const C = { sky: "#38bdf8", amber: "#f59e0b", rose: "#f43f5e", emerald: "#10b981", slate: "#94a3b8", grid: "rgba(51, 65, 85, 0.3)", ink: "#e2e8f0" };
  let D = null, HISTD = null, HISTV = null, chComp = null, chReg = null;

  /* ---------- pestañas ---------- */
  function mostrar(tab) {
    if (tab !== "sim" && !document.getElementById("tab-" + tab)) tab = "sim";
    const wrap = $("tabs-nav").parentNode;
    [...wrap.children].forEach(n => {
      if (n.tagName === "HEADER" || n.tagName === "FOOTER" || n.id === "tabs-nav") return;
      const esPanel = !!n.id && n.id.startsWith("tab-");
      n.classList.toggle("fuera", tab === "sim" ? esPanel : n.id !== "tab-" + tab);
    });
    document.querySelectorAll("#tabs-nav button").forEach(b => {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.className = "px-4 py-2 rounded-full text-sm font-semibold border transition " + (on ? "bg-sky-500/20 text-sky-300 border-sky-500/50" : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500");
    });
    dibujar(tab);
  }
  function dibujar(tab) {
    if (tab === "comp" && D && HISTD) comparacion();
    if (tab === "region" && D && window.ModeloMazar) region();
    if (window.GEN) window.GEN.dibujar(tab);   // pestañas de generación y clima (generacion.js)
  }
  const actual = () => (location.hash || "").replace("#", "") || "sim";

  /* ---------- plugin: franjas horizontales/verticales ---------- */
  const franjas = {
    id: "franjas",
    beforeDatasetsDraw(chart, args, o) {
      const { ctx, chartArea: a, scales: { x, y } } = chart;
      ctx.save();
      (o.h || []).forEach(b => { const y1 = y.getPixelForValue(b.de), y2 = y.getPixelForValue(b.a); ctx.fillStyle = b.color; ctx.fillRect(a.left, Math.min(y1, y2), a.right - a.left, Math.abs(y2 - y1)); });
      (o.v || []).forEach(b => {
        const x1 = Math.max(a.left, x.getPixelForValue(b.de)), x2 = Math.min(a.right, x.getPixelForValue(b.a));
        ctx.fillStyle = b.color; ctx.fillRect(x1, a.top, x2 - x1, a.bottom - a.top);
        if (b.txt) { ctx.fillStyle = b.txtColor; ctx.font = "600 11px Inter, sans-serif"; ctx.fillText(b.txt, x1 + 6, a.top + 14); }
      });
      (o.lin || []).forEach(l => {
        const yy = y.getPixelForValue(l.v); ctx.strokeStyle = l.color; ctx.lineWidth = l.w || 1.5; ctx.setLineDash(l.dash || []);
        ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = l.color; ctx.font = "600 11px Inter, sans-serif"; ctx.fillText(l.txt, a.left + 6, yy + (l.abajo ? 14 : -5));
      });
      if (o.hoy != null) {
        const xx = x.getPixelForValue(o.hoy); ctx.strokeStyle = "rgba(148,163,184,.6)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xx, a.top); ctx.lineTo(xx, a.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.slate; ctx.font = "11px Inter, sans-serif"; ctx.fillText("hoy", xx + 4, a.top + 12);
      }
      ctx.restore();
    }
  };
  const opciones = (yMin, yMax, extra) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: "#0f172a", titleColor: "#f8fafc", bodyColor: "#cbd5e1", borderColor: "#334155", borderWidth: 1,
        filter: i => i.parsed.y != null && !i.dataset.sinTip,
        callbacks: { label: c => c.dataset.label + ": " + f(c.parsed.y, 2) + " m" } },
      franjas: extra
    },
    scales: {
      x: { grid: { color: "rgba(51, 65, 85, 0.25)" }, ticks: { color: C.slate, font: { size: 10 }, autoSkip: true, maxRotation: 0, autoSkipPadding: 14 } },
      y: { min: yMin, max: yMax, grid: { color: C.grid }, ticks: { color: C.slate, font: { size: 11 }, callback: v => f(v) } }
    }
  });

  /* ---------- 2026 vs. años anteriores ---------- */
  const CORTES = {
    2023: [["2023-10-27", "2023-12-19"]],
    2024: [["2024-04-15", "2024-04-30"], ["2024-09-23", "2024-12-20"]],
  };
  const CORTES_TXT = {
    2023: "del 27 de octubre al 19 de diciembre de 2023",
    2024: "del 15 al 30 de abril y del 23 de septiembre al 20 de diciembre de 2024",
  };
  const ANIO0 = 2011;          // Mazar se llenó en 2010; desde 2011 opera con el embalse completo
  let cmpSel = "todos", cmpTodas = false;
  const hist = k => (HISTD && HISTD[k]) || (HISTV && HISTV[k]);
  const cH = k => { const v = hist(k); return v && v.c; };
  const DIAS = []; for (let d = new Date(2000, 6, 1); d <= new Date(2000, 11, 31); d.setDate(d.getDate() + 1)) DIAS.push(new Date(d));
  const LAB = DIAS.map(d => d.getDate() + " " + MON[d.getMonth()]);
  const valAnio = y => DIAS.map(d => cH(iso(new Date(y, d.getMonth(), d.getDate()))) || null);
  const PUNTO = '<span class="inline-block w-2 h-2 rounded-full bg-rose-500 align-middle ml-1" title="hubo cortes de luz"></span>';
  const BTN = on => "px-3 py-1.5 rounded-lg text-xs font-semibold border transition " + (on ? "bg-sky-500/15 text-sky-200 border-sky-500/50" : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500");

  function aniosDisponibles(y0) {
    const out = [];
    for (let y = ANIO0; y < y0; y++) if (cH(iso(new Date(y, 6, 1))) || cH(iso(new Date(y, 6, 5)))) out.push(y);
    return out;
  }
  function subpestanas(y0) {
    const anios = aniosDisponibles(y0);
    const fijos = [y0 - 1, y0 - 2, y0 - 3].filter(y => anios.includes(y));
    const otros = anios.filter(y => !fijos.includes(y)).reverse();
    const sel = String(cmpSel);
    let h = `<button type="button" role="tab" data-anio="todos" aria-selected="${sel === "todos"}" class="${BTN(sel === "todos")}">Todos los años</button>`;
    h += fijos.map(y => `<button type="button" role="tab" data-anio="${y}" aria-selected="${sel === String(y)}" class="${BTN(sel === String(y))}">${y}${CORTES[y] ? PUNTO : ""}</button>`).join("");
    if (otros.length) {
      const on = otros.map(String).includes(sel);
      h += `<select id="cmp-otro" aria-label="Otro año" class="${BTN(on)} pr-2"><option value="">Más años…</option>` +
        otros.map(y => `<option value="${y}" ${sel === String(y) ? "selected" : ""}>${y}</option>`).join("") + `</select>`;
    }
    if (!HISTV) h += `<span class="text-[11px] text-slate-500">cargando 2011–2022…</span>`;
    $("cmp-sub").innerHTML = h;
    $("cmp-sub").querySelectorAll("button").forEach(b => b.onclick = () => { cmpSel = b.dataset.anio; comparacion(); });
    const s = $("cmp-otro"); if (s) s.onchange = () => { if (s.value) { cmpSel = s.value; comparacion(); } };
  }
  function base26(hoy, y0, cota) {
    const iHoy = DIAS.findIndex(d => d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate());
    const v26 = valAnio(y0).map((v, i) => i < iHoy ? v : (i === iHoy ? cota : null));
    const Rb = correrBase();
    const proy = DIAS.map(() => null);
    if (Rb && iHoy >= 0) Rb.daily.forEach(r => { const i = iHoy + Math.round(r.t); if (r.t <= 45 && Math.abs(r.t - Math.round(r.t)) < 1e-9 && i < DIAS.length) proy[i] = r.cota; });
    return { iHoy, v26, proy };
  }
  const ds26 = (y0, b) => [
    { label: String(y0), data: b.v26, borderColor: C.sky, borderWidth: 3, pointRadius: b.v26.map((v, i) => i === b.iHoy ? 5 : 0), pointBackgroundColor: C.sky, tension: .2, spanGaps: true },
    { label: "Proyección del simulador", data: b.proy, borderColor: C.sky, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .2, spanGaps: true }];
  const LIN_PARADA = { v: PARADA, color: C.rose, dash: [6, 4], txt: "parada de Mazar 2.115", abajo: true };
  const ley = (cls, txt) => `<span class="inline-flex items-center gap-1.5"><span class="${cls}"></span>${txt}</span>`;
  function pintar(data, todos, ex) {
    const yMin = Math.floor(Math.min(...todos, PARADA) - 3), yMax = Math.ceil(Math.max(...todos) + 1);
    if (chComp) chComp.destroy();
    chComp = new Chart($("cmp-chart").getContext("2d"), { type: "line", data: { labels: LAB, datasets: data }, options: opciones(yMin, yMax, ex), plugins: [franjas] });
  }
  function fechaHoy() { return D.sincronizado_con && D.sincronizado_con.cota_hora ? new Date(D.sincronizado_con.cota_hora) : new Date(); }

  function comparacion() {
    const hoy = fechaHoy(), y0 = hoy.getFullYear();
    subpestanas(y0);
    if (cmpSel === "todos") return comparacionTodos(hoy, y0);
    return comparacionAnio(hoy, y0, +cmpSel);
  }

  function comparacionAnio(hoy, y0, y) {
    const cota = D.cota_mazar;
    const mismo = new Date(y, hoy.getMonth(), hoy.getDate());
    const hace = (d, n) => { const x = new Date(d); x.setDate(x.getDate() - n); return iso(x); };
    const cy = cH(iso(mismo));
    const vy = valAnio(y);
    let igual = null;
    for (let i = 0; i < DIAS.length; i++) if (vy[i] != null && vy[i] <= cota) { igual = new Date(y, DIAS[i].getMonth(), DIAS[i].getDate()); break; }
    const ventaja = igual ? Math.round((mismo - igual) / 86400000) : null;
    let iMin = vy.findIndex(v => v != null); vy.forEach((v, i) => { if (v != null && v < vy[iMin]) iMin = i; });
    const bajo = vy.filter(v => v != null && v < PARADA).length;
    const b = base26(hoy, y0, cota);

    $("cmp-tit").textContent = `📅 2026 vs. ${y}` + (CORTES[y] ? ", un año con cortes" : "");
    let txt = `Hoy Mazar está <b class="text-white">${f(Math.abs(cota - cy), 1)} m ${cota >= cy ? "más arriba" : "más abajo"}</b> que el mismo día de ${y}. `;
    if (igual && ventaja > 0) txt += `La cota de hoy es la que tenía el <b class="text-white">${igual.getDate()} de ${MESL[igual.getMonth()]} de ${y}</b>: llevamos unos <b class="text-sky-300">${ventaja} días de ventaja</b>${ventaja >= 14 ? ` (unas ${Math.round(ventaja / 7)} semanas)` : ""}.`;
    else if (igual && ventaja < 0) txt += `En ${y} Mazar llegó a la cota de hoy recién el <b class="text-white">${igual.getDate()} de ${MESL[igual.getMonth()]}</b>: este año vamos <b class="text-rose-300">${-ventaja} días adelantados</b> hacia el mínimo.`;
    else if (!igual) txt += `En ${y} Mazar <b class="text-white">nunca bajó a la cota de hoy</b> entre julio y diciembre: su mínimo fue ${f(vy[iMin], 1)} m.`;
    $("cmp-txt").innerHTML = txt;

    const c7 = cH(hace(hoy, 7)), c30 = cH(hace(hoy, 30)), cy7 = cH(hace(mismo, 7)), cy30 = cH(hace(mismo, 30));
    const filas = [["Cota (m s.n.m.)", f(cota, 2), f(cy, 2)],
      ["Sobre la parada de Mazar (2.115)", sgn(cota - PARADA, 2) + " m", sgn(cy - PARADA, 2) + " m"],
      ["Cambio en 7 días", c7 ? sgn(cota - c7) + " m" : "–", cy7 ? sgn(cy - cy7) + " m" : "–"],
      ["Cambio en 30 días", c30 ? sgn(cota - c30) + " m" : "–", cy30 ? sgn(cy - cy30) + " m" : "–"]];
    $("cmp-tbl").innerHTML = `<tr class="text-[11px] uppercase tracking-wider text-slate-500"><th class="text-left py-1.5"></th><th class="text-right py-1.5">Hoy</th><th class="text-right py-1.5">Mismo día ${y}</th></tr>` +
      filas.map(r => `<tr class="border-t border-slate-800"><td class="py-2 text-slate-300">${r[0]}</td><td class="py-2 text-right mono text-sky-300 font-bold whitespace-nowrap">${r[1]}</td><td class="py-2 text-right mono text-amber-300 whitespace-nowrap">${r[2]}</td></tr>`).join("");
    const mm = new Date(y, DIAS[iMin].getMonth(), DIAS[iMin].getDate());
    const cortesTxt = CORTES_TXT[y] ? ` Los cortes de luz nacionales fueron ${CORTES_TXT[y]}.` : ` En ${y} no hubo cortes de luz nacionales.`;
    $("cmp-nota").innerHTML = `En ${y} la cota llegó a <b class="text-amber-300">${f(vy[iMin], 2)} m el ${mm.getDate()} de ${MESL[mm.getMonth()]}</b>` +
      (bajo ? ` y pasó <b class="text-slate-200">${bajo} días</b> por debajo de 2.115 entre julio y diciembre.` : `; no bajó de 2.115 entre julio y diciembre.`) +
      cortesTxt + ` Cotas diarias de Celec Sur; la de hoy es la lectura de las ${String(hoy.getHours()).padStart(2, "0")}:00.`;
    $("cmp-ley").innerHTML = ley("w-4 h-[3px] rounded bg-sky-400", y0) + ley("w-4 border-t-2 border-dashed border-sky-400", "proyección del simulador") +
      ley("w-4 h-[3px] rounded bg-amber-500", y) + (CORTES[y] ? ley("w-3 h-3 rounded-sm bg-rose-500/20", `cortes de luz ${y}`) : "");

    // franjas de cortes dentro de jul–dic (los de abril de 2024 quedan fuera del gráfico)
    const k = d => iso(new Date(y, d.getMonth(), d.getDate()));
    const v = (CORTES[y] || []).filter(([a, bb]) => bb >= `${y}-07-01`).map(([a, bb]) => {
      const ia = DIAS.findIndex(d => k(d) >= a), ib = DIAS.findIndex(d => k(d) >= bb);
      return { de: Math.max(0, ia), a: ib < 0 ? DIAS.length - 1 : ib, color: "rgba(244, 63, 94, 0.09)", txt: `cortes de luz ${y}`, txtColor: "#fb7185" };
    });
    const data = ds26(y0, b).concat([{ label: String(y), data: vy, borderColor: C.amber, borderWidth: 2.2, pointRadius: vy.map((x, i) => i === iMin ? 5 : 0), pointBackgroundColor: C.amber, tension: .2, spanGaps: true }]);
    pintar(data, vy.concat(b.v26, b.proy).filter(x => x != null), { v, lin: [LIN_PARADA] });
  }

  function comparacionTodos(hoy, y0) {
    const cota = D.cota_mazar;
    const anios = aniosDisponibles(y0);
    const series = {}; anios.forEach(y => series[y] = valAnio(y));
    const lo = [], hi = [], med = [];
    DIAS.forEach((d, i) => {
      const vs = anios.map(y => series[y][i]).filter(x => x != null).sort((a, b) => a - b);
      lo.push(vs.length >= 3 ? vs[0] : null); hi.push(vs.length >= 3 ? vs[vs.length - 1] : null); med.push(vs.length >= 3 ? vs[Math.floor(vs.length / 2)] : null);
    });
    const hoyD = anios.map(y => [y, cH(iso(new Date(y, hoy.getMonth(), hoy.getDate())))]).filter(p => p[1]);
    const masBajos = hoyD.filter(p => p[1] < cota).sort((a, b) => a[1] - b[1]);
    const prom = hoyD.reduce((a, p) => a + p[1], 0) / hoyD.length;
    const n = hoyD.length + 1, pos = masBajos.length + 1;
    const b = base26(hoy, y0, cota);

    $("cmp-tit").textContent = `📅 2026 vs. ${anios[0]}–${anios[anios.length - 1]}`;
    let txt = `Para un ${hoy.getDate()} de ${MESL[hoy.getMonth()]}, Mazar está hoy <b class="text-white">${f(Math.abs(cota - prom), 1)} m ${cota >= prom ? "por encima" : "por debajo"} del promedio</b> de ${hoyD.length} años (${f(prom, 1)} m). `;
    if (!masBajos.length) txt += `<b class="text-rose-300">Es la cota más baja</b> para esta fecha desde ${anios[0]}.`;
    else txt += `Es la <b class="text-sky-300">${pos}.ª más baja de ${n}</b> para esta fecha: solo ${masBajos.length === 1 ? "estuvo más abajo" : "estuvieron más abajo"} <b class="text-white">${masBajos.map(p => p[0]).join(", ")}</b>.`;
    $("cmp-txt").innerHTML = txt;

    const resumen = y => {
      const s = series[y]; let iM = s.findIndex(x => x != null); s.forEach((x, i) => { if (x != null && x < s[iM]) iM = i; });
      return { min: s[iM], d: DIAS[iM], bajo: s.filter(x => x != null && x < PARADA).length };
    };
    const orden = anios.slice().sort((a, b) => { const ca = hoyD.find(p => p[0] === a), cb = hoyD.find(p => p[0] === b); return (ca ? ca[1] : 1e9) - (cb ? cb[1] : 1e9); });
    const filas = orden.map((y, k) => {
      const r = resumen(y), hc = hoyD.find(p => p[0] === y);
      return `<tr class="border-t border-slate-800 ${k >= 5 ? "cmp-extra hidden" : ""}"><td class="py-2 text-slate-300 whitespace-nowrap">${y}${CORTES[y] ? PUNTO : ""}</td><td class="py-2 text-right mono text-amber-300">${hc ? f(hc[1], 1) : "–"}</td><td class="py-2 text-right mono text-slate-300 whitespace-nowrap">${f(r.min, 1)} <span class="text-slate-500 text-xs">(${r.d.getDate()} ${MON[r.d.getMonth()]})</span></td><td class="py-2 text-right mono text-slate-300">${r.bajo || "–"}</td></tr>`;
    });
    $("cmp-tbl").innerHTML = `<tr class="text-[11px] uppercase tracking-wider text-slate-500"><th class="text-left py-1.5">Año</th><th class="text-right py-1.5">Cota el ${hoy.getDate()} ${MON[hoy.getMonth()]}</th><th class="text-right py-1.5">Mínimo jul–dic</th><th class="text-right py-1.5">Días bajo 2.115</th></tr>` +
      `<tr class="border-t border-slate-800 bg-sky-500/10"><td class="py-2 text-white font-bold">${y0}</td><td class="py-2 text-right mono text-sky-300 font-bold">${f(cota, 1)}</td><td class="py-2 text-right text-slate-500">–</td><td class="py-2 text-right text-slate-500">–</td></tr>` + filas.join("") +
      `<tr><td colspan="4" class="pt-3"><button type="button" id="cmp-ver" class="${BTN(false)} text-sky-300"></button></td></tr>`;
    const poner = () => { $("cmp-tbl").querySelectorAll(".cmp-extra").forEach(t => t.classList.toggle("hidden", !cmpTodas)); $("cmp-ver").textContent = cmpTodas ? "Ver solo los 5 más bajos" : `Ver los ${anios.length} años`; };
    $("cmp-ver").onclick = () => { cmpTodas = !cmpTodas; poner(); }; poner();
    $("cmp-nota").innerHTML = `La tabla ordena los años de la cota más baja a la más alta para esta fecha. La franja gris va de la cota más baja a la más alta que tuvo Mazar cada día entre ${anios[0]} y ${anios[anios.length - 1]}; la línea gris es la mediana. Los años con ${PUNTO} tuvieron cortes de luz nacionales: 2023 (27 oct–19 dic) y 2024 (15–30 abr y 23 sep–20 dic). 2010 no se incluye porque Mazar todavía se estaba llenando. Cotas diarias de Celec Sur.`;
    $("cmp-ley").innerHTML = ley("w-4 h-[3px] rounded bg-sky-400", y0) + ley("w-4 border-t-2 border-dashed border-sky-400", "proyección del simulador") +
      ley("w-3 h-3 rounded-sm bg-slate-500/30", `rango ${anios[0]}–${anios[anios.length - 1]}`) + ley("w-4 h-[3px] rounded bg-slate-400", "mediana") +
      ley("w-4 h-[3px] rounded bg-amber-500", "2024") + ley("w-4 h-[3px] rounded bg-rose-500", "2023");
    const sinP = { pointRadius: 0, tension: .2, spanGaps: true, sinTip: true };
    const data = [
      Object.assign({ label: "máx.", data: hi, borderColor: "transparent", borderWidth: 0, fill: false }, sinP),
      Object.assign({ label: "mín.", data: lo, borderColor: "transparent", borderWidth: 0, fill: "-1", backgroundColor: "rgba(148,163,184,0.16)" }, sinP),
      { label: "Mediana", data: med, borderColor: "rgba(148,163,184,.8)", borderWidth: 1.6, pointRadius: 0, tension: .2, spanGaps: true },
    ];
    if (series[2023]) data.push({ label: "2023", data: series[2023], borderColor: "rgba(244,63,94,.8)", borderWidth: 1.6, pointRadius: 0, tension: .2, spanGaps: true });
    if (series[2024]) data.push({ label: "2024", data: series[2024], borderColor: "rgba(245,158,11,.85)", borderWidth: 1.6, pointRadius: 0, tension: .2, spanGaps: true });
    pintar(ds26(y0, b).concat(data), lo.concat(hi, b.v26, b.proy).filter(x => x != null), { lin: [LIN_PARADA] });
  }

  /* ---------- Región de proyección (mismo cálculo que la pestaña principal con los datos del día) ---------- */
  function correr(qCoca, wCoca, extra) {
    const d = D, M = d.modelo || {};
    const sobre = Math.max(0, Math.round((d.temp_costa_c - 28.0) * 49));
    const firme = d.generacion_firme_mw || 2500;
    const sep = d.termica_mw != null && d.otras_hidro_mw != null && Math.abs(firme - (d.termica_mw + d.otras_hidro_mw)) < 5;
    const qC0 = d.caudal_coca, ccs0 = Math.min(1350, Math.round(qC0 * 4.79));
    const ctx = Object.assign({ cota: d.cota_mazar, inicio: new Date(), diaSemana0: M.diaSemana0, amaluzaCota: M.amaluzaCota, amaluzaRitmo: M.amaluzaRitmo,
      deltaDia: M.deltaDia, cutDias: M.cutDias, cutPlan: M.cutPlan, ajuste: M.ajuste, serieMazar: M.serieMazar, serieCoca: M.serieCoca, memoria: M.memoria, horizonte: 60 }, extra || {});
    return ModeloMazar.simular({ qMazar: d.caudal_mazar, qCoca, wPaute: d.lluvia_paute || "auto", wCoca, demanda: d.demanda_base_mw + sobre, cut: d.cortes_mw,
      imp: d.importacion_colombia_mw, therm: sep ? d.termica_mw : firme, other: sep ? d.otras_hidro_mw : 0,
      ccsFn: d.coca_codo_mw ? null : (q => Math.min(1200, ccs0 * q / qC0)) }, ctx);
  }
  function correrBase() { if (!D || !window.ModeloMazar) return null; ModeloMazar.configurar(D.modelo); return correr(D.caudal_coca, D.lluvia_coca || "auto"); }
  // Escenarios de la región (Coca × Paute) para el panel de cortes de la pestaña principal
  function escenariosRegion() {
    const M = D.modelo || {}, q = D.caudal_coca, q15 = Math.round(q * 0.85), uno = new Array(61).fill(1);
    ModeloMazar.configurar(D.modelo);
    const coca = [{ q, w: D.lluvia_coca || "auto", ex: {} }, { q, w: "auto", ex: { serieCoca: uno } }, { q: q15, w: "auto", ex: { serieCoca: uno } }];
    const paute = [{}];
    if (M.serieMazarSeca) paute.push({ serieMazar: M.serieMazarSeca });
    const out = [];
    for (const c of coca) for (const p of paute) out.push(correr(c.q, c.w, Object.assign({}, c.ex, p)));
    return out;
  }
  function publicarEscenarios() {
    try { if (!D || !window.ModeloMazar) return; window.ESC_CORTES = escenariosRegion(); if (window.pintarCortes) window.pintarCortes(); } catch (e) { }
  }
  function region() {
    const M = D.modelo || {}, q = D.caudal_coca, q15 = Math.round(q * 0.85), uno = new Array(61).fill(1), cota = D.cota_mazar, hoy = new Date();
    ModeloMazar.configurar(D.modelo);
    const coca = [{ id: "pron", txt: "sube como pronostica GloFAS", q, w: D.lluvia_coca || "auto", ex: {} },
      { id: "const", txt: `se queda en ${f(q)} m³/s (hoy)`, q, w: "auto", ex: { serieCoca: uno } },
      { id: "baja", txt: `baja 15 % (${q15} m³/s)`, q: q15, w: "auto", ex: { serieCoca: uno } }];
    const paute = [{ id: "lluvia", txt: "lluvia pronosticada", ex: {} }];
    if (M.serieMazarSeca) paute.push({ id: "seca", txt: "semana seca como la anterior", ex: { serieMazar: M.serieMazarSeca } });
    const E = [];
    for (const c of coca) for (const p of paute) { const R = correr(c.q, c.w, Object.assign({}, c.ex, p.ex)); E.push({ coca: c, paute: p, R, Z: ModeloMazar.zonaCritica(R, cota), principal: c.id === "pron" && p.id === "lluvia", sombra: false }); }
    if (M.serieCocaRio) {
      const R_somb = correr(q, "auto", { serieCoca: M.serieCocaRio });
      E.push({
        coca: { id: "sombra", txt: "modelo con el ajuste del río Coca (próximo a ser incorporado)", q, w: "auto", ex: { serieCoca: M.serieCocaRio } },
        paute: { id: "lluvia", txt: "lluvia pronosticada", ex: {} },
        R: R_somb,
        Z: ModeloMazar.zonaCritica(R_somb, cota),
        principal: false,
        sombra: true
      });
    }
    const fecha = t => { const d = new Date(hoy.getTime() + t * 86400000); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
    const conE = E.filter(e => e.Z.entrada !== null).sort((a, b) => a.Z.entrada - b.Z.entrada);
    const pr = E.find(e => e.principal), temprano = conE[0], tarde = E.some(e => e.Z.entrada === null) ? null : conE[conE.length - 1];
    $("reg-temprano").textContent = temprano ? fecha(temprano.Z.entrada) : "no entra";
    $("reg-temprano-txt").textContent = temprano ? `Coca ${temprano.coca.txt.replace(" (hoy)", "")} y ${temprano.paute.txt}` : "en ningún escenario en 60 días";
    const NUM = (M.prediccion || {}).numero;   // mismo número grande que la pestaña principal
    const t0n = D.sincronizado_con && D.sincronizado_con.cota_hora ? new Date(D.sincronizado_con.cota_hora) : hoy;
    const fechaN = t => { const d = new Date(t0n.getTime() + t * 86400000); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
    $("reg-prin").textContent = NUM ? (NUM.critica.dias >= 59 ? "más de 60 días" : fechaN(NUM.critica.dias)) : (pr.Z.entrada !== null ? fecha(pr.Z.entrada) : "más de 60 días");
    if (NUM) { $("reg-prin-txt").textContent = "Igual que el número grande: promedio ponderado de las corridas de las últimas 48 h"; $("reg-tarde-box").classList.remove("fuera"); }
    const mismo = tarde && tarde === pr;
    $("reg-tarde-box").classList.toggle("fuera", !!mismo);
    $("reg-prin-txt").textContent = "Coca según GloFAS y lluvia pronosticada en el Paute" + (mismo ? ". Hoy es también el escenario más favorable." : "");
    $("reg-tarde").textContent = tarde ? fecha(tarde.Z.entrada) : "más de 60 días";
    $("reg-tarde-txt").textContent = tarde ? `Coca ${tarde.coca.txt} y ${tarde.paute.txt}` : "algún escenario no llega a 2.116 en 60 días";
    $("reg-tbl").innerHTML = `<tr class="text-[11px] uppercase tracking-wider text-slate-500"><th class="text-left py-1.5">Escenario</th><th class="text-right py-1.5">Entra a 2.116</th><th class="text-right py-1.5">Llega a 2.115</th></tr>` +
      E.map(e => {
        const z = e.Z, mn = z.minimo;
        const para = e.R.crossDay !== null && z.paradaEnVentana ? fecha(e.R.crossDay) : (mn ? "no (mín. " + f(mn.cota, 1) + ")" : "no");
        const esSomb = e.sombra;
        const titEsc = esSomb ? `<span class="text-purple-300 font-semibold">${e.coca.txt}</span>` : `Coca ${e.coca.txt}`;
        const subEsc = esSomb ? `<div class="text-xs text-purple-400 font-normal">Paute: ${e.paute.txt} · Caudal real con tope 1.200 MW</div>` : `<div class="text-xs text-slate-500 font-normal">Paute: ${e.paute.txt}</div>${e.principal ? '<div class="text-xs text-sky-400">proyección del simulador</div>' : ""}`;
        return `<tr class="border-t ${esSomb ? "border-purple-900/50 bg-purple-950/20" : "border-slate-800"} ${e.principal ? "font-semibold" : ""}"><td class="py-2 ${esSomb ? "text-purple-200" : "text-slate-200"}">${titEsc}${subEsc}</td><td class="py-2 text-right mono whitespace-nowrap ${esSomb ? "text-purple-300 font-semibold" : (z.entrada !== null && z.entrada < 14 ? "text-rose-300" : "text-amber-300")}">${z.entrada === null ? "más de 60 días" : fecha(z.entrada)}</td><td class="py-2 pl-3 text-right mono ${esSomb ? "text-purple-300 font-semibold" : "text-slate-300"}">${para}</td></tr>`;
      }).join("");

    // gráfico: 20 días de historia + 45 de región
    const HZ = 45, P0 = 20, lab = [];
    for (let t = -P0; t <= HZ; t++) { const d = new Date(hoy.getTime() + t * 86400000); lab.push(d.getDate() + " " + MON[d.getMonth()]); }
    const hist = new Array(lab.length).fill(null);
    if (HISTD) for (let t = -P0; t < 0; t++) { const v = HISTD[iso(new Date(hoy.getTime() + t * 86400000))]; if (v && v.c) hist[t + P0] = v.c; }
    hist[P0] = cota;
    const serie = e => { const out = new Array(lab.length).fill(null); e.R.daily.forEach(r => { if (r.t <= HZ && Math.abs(r.t - Math.round(r.t)) < 1e-9) out[P0 + Math.round(r.t)] = r.cota; }); return out; };
    const S = E.map(serie);
    const sup = lab.map((_, i) => i < P0 ? null : Math.max(...S.map(s => s[i]))), inf = lab.map((_, i) => i < P0 ? null : Math.min(...S.map(s => s[i])));
    const todos = S.flat().concat(hist).filter(v => v != null);
    const yMin = Math.min(2113, Math.floor(Math.min(...todos)) - 1), yMax = Math.ceil(Math.max(...todos)) + 1;
    const ds = [
      { label: "Máximo de la región", data: sup, borderColor: "rgba(56,189,248,.5)", borderWidth: 1, pointRadius: 0, fill: "+1", backgroundColor: "rgba(56,189,248,.16)", tension: .2, sinTip: false },
      { label: "Mínimo de la región", data: inf, borderColor: "rgba(56,189,248,.5)", borderWidth: 1, pointRadius: 0, fill: false, tension: .2 },
      ...E.filter(e => !e.principal && !e.sombra).map(e => ({ label: `Coca ${e.coca.txt.replace(/ \(.*\)/, "")} · ${e.paute.txt}`, data: serie(e), borderColor: "rgba(203,213,225,.35)", borderWidth: 1, borderDash: [2, 4], pointRadius: 0, fill: false, tension: .2, sinTip: true })),
      ...(E.filter(e => e.sombra).map(e => ({ label: e.coca.txt, data: serie(e), borderColor: "#c084fc", borderWidth: 2.2, borderDash: [5, 3], pointRadius: 0, fill: false, tension: .2, sinTip: false }))),
      { label: "Proyección del simulador", data: serie(pr), borderColor: C.sky, borderWidth: 3, pointRadius: 0, fill: false, tension: .2 },
      { label: "Medido (Celec Sur)", data: hist, borderColor: "rgba(226,232,240,.6)", borderWidth: 1.5, pointRadius: 3, pointBackgroundColor: C.ink, fill: false, spanGaps: true }];
    const ex = { h: [{ de: PARADA, a: ZC, color: "rgba(245,158,11,.10)" }, { de: yMin, a: PARADA, color: "rgba(244,63,94,.08)" }],
      lin: [{ v: ZC, color: C.amber, dash: [6, 4], txt: "zona crítica 2.116" }, { v: PARADA, color: C.rose, w: 2, txt: "parada de Mazar 2.115", abajo: true }], hoy: P0 };
    if (chReg) chReg.destroy();
    chReg = new Chart($("reg-chart").getContext("2d"), { type: "line", data: { labels: lab, datasets: ds }, options: opciones(yMin, yMax, ex), plugins: [franjas] });
  }

  /* ---------- arranque ---------- */
  async function historial(urls = HIST_URLS) {
    for (const u of urls) { try { const r = await fetch(u, { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) { } }
    return null;
  }
  function iniciar() {
    document.querySelectorAll("#tabs-nav button").forEach(b => b.addEventListener("click", () => {
      const t = b.dataset.tab;
      history.replaceState(null, "", t === "sim" ? location.pathname + location.search : "#" + t);
      mostrar(t);
      window.scrollTo({ top: $("tabs-nav").offsetTop - 8 });
    }));
    window.addEventListener("hashchange", () => mostrar(actual()));
    mostrar(actual());
    fetch("./datos_sni.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(j => { if (j && j.cota_mazar) { D = j; dibujar(actual()); publicarEscenarios(); } }).catch(() => { });
    historial().then(j => { if (j) { HISTD = j; dibujar(actual()); } });
    historial(HISTV_URLS).then(j => { if (j) { HISTV = j; dibujar(actual()); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
