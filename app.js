/* Bitácora de entrenamiento — lee la hoja pública de Google Sheets y
   pinta métricas por persona. Sin dependencias. */

'use strict';

/* ————— Configuración ————— */

const SHEET_ID = '1myKO6v9xTHJKomfHiUIf0xNOI09GRSJ46iMkZlhaOs8';

// Una entrada por pestaña de la hoja. Para agregar a alguien, añádelo aquí.
const PEOPLE = [
  { name: 'Jowel', sheet: 'Jowel' },
  { name: 'Sankiago', sheet: 'Sankiago' },
  { name: 'Tomas', sheet: 'Tomas' },
];

const REFRESH_MS = 60_000;   // refresco de datos
const STRIP_DAYS = 28;       // días de la tira de actividad

/* ————— Utilidades ————— */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function csvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv` +
    `&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseFecha(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return isNaN(d) ? null : d;
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today0() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fmtFecha(d) { return `${d.getDate()} ${MESES[d.getMonth()]}`; }

function fmtMin(min) {
  if (!min) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function fmtHace(days) {
  if (days === null) return { text: 'sin registros', cls: 'stale' };
  if (days <= 0) return { text: 'hoy', cls: 'fresh' };
  if (days === 1) return { text: 'ayer', cls: '' };
  return { text: `hace ${days} días`, cls: days >= 3 ? 'stale' : '' };
}

/* ————— Modelo de datos ————— */

function normalizaEstado(s) {
  const t = String(s).toLowerCase();
  if (t.includes('resuel')) return 'resuelto';
  if (t.includes('upsol')) return 'upsolveado';
  return t.trim() ? 'otro' : '';
}

function rowsToEntries(rows) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (frag) => head.findIndex((h) => h.includes(frag));
  const iFecha = col('fecha'), iPlat = col('plataforma'), iTipo = col('tipo'),
    iEstado = col('estado'), iDif = col('dificultad'), iLink = col('link'),
    iMinI = col('minutos i'), iMinC = col('minutos cod'),
    iSub = col('submission'), iTema = col('tema');
  const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');

  const entries = [];
  for (const r of rows.slice(1)) {
    const fecha = parseFecha(get(r, iFecha));
    if (!fecha) continue; // filas vacías o sueltas
    const dif = parseInt(get(r, iDif), 10);
    entries.push({
      fecha,
      plataforma: get(r, iPlat),
      tipo: get(r, iTipo),
      estado: normalizaEstado(get(r, iEstado)),
      dificultad: Number.isFinite(dif) ? dif : null,
      link: get(r, iLink),
      minutos: (parseInt(get(r, iMinI), 10) || 0) + (parseInt(get(r, iMinC), 10) || 0),
      submission: get(r, iSub),
      temas: get(r, iTema).split(',').map((t) => t.trim()).filter(Boolean),
    });
  }
  entries.sort((a, b) => a.fecha - b.fecha);
  return entries;
}

function statsFor(entries) {
  const hoy = today0();
  const days = new Map(); // dayKey -> count
  let resueltos = 0, upsolveados = 0, minutos = 0;
  let last7 = 0, sumDif = 0, nDif = 0, maxDif = null;
  const temas = new Map();
  const corte7 = addDays(hoy, -6);

  for (const e of entries) {
    days.set(dayKey(e.fecha), (days.get(dayKey(e.fecha)) || 0) + 1);
    if (e.estado === 'resuelto') resueltos++;
    else if (e.estado === 'upsolveado') upsolveados++;
    minutos += e.minutos;
    if (e.fecha >= corte7) last7++;
    if (e.dificultad !== null) {
      sumDif += e.dificultad; nDif++;
      maxDif = maxDif === null ? e.dificultad : Math.max(maxDif, e.dificultad);
    }
    for (const t of e.temas) {
      const k = t.toLowerCase();
      const cur = temas.get(k) || { display: t, count: 0 };
      cur.count++;
      temas.set(k, cur);
    }
  }

  // racha: días consecutivos con actividad, contando desde hoy o ayer
  let racha = 0;
  let d = days.has(dayKey(hoy)) ? hoy : addDays(hoy, -1);
  while (days.has(dayKey(d))) { racha++; d = addDays(d, -1); }

  const lastFecha = entries.length ? entries[entries.length - 1].fecha : null;
  const daysSince = lastFecha === null ? null
    : Math.round((hoy - lastFecha) / 86_400_000);

  return {
    total: entries.length, resueltos, upsolveados, minutos, last7,
    avgDif: nDif ? Math.round(sumDif / nDif) : null, maxDif,
    diasActivos: days.size, racha, daysSince, daysMap: days,
    temas: [...temas.values()].sort((a, b) => b.count - a.count),
  };
}

/* ————— Enlaces a problemas ————— */

function problemUrl(e) {
  const link = e.link;
  if (/^https?:\/\//i.test(link)) return link;
  if (/codeforces/i.test(e.plataforma)) {
    const m = link.match(/^(\d+)\s*([A-Z]\d?)$/i);
    if (m) return `https://codeforces.com/problemset/problem/${m[1]}/${m[2].toUpperCase()}`;
  }
  if (/atcoder/i.test(e.plataforma)) {
    const m = link.match(/^(a[bgr]c)\s*(\d+)\s*([a-z]\d?)$/i);
    if (m) {
      const c = `${m[1].toLowerCase()}${m[2]}`;
      return `https://atcoder.jp/contests/${c}/tasks/${c}_${m[3].toLowerCase()}`;
    }
  }
  return null;
}

function problemCell(e) {
  let label = e.link || e.tipo || '—';
  if (/^https?:\/\//i.test(label)) {
    try { label = new URL(label).hostname.replace(/^www\./, '') + '/…'; } catch { /* se deja tal cual */ }
  }
  const url = problemUrl(e);
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(e.link)}">${esc(label)}</a>`
    : esc(label);
}

/* ————— Render: resumen del equipo ————— */

function renderSummary(people) {
  const total = people.reduce((s, p) => s + p.stats.total, 0);
  const semana = people.reduce((s, p) => s + p.stats.last7, 0);
  const minutos = people.reduce((s, p) => s + p.stats.minutos, 0);
  const mejor = people.reduce((a, b) => (b.stats.racha > a.stats.racha ? b : a), people[0]);

  $('#team-summary').innerHTML = [
    { num: total, lbl: 'problemas registrados', sub: '&nbsp;' },
    { num: semana, lbl: 'últimos 7 días', sub: 'todo el equipo' },
    { num: fmtMin(minutos), lbl: 'tiempo registrado', sub: 'idea + código' },
    { num: `${mejor.stats.racha} d`, lbl: 'mejor racha activa', sub: esc(mejor.name) },
  ].map((c) => `
    <div class="summary-cell">
      <span class="num">${c.num}</span>
      <span class="lbl">${c.lbl}</span>
      <span class="sub">${c.sub}</span>
    </div>`).join('');
}

/* ————— Render: tabla general ————— */

function renderLeaderboard(people) {
  const orden = [...people].sort((a, b) =>
    b.stats.last7 - a.stats.last7 || b.stats.total - a.stats.total);

  const filas = orden.map((p, i) => {
    const s = p.stats;
    const hace = fmtHace(s.daysSince);
    return `<tr class="${i === 0 && s.last7 > 0 ? 'leader' : ''}">
      <td class="rank">${i + 1}.</td>
      <td class="person-name">${esc(p.name)}</td>
      <td class="num-col">${s.last7}</td>
      <td class="num-col">${s.total}</td>
      <td class="num-col estado-resuelto">${s.resueltos}</td>
      <td class="num-col estado-upsolveado">${s.upsolveados}</td>
      <td class="num-col">${s.racha} d</td>
      <td class="num-col">${s.avgDif ?? '—'}</td>
      <td class="num-col">${s.maxDif ?? '—'}</td>
      <td class="num-col">${fmtMin(s.minutos)}</td>
      <td class="${hace.cls}">${hace.text}</td>
    </tr>`;
  }).join('');

  $('#leaderboard').innerHTML = `
    <thead><tr>
      <th></th><th>Nombre</th>
      <th class="num-col">Últ. 7 días</th><th class="num-col">Total</th>
      <th class="num-col">Resueltos</th><th class="num-col">Upsolve</th>
      <th class="num-col">Racha</th>
      <th class="num-col">Dif. media</th><th class="num-col">Dif. máx</th>
      <th class="num-col">Tiempo</th><th>Última actividad</th>
    </tr></thead>
    <tbody>${filas}</tbody>`;
}

/* ————— Render: gráfica acumulada ————— */

const DASHES = ['', '7 4', '2 3', '10 3 2 3'];

function renderCumulative(people) {
  const box = $('#cumulative-chart');
  const all = people.flatMap((p) => p.entries);
  if (!all.length) { box.innerHTML = '<p class="none-note">Aún no hay registros.</p>'; return; }

  const hoy = today0();
  let d0 = all.reduce((m, e) => (e.fecha < m ? e.fecha : m), hoy);
  const nDays = Math.round((hoy - d0) / 86_400_000) + 1;

  // serie acumulada por persona
  const series = people.map((p) => {
    const perDay = new Array(nDays).fill(0);
    for (const e of p.entries) {
      const idx = Math.round((e.fecha - d0) / 86_400_000);
      if (idx >= 0 && idx < nDays) perDay[idx]++;
    }
    let acc = 0;
    return perDay.map((c) => (acc += c));
  });

  const yMax = Math.max(1, ...series.map((s) => s[s.length - 1]));
  const W = 940, H = 250, mL = 34, mR = 16, mT = 12, mB = 26;
  const iw = W - mL - mR, ih = H - mT - mB;
  const x = (i) => mL + (nDays === 1 ? iw / 2 : (i / (nDays - 1)) * iw);
  const y = (v) => mT + ih - (v / yMax) * ih;

  // rejilla horizontal en valores redondos
  const step = yMax <= 10 ? 2 : yMax <= 30 ? 5 : 10;
  let grid = '';
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line x1="${mL}" y1="${y(v)}" x2="${W - mR}" y2="${y(v)}"
      stroke="#d9d4c5" stroke-width="1"/>
      <text x="${mL - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10.5"
        fill="#71695a">${v}</text>`;
  }

  // marcas de fecha: inicio, medio, hoy
  const ticks = [0, Math.floor((nDays - 1) / 2), nDays - 1];
  const labels = [...new Set(ticks)].map((i) => {
    const anchor = i === 0 ? 'start' : i === nDays - 1 ? 'end' : 'middle';
    return `<text x="${x(i)}" y="${H - 8}" text-anchor="${anchor}" font-size="10.5"
      fill="#71695a">${fmtFecha(addDays(d0, i))}</text>`;
  }).join('');

  const paths = series.map((s, k) => {
    const pts = s.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const dash = DASHES[k % DASHES.length];
    return `<polyline points="${pts}" fill="none" stroke="#1d1b16" stroke-width="1.6"
      ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>`;
  }).join('');

  const legend = people.map((p, k) => {
    const dash = DASHES[k % DASHES.length];
    return `<span class="item">
      <svg viewBox="0 0 30 8"><line x1="0" y1="4" x2="30" y2="4" stroke="#1d1b16"
        stroke-width="1.6" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>
      ${esc(p.name)} (${p.stats.total})</span>`;
  }).join('');

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Problemas acumulados por persona">
      ${grid}
      <line x1="${mL}" y1="${mT + ih}" x2="${W - mR}" y2="${mT + ih}" stroke="#1d1b16" stroke-width="1.2"/>
      ${labels}
      ${paths}
    </svg>
    <div class="chart-legend">${legend}</div>`;
}

/* ————— Render: paneles por persona ————— */

function stripHTML(stats) {
  const hoy = today0();
  const start = addDays(hoy, -(STRIP_DAYS - 1));
  let cells = '';
  let activos = 0;
  for (let i = 0; i < STRIP_DAYS; i++) {
    const d = addDays(start, i);
    const c = stats.daysMap.get(dayKey(d)) || 0;
    if (c > 0) activos++;
    const cls = c === 0 ? '' : c === 1 ? 'c1' : c <= 3 ? 'c2' : 'c3';
    const isToday = dayKey(d) === dayKey(hoy) ? ' today' : '';
    cells += `<div class="cell ${cls}${isToday}" title="${fmtFecha(d)}: ${c}"></div>`;
  }
  return `
    <div class="day-strip">${cells}</div>
    <div class="strip-caption">
      <span>${fmtFecha(start)}</span>
      <span>${activos} de ${STRIP_DAYS} días activos</span>
      <span>hoy</span>
    </div>`;
}

function barsHTML(rows, maxCount) {
  if (!rows.length) return '<p class="none-note">sin datos todavía</p>';
  return rows.map((r) => `
    <div class="bar-row">
      <span class="bl" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bar"><i style="width:${(r.count / maxCount) * 100}%"></i></span>
      <span class="bn">${r.count}</span>
    </div>`).join('');
}

const DIF_BUCKETS = [
  { label: '≤ 900', test: (d) => d <= 900 },
  { label: '1000–1300', test: (d) => d >= 1000 && d <= 1300 },
  { label: '1400–1700', test: (d) => d >= 1400 && d <= 1700 },
  { label: '1800–2100', test: (d) => d >= 1800 && d <= 2100 },
  { label: '2200+', test: (d) => d >= 2200 },
];

function renderPanels(people) {
  $('#person-panels').innerHTML = people.map((p) => {
    const s = p.stats;
    const hace = fmtHace(s.daysSince);

    const statRows = [
      ['Últimos 7 días', String(s.last7)],
      ['Resueltos / Upsolve', `<span class="estado-resuelto">${s.resueltos}</span> / <span class="estado-upsolveado">${s.upsolveados}</span>`],
      ['Racha actual', `${s.racha} d`],
      ['Días activos (total)', String(s.diasActivos)],
      ['Dif. media / máx', s.avgDif !== null ? `${s.avgDif} / ${s.maxDif}` : '—'],
      ['Tiempo registrado', fmtMin(s.minutos)],
    ].map(([k, v]) => `
      <div class="stat-row">
        <span class="k">${k}</span><span class="leader-dots"></span><span class="v">${v}</span>
      </div>`).join('');

    const temas = barsHTML(
      s.temas.slice(0, 5).map((t) => ({ label: t.display, count: t.count })),
      Math.max(1, ...s.temas.slice(0, 5).map((t) => t.count)));

    const difRows = DIF_BUCKETS
      .map((b) => ({ label: b.label, count: p.entries.filter((e) => e.dificultad !== null && b.test(e.dificultad)).length }))
      .filter((r) => r.count > 0);
    const difs = barsHTML(difRows, Math.max(1, ...difRows.map((r) => r.count)));

    return `<article class="panel">
      <h3>${esc(p.name)}</h3>
      <p class="panel-sub">${s.total} problemas registrados · última actividad:
        <span class="${hace.cls}">${hace.text}</span></p>
      <div class="stat-list">${statRows}</div>
      <p class="mini-title">Últimos ${STRIP_DAYS} días</p>
      ${stripHTML(s)}
      <p class="mini-title">Temas frecuentes</p>
      ${temas}
      <p class="mini-title">Dificultad</p>
      ${difs}
    </article>`;
  }).join('');
}

/* ————— Render: actividad reciente ————— */

function renderFeed(people) {
  const all = people.flatMap((p) =>
    p.entries.map((e, i) => ({ ...e, who: p.name, ord: i })));
  all.sort((a, b) => b.fecha - a.fecha || b.ord - a.ord);
  const rows = all.slice(0, 20).map((e) => `
    <tr>
      <td class="dim">${fmtFecha(e.fecha)}</td>
      <td class="person-name">${esc(e.who)}</td>
      <td>${problemCell(e)}</td>
      <td class="dim">${esc(e.plataforma || '—')}</td>
      <td class="num-col">${e.dificultad ?? '—'}</td>
      <td class="estado-${e.estado || 'otro'}">${e.estado || '—'}</td>
      <td class="dim">${esc(e.temas.join(', ') || '—')}</td>
      <td class="num-col">${e.minutos ? fmtMin(e.minutos) : '—'}</td>
    </tr>`).join('');

  $('#recent-feed').innerHTML = `
    <thead><tr>
      <th>Fecha</th><th>Quién</th><th>Problema</th><th>Plataforma</th>
      <th class="num-col">Dif.</th><th>Estado</th><th>Temas</th><th class="num-col">Tiempo</th>
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

/* ————— Ciclo de actualización ————— */

let lastFetch = null;

async function fetchPerson(p) {
  const res = await fetch(csvUrl(p.sheet), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} en la pestaña "${p.sheet}"`);
  const entries = rowsToEntries(parseCSV(await res.text()));
  return { ...p, entries, stats: statsFor(entries) };
}

async function refresh() {
  const results = await Promise.allSettled(PEOPLE.map(fetchPerson));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const banner = $('#error-banner');

  if (!ok.length) {
    banner.hidden = false;
    banner.textContent = 'No se pudo leer la hoja de cálculo. Revisa la conexión o que la hoja siga compartida con acceso público.';
    return;
  }
  const fallos = results.filter((r) => r.status === 'rejected');
  banner.hidden = fallos.length === 0;
  if (fallos.length) {
    banner.textContent = `Aviso: no se pudieron leer ${fallos.length} pestaña(s). Se muestra el resto.`;
  }

  renderSummary(ok);
  renderLeaderboard(ok);
  renderCumulative(ok);
  renderPanels(ok);
  renderFeed(ok);
  lastFetch = new Date();
}

function tickStatus() {
  if (!lastFetch) return;
  const s = Math.round((Date.now() - lastFetch) / 1000);
  const txt = s < 5 ? 'actualizado ahora mismo'
    : s < 60 ? `actualizado hace ${s} s`
      : `actualizado hace ${Math.floor(s / 60)} min`;
  $('#status-text').textContent = txt;
}

function init() {
  const hoy = new Date();
  $('#masthead-date').textContent =
    `${DIAS_LARGO[hoy.getDay()]}, ${hoy.getDate()} de ${MESES_LARGO[hoy.getMonth()]} de ${hoy.getFullYear()}`;
  $('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  $('#refresh-now').addEventListener('click', (ev) => { ev.preventDefault(); refresh(); });

  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(tickStatus, 1000);
}

init();
