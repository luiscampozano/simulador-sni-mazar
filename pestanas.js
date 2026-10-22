/* Pestañas "2026 vs. 2024" y "Región de proyección" del simulador "Proyección del embalse Mazar".
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
  const CORTES24 = ["2024-09-23", "2024-12-20"];   // cortes de luz nacionales de 2024
  const ZC = 2116, PARADA = 2115;
  const C = { sky: "#38bdf8", amber: "#f59e0b", rose: "#f43f5e", emerald: "#10b981", slate: "#94a3b8", grid: "rgba(51, 65, 85, 0.3)", ink: "#e2e8f0" };
  let D = null, HISTD = null, chComp = null, chReg = null;

  /* ---------- pestañas ---------- */
  function mostrar(tab) {
    if (!["sim", "comp", "region"].includes(tab)) tab = "sim";
    const wrap = $("tabs-nav").parentNode;
    [...wrap.children].forEach(n => {
      if (n.tagName === "HEADER" || n.tagName === "FOOTER" || n.id === "tabs-nav") return;
      const esPanel = n.id === "tab-comp" || n.id === "tab-region";
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

  /* ---------- 2026 vs. 2024 ---------- */
  function comparacion() {
    const cota = D.cota_mazar;
    const hoy = D.sincronizado_con && D.sincronizado_con.cota_hora ? new Date(D.sincronizado_con.cota_hora) : new Date();
    const y0 = hoy.getFullYear();
    const c = k => HISTD[k] && HISTD[k].c;
    const mismo24 = new Date(2024, hoy.getMonth(), hoy.getDate());
    const hace = (d, n) => { const x = new Date(d); x.setDate(x.getDate() - n); return iso(x); };
    const c24 = c(iso(mismo24));
    const dias = []; for (let d = new Date(2000, 6, 1); d <= new Date(2000, 11, 31); d.setDate(d.getDate() + 1)) dias.push(new Date(d));
    const lab = dias.map(d => d.getDate() + " " + MON[d.getMonth()]);
    const val = y => dias.map(d => c(iso(new Date(y, d.getMonth(), d.getDate()))) || null);
    const v24 = val(2024);
    const iHoy = dias.findIndex(d => d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate());
    const v26 = val(y0).map((v, i) => i < iHoy ? v : (i === iHoy ? cota : null));
    let igual = null;
    for (let i = 0; i < dias.length; i++) if (v24[i] != null && v24[i] <= cota) { igual = new Date(2024, dias[i].getMonth(), dias[i].getDate()); break; }
    const ventaja = igual ? Math.round((mismo24 - igual) / 86400000) : null;
    let iMin = 0; v24.forEach((v, i) => { if (v != null && v < v24[iMin]) iMin = i; });
    const bajo = v24.filter(v => v != null && v < PARADA).length;

    // proyección del simulador desde hoy
    const Rb = correrBase();
    const proy = dias.map(() => null);
    if (Rb && iHoy >= 0) Rb.daily.forEach(r => { const i = iHoy + Math.round(r.t); if (r.t <= 45 && Math.abs(r.t - Math.round(r.t)) < 1e-9 && i < dias.length) proy[i] = r.cota; });

    let txt = `Hoy Mazar está <b class="text-white">${f(Math.abs(cota - c24), 1)} m ${cota >= c24 ? "más arriba" : "más abajo"}</b> que el mismo día de 2024. `;
    if (igual && ventaja > 0) txt += `La cota de hoy es la que tenía el <b class="text-white">${igual.getDate()} de ${MESL[igual.getMonth()]} de 2024</b>: llevamos unos <b class="text-sky-300">${ventaja} días de ventaja</b> (unas ${Math.round(ventaja / 7)} semanas).`;
    else if (igual && ventaja < 0) txt += `En 2024 Mazar llegó a la cota de hoy recién el <b class="text-white">${igual.getDate()} de ${MESL[igual.getMonth()]}</b>: este año vamos <b class="text-rose-300">${-ventaja} días adelantados</b> hacia el mínimo.`;
    $("cmp-txt").innerHTML = txt;

    const c26_7 = c(hace(hoy, 7)), c26_30 = c(hace(hoy, 30)), c24_7 = c(hace(mismo24, 7)), c24_30 = c(hace(mismo24, 30));
    const filas = [["Cota (m s.n.m.)", f(cota, 2), f(c24, 2)],
      ["Sobre la parada de Mazar (2.115)", sgn(cota - PARADA, 2) + " m", sgn(c24 - PARADA, 2) + " m"],
      ["Cambio en 7 días", c26_7 ? sgn(cota - c26_7) + " m" : "–", c24_7 ? sgn(c24 - c24_7) + " m" : "–"],
      ["Cambio en 30 días", c26_30 ? sgn(cota - c26_30) + " m" : "–", c24_30 ? sgn(c24 - c24_30) + " m" : "–"]];
    $("cmp-tbl").innerHTML = `<tr class="text-[11px] uppercase tracking-wider text-slate-500"><th class="text-left py-1.5"></th><th class="text-right py-1.5">Hoy</th><th class="text-right py-1.5">Mismo día 2024</th></tr>` +
      filas.map(r => `<tr class="border-t border-slate-800"><td class="py-2 text-slate-300">${r[0]}</td><td class="py-2 text-right mono text-sky-300 font-bold whitespace-nowrap">${r[1]}</td><td class="py-2 text-right mono text-amber-300 whitespace-nowrap">${r[2]}</td></tr>`).join("");
    const m24 = new Date(2024, dias[iMin].getMonth(), dias[iMin].getDate());
    $("cmp-nota").innerHTML = `En 2024 la cota llegó a <b class="text-amber-300">${f(v24[iMin], 2)} m el ${m24.getDate()} de ${MESL[m24.getMonth()]}</b> y pasó <b class="text-slate-200">${bajo} días</b> por debajo de 2.115 entre julio y diciembre. Los cortes de luz nacionales fueron del 23 de septiembre al 20 de diciembre de 2024. Cotas diarias de Celec Sur; la de hoy es la lectura de las ${String(hoy.getHours()).padStart(2, "0")}:00.`;

    const todos = v24.concat(v26, proy).filter(v => v != null);
    const yMin = Math.floor(Math.min(...todos, PARADA) - 3), yMax = Math.ceil(Math.max(...todos) + 1);
    const ia = dias.findIndex(d => iso(new Date(2024, d.getMonth(), d.getDate())) === CORTES24[0]);
    const ib = dias.findIndex(d => iso(new Date(2024, d.getMonth(), d.getDate())) === CORTES24[1]);
    const data = { labels: lab, datasets: [
      { label: "2026", data: v26, borderColor: C.sky, borderWidth: 3, pointRadius: v26.map((v, i) => i === iHoy ? 5 : 0), pointBackgroundColor: C.sky, tension: .2, spanGaps: true },
      { label: "Proyección del simulador", data: proy, borderColor: C.sky, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .2, spanGaps: true },
      { label: "2024", data: v24, borderColor: C.amber, borderWidth: 2.2, pointRadius: v24.map((v, i) => i === iMin ? 5 : 0), pointBackgroundColor: C.amber, tension: .2, spanGaps: true }] };
    const ex = { v: [{ de: ia, a: ib, color: "rgba(244, 63, 94, 0.09)", txt: "cortes de luz 2024", txtColor: "#fb7185" }],
      lin: [{ v: PARADA, color: C.rose, dash: [6, 4], txt: "parada de Mazar 2.115", abajo: true }] };
    if (chComp) chComp.destroy();
    chComp = new Chart($("cmp-chart").getContext("2d"), { type: "line", data, options: opciones(yMin, yMax, ex), plugins: [franjas] });
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
  function region() {
    const M = D.modelo || {}, q = D.caudal_coca, q15 = Math.round(q * 0.85), uno = new Array(61).fill(1), cota = D.cota_mazar, hoy = new Date();
    ModeloMazar.configurar(D.modelo);
    const coca = [{ id: "pron", txt: "sube como pronostica GloFAS", q, w: D.lluvia_coca || "auto", ex: {} },
      { id: "const", txt: `se queda en ${f(q)} m³/s (hoy)`, q, w: "auto", ex: { serieCoca: uno } },
      { id: "baja", txt: `baja 15 % (${q15} m³/s)`, q: q15, w: "auto", ex: { serieCoca: uno } }];
    const paute = [{ id: "lluvia", txt: "lluvia pronosticada", ex: {} }];
    if (M.serieMazarSeca) paute.push({ id: "seca", txt: "semana seca como la anterior", ex: { serieMazar: M.serieMazarSeca } });
    const E = [];
    for (const c of coca) for (const p of paute) { const R = correr(c.q, c.w, Object.assign({}, c.ex, p.ex)); E.push({ coca: c, paute: p, R, Z: ModeloMazar.zonaCritica(R, cota), principal: c.id === "pron" && p.id === "lluvia" }); }
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
        return `<tr class="border-t border-slate-800 ${e.principal ? "font-semibold" : ""}"><td class="py-2 text-slate-200">Coca ${e.coca.txt}<div class="text-xs text-slate-500 font-normal">Paute: ${e.paute.txt}</div>${e.principal ? '<div class="text-xs text-sky-400">proyección del simulador</div>' : ""}</td><td class="py-2 text-right mono whitespace-nowrap ${z.entrada !== null && z.entrada < 14 ? "text-rose-300" : "text-amber-300"}">${z.entrada === null ? "más de 60 días" : fecha(z.entrada)}</td><td class="py-2 pl-3 text-right mono text-slate-300">${para}</td></tr>`;
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
      ...E.filter(e => !e.principal).map(e => ({ label: `Coca ${e.coca.txt.replace(/ \(.*\)/, "")} · ${e.paute.txt}`, data: serie(e), borderColor: "rgba(203,213,225,.35)", borderWidth: 1, borderDash: [2, 4], pointRadius: 0, fill: false, tension: .2, sinTip: true })),
      { label: "Proyección del simulador", data: serie(pr), borderColor: C.sky, borderWidth: 3, pointRadius: 0, fill: false, tension: .2 },
      { label: "Medido (Celec Sur)", data: hist, borderColor: "rgba(226,232,240,.6)", borderWidth: 1.5, pointRadius: 3, pointBackgroundColor: C.ink, fill: false, spanGaps: true }];
    const ex = { h: [{ de: PARADA, a: ZC, color: "rgba(245,158,11,.10)" }, { de: yMin, a: PARADA, color: "rgba(244,63,94,.08)" }],
      lin: [{ v: ZC, color: C.amber, dash: [6, 4], txt: "zona crítica 2.116" }, { v: PARADA, color: C.rose, w: 2, txt: "parada de Mazar 2.115", abajo: true }], hoy: P0 };
    if (chReg) chReg.destroy();
    chReg = new Chart($("reg-chart").getContext("2d"), { type: "line", data: { labels: lab, datasets: ds }, options: opciones(yMin, yMax, ex), plugins: [franjas] });
  }

  /* ---------- arranque ---------- */
  async function historial() {
    for (const u of HIST_URLS) { try { const r = await fetch(u, { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) { } }
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
    fetch("./datos_sni.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(j => { if (j && j.cota_mazar) { D = j; dibujar(actual()); } }).catch(() => { });
    historial().then(j => { if (j) { HISTD = j; dibujar(actual()); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
