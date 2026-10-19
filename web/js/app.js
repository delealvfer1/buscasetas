/* BuscaSetas · lógica de la app */
(function () {
  'use strict';

  const D = window.SETAS_DATA;
  const M = window.SetaModel;
  const W = window.SetaWeather;
  const C = window.SetaContent;
  const U = window.SetaMapUtil;
  const R = D.region;
  const IS_APP = !!window.AndroidBridge;

  /* ------------------------------------------------------------ utilidades */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, def) { try { const v = localStorage.getItem('bs.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('bs.' + k, JSON.stringify(v)); return true; } catch (e) { toast('No se pudo guardar en el móvil: almacenamiento lleno'); return false; } },
    del(k) { try { localStorage.removeItem('bs.' + k); } catch (e) { /* nada */ } },
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const WDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const fmtDay = (d) => `${WDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const fmtShort = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const fmtTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const fmtNum = (v, dec) => Number(v).toLocaleString('es-ES', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  const fmtDist = (m) => m < 1000 ? `${fmtNum(Math.round(m / 10) * 10)} m` : `${fmtNum(m / 1000, m < 10000 ? 1 : 0)} km`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today0 = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
  const dayDiff = (a, b) => Math.round((new Date(a).setHours(12, 0, 0, 0) - new Date(b).setHours(12, 0, 0, 0)) / 86400e3);

  function haversine(a, b) {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const r = Math.PI / 180, dLon = (b.lon - a.lon) * r;
    const y = Math.sin(dLon) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(dLon);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const cardinal = (deg) => CARD[Math.round(deg / 45) % 8];

  function sunset(date, lat, lon) {
    const rad = Math.PI / 180;
    const start = new Date(date.getFullYear(), 0, 0);
    const n = Math.floor((date - start) / 86400e3);
    const g = 2 * Math.PI / 365 * (n - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
    const mins = 720 - 4 * (lon - ha) - eq;
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0));
    return new Date(d.getTime() + mins * 60000);
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }

  function shareFile(name, mime, content) {
    if (IS_APP && window.AndroidBridge.shareFile) { window.AndroidBridge.shareFile(name, mime, content); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function openExternal(url) {
    if (IS_APP) window.AndroidBridge.openExternal(url); else window.open(url, '_blank', 'noopener');
  }
  function icon(name, cls) { return `<svg class="ico ${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }

  /* ------------------------------------------------------------ celdas */
  const cells = D.idx.map((id, k) => {
    const r = Math.floor(id / D.cols), c = id % D.cols;
    return {
      k, id, r, c,
      lat: R.min_lat + (r + 0.5) * D.dLat, lon: R.min_lon + (c + 0.5) * D.dLon,
      alt: D.alt[k], pino: D.pino[k], frondosa: D.frondosa[k], mixto: D.mixto[k], desconocido: D.desconocido[k],
      muni: D.muni[k] >= 0 ? D.munis[D.muni[k]] : null,
      prov: D.prov[k] >= 0 ? D.provs[D.prov[k]] : null,
      prot: D.prot[k] >= 0 ? D.prots[D.prot[k]] : null,
    };
  });
  const cellById = new Map(cells.map(c => [c.id, c]));
  function cellAt(lat, lon) {
    const r = Math.floor((lat - R.min_lat) / D.dLat), c = Math.floor((lon - R.min_lon) / D.dLon);
    if (r < 0 || c < 0 || r >= D.rows || c >= D.cols) return { inside: false };
    const id = r * D.cols + c;
    return { inside: true, id, r, c, cell: cellById.get(id) || null };
  }

  /* ------------------------------------------------------------ estado */
  const prefs = store.get('prefs', {});
  const state = {
    species: prefs.species || 'boletus',
    offset: 0,
    base: prefs.base || 'mtn',
    showSpots: prefs.showSpots !== false,
    meteo: null, wx: null,
    scores: new Int16Array(cells.length),
    best: new Int8Array(cells.length),
    sel: null,
    pos: null,
    heading: null,
    car: store.get('car', null),
    spots: store.get('spots', []),
    outings: store.get('outings', []),
    active: store.get('active', null),
    tab: 'map',
  };
  const savePrefs = () => store.set('prefs', { species: state.species, base: state.base, showSpots: state.showSpots });

  /* ------------------------------------------------------------ mapa */
  const BASES = {
    mtn: {
      id: 'mtn', name: 'Topográfico IGN', offline: true, maxZoom: 17,
      url: 'https://www.ign.es/wmts/mapa-raster?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
      attribution: 'Mapa © IGN · predicción BuscaSetas',
    },
    pnoa: {
      id: 'pnoa', name: 'Ortofoto PNOA', offline: true, maxZoom: 19,
      url: 'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
      attribution: 'PNOA © IGN',
    },
    osm: {
      id: 'osm', name: 'OpenStreetMap', offline: false, maxZoom: 19,
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© colaboradores de OpenStreetMap',
    },
  };
  if (!BASES[state.base]) state.base = 'mtn';

  const view = store.get('view', null);
  const map = new window.SetaMap($('#map'), {
    lat: view ? view.lat : (R.min_lat + R.max_lat) / 2,
    lon: view ? view.lon : (R.min_lon + R.max_lon) / 2,
    zoom: view ? view.zoom : 10,
    minZoom: 7, maxZoom: 18,
  });
  map.setBaseLayer(BASES[state.base]);
  if (!view) requestAnimationFrame(() => map.fitBounds(R.min_lat, R.min_lon, R.max_lat, R.max_lon, 16));
  map.on('moveend', () => store.set('view', { lat: map.center.lat, lon: map.center.lon, zoom: map.zoom }));

  const ALPHA = [0, 0.32, 0.5, 0.6, 0.7];
  map.addOverlay((ctx, m) => {
    // límites de la zona piloto
    const a = m.latLngToScreen(R.max_lat, R.min_lon), b = m.latLngToScreen(R.min_lat, R.max_lon);
    ctx.strokeStyle = 'rgba(31,58,43,.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);

    // celdas
    const rowY = new Float32Array(D.rows + 1);
    for (let r = 0; r <= D.rows; r++) rowY[r] = m.latLngToScreen(R.min_lat + r * D.dLat, R.min_lon).y;
    const x0 = m.latLngToScreen(R.min_lat, R.min_lon).x;
    const x1 = m.latLngToScreen(R.min_lat, R.min_lon + D.dLon).x;
    const cw = x1 - x0;
    const fade = m.zoom >= 15 ? 0.7 : 1;
    for (let k = 0; k < cells.length; k++) {
      const lv = M.levelOf(state.scores[k]);
      if (lv === 0) continue;
      const c = cells[k];
      const x = x0 + c.c * cw, yb = rowY[c.r], yt = rowY[c.r + 1];
      if (x > m.w || x + cw < 0 || yt > m.h || yb < 0) continue;
      ctx.globalAlpha = ALPHA[lv] * fade;
      ctx.fillStyle = M.LEVELS[lv].color;
      ctx.fillRect(x, yt, cw + 0.3, yb - yt + 0.3);
    }
    ctx.globalAlpha = 1;
    if (m.zoom >= 13) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 0; r <= D.rows; r++) { ctx.moveTo(a.x, rowY[r]); ctx.lineTo(b.x, rowY[r]); }
      for (let c = 0; c <= D.cols; c++) { const x = x0 + c * cw; ctx.moveTo(x, a.y); ctx.lineTo(x, b.y); }
      ctx.stroke();
    }
    // celda seleccionada
    if (state.sel && state.sel.inside) {
      const s = state.sel;
      const x = x0 + s.c * cw, yb = rowY[s.r], yt = rowY[s.r + 1];
      ctx.strokeStyle = '#10261A';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, yt, cw, yb - yt);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 2, yt + 2, cw - 4, yb - yt - 4);
    }
    // recorrido de la salida activa
    if (state.active && state.active.track && state.active.track.length > 1) {
      ctx.strokeStyle = '#1F5FBF';
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      state.active.track.forEach((p, i) => { const q = m.latLngToScreen(p[0], p[1]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.stroke();
    }
    // precisión del GPS
    if (state.pos && state.pos.acc) {
      const p = m.latLngToScreen(state.pos.lat, state.pos.lon);
      const rad = state.pos.acc / m.metersPerPixel();
      if (rad > 8) {
        ctx.fillStyle = 'rgba(31,95,191,.12)';
        ctx.strokeStyle = 'rgba(31,95,191,.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  });

  // marcadores
  const meEl = document.createElement('div');
  meEl.className = 'mk-me';
  meEl.innerHTML = '<span class="mk-me-cone"></span><span class="mk-me-dot"></span>';
  let meMarker = null;
  const carEl = document.createElement('div');
  carEl.className = 'mk-car';
  carEl.innerHTML = icon('car');
  let carMarker = null;
  let spotMarkers = [];

  function drawCar() {
    if (carMarker) { carMarker.remove(); carMarker = null; }
    if (state.car) carMarker = map.addMarker(carEl, state.car.lat, state.car.lon, { anchorY: 1, onClick: openCarPanel });
    $('#fab-car').classList.toggle('on', !!state.car);
  }
  function drawSpots() {
    spotMarkers.forEach(m => m.remove());
    spotMarkers = [];
    if (!state.showSpots) return;
    state.spots.forEach(s => {
      const el = document.createElement('div');
      el.className = 'mk-spot';
      el.innerHTML = `${icon('pin')}<span>${esc(s.name)}</span>`;
      spotMarkers.push(map.addMarker(el, s.lat, s.lon, { anchorX: 0.12, anchorY: 1, onClick: () => openSpot(s.id) }));
    });
  }

  /* ------------------------------------------------------------ predicción */
  function dateFor(offset) { return addDays(today0(), offset); }

  function scoreCell(k, spId, offset) {
    const date = dateFor(offset);
    const w = state.wx ? state.wx.series[k] : null;
    const di = state.wx ? state.wx.todayIdx + offset : 0;
    if (spId === 'todas') {
      let best = null;
      M.SPECIES.forEach((sp, i) => { const s = M.score(sp, cells[k], w, di, date); if (!best || s.score > best.score) { best = s; best.sp = sp; best.i = i; } });
      return best;
    }
    const sp = M.SPECIES.find(s => s.id === spId);
    const s = M.score(sp, cells[k], w, di, date);
    s.sp = sp;
    return s;
  }

  function recompute() {
    let n = [0, 0, 0, 0, 0];
    for (let k = 0; k < cells.length; k++) {
      const s = scoreCell(k, state.species, state.offset);
      state.scores[k] = s.score;
      state.best[k] = s.i == null ? -1 : s.i;
      n[s.level]++;
    }
    const top = n[3] + n[4];
    $('#legend-count').textContent = top
      ? `${fmtNum(top)} km² en alta o muy alta`
      : (n[2] ? `${fmtNum(n[2])} km² en media; ninguna alta` : 'Ninguna zona destacada este día');
    map.render();
    if (state.sel && state.sel.inside && sheetOpen()) renderSheet();
  }

  /* ------------------------------------------------------------ cabecera: especie y día */
  function renderSpeciesChips() {
    const opts = M.SPECIES.map(s => ({ id: s.id, label: s.short })).concat([{ id: 'todas', label: 'Cualquiera' }]);
    $('#species-chips').innerHTML = opts.map(o =>
      `<button class="chip ${o.id === state.species ? 'sel' : ''}" data-sp="${o.id}" aria-pressed="${o.id === state.species}">${esc(o.label)}</button>`).join('');
  }
  $('#species-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sp]');
    if (!b) return;
    state.species = b.dataset.sp;
    savePrefs();
    renderSpeciesChips();
    recompute();
  });

  function renderDayChips() {
    const maxOff = state.wx ? Math.min(7, state.wx.days.length - 1 - state.wx.todayIdx) : 7;
    let html = '';
    for (let o = 0; o <= 7; o++) {
      const d = dateFor(o);
      const label = o === 0 ? 'Hoy' : o === 1 ? 'Mañana' : `${WDAYS[d.getDay()]} ${d.getDate()}`;
      const dis = o > maxOff ? 'disabled' : '';
      html += `<button class="chip day ${o === state.offset ? 'sel' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'wkend' : ''}" data-off="${o}" ${dis}>${label}</button>`;
    }
    $('#day-chips').innerHTML = html;
  }
  $('#day-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-off]');
    if (!b || b.disabled) return;
    state.offset = +b.dataset.off;
    renderDayChips();
    recompute();
    if (state.offset >= 3) toast('Días con previsión: la lluvia prevista puede fallar.');
  });

  /* ------------------------------------------------------------ meteo */
  async function loadWeather(force) {
    const st = $('#meteo-status');
    st.textContent = 'Actualizando lluvia…';
    st.classList.remove('warn');
    const r = await W.get(R, { force, maxAgeH: 3 });
    if (r.data) {
      state.meteo = r.data;
      state.wx = W.interpolate(r.data, R, cells);
      const old = (Date.now() - new Date(r.data.fetched)) > 36 * 3600e3;
      st.textContent = `Lluvia ${W.ageText(r.data.fetched)}${r.error ? ' · sin conexión' : ''}`;
      st.classList.toggle('warn', old || !!r.error);
    } else {
      state.wx = null;
      st.textContent = 'Sin datos de lluvia';
      st.classList.add('warn');
      toast('Sin conexión: el mapa solo usa bosque y temporada hasta que descargue la lluvia.', 5000);
    }
    renderDayChips();
    recompute();
  }
  $('#meteo-status').addEventListener('click', () => loadWeather(true));

  /* ------------------------------------------------------------ ficha de celda */
  function sheetOpen() { return $('#sheet').classList.contains('open'); }
  function openSheet(html) {
    $('#sheet-body').innerHTML = html;
    $('#sheet').classList.add('open');
    $('#sheet').scrollTop = 0;
  }
  function closeSheet() {
    $('#sheet').classList.remove('open');
    state.sel = null;
    map.render();
  }
  $('#sheet-close').addEventListener('click', closeSheet);

  map.on('click', (e) => {
    const hit = cellAt(e.lat, e.lon);
    state.sel = hit.inside ? Object.assign(hit, { tapLat: e.lat, tapLon: e.lon }) : null;
    map.render();
    if (!hit.inside) {
      state.sel = { inside: false, tapLat: e.lat, tapLon: e.lon };
      openSheet(`<h2 class="sh-title">Fuera de la zona piloto</h2>
        <p class="muted">Este prototipo solo calcula la predicción en ${esc(R.name)}, el rectángulo de línea discontinua.</p>
        <div class="sh-actions"><button class="btn" data-act="spot-here">${icon('pin')}Guardar punto aquí</button></div>`);
      return;
    }
    renderSheet();
  });

  map.on('longpress', (e) => {
    if (navigator.vibrate) navigator.vibrate(30);
    newSpotDialog(e.lat, e.lon);
  });

  function legalFor(cell) {
    if (cell && cell.prot && cell.prot.k === 'enp') {
      return { cls: 'red', title: 'Espacio natural protegido', text: `${cell.prot.n}. Tiene normas propias: la recolección puede estar prohibida o limitada. Consúltalo antes de recoger.` };
    }
    const prov = cell && cell.prov ? cell.prov : '';
    const who = /soria/i.test(prov)
      ? 'Parque Micológico Montes de Soria, Pinares de Urbión o montes de la Junta (Micocyl)'
      : /burgos/i.test(prov) ? 'acotados Micocyl de Burgos o del ayuntamiento' : 'el acotado de la zona';
    let text = `Casi todos los montes de la comarca están acotados. Probablemente necesitas permiso de ${who}. Comprueba los carteles del monte.`;
    if (cell && cell.prot && cell.prot.k === 'n2000') text += ` Además está en la Red Natura 2000 (${cell.prot.n}).`;
    return { cls: 'amber', title: 'Permiso probable', text };
  }

  function factorBar(v) {
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    return `<span class="fbar"><span style="width:${pct}%"></span></span>`;
  }

  function rainChart(k, sp) {
    if (!state.wx) return '';
    const s = state.wx.series[k];
    const ti = state.wx.todayIdx, di = ti + state.offset;
    const from = Math.max(0, di - 24), to = Math.min(s.rain.length - 1, di + 2);
    const n = to - from + 1;
    const maxR = Math.max(10, ...Array.from(s.rain.slice(from, to + 1)));
    const bw = 300 / n;
    let bars = '';
    for (let d = from; d <= to; d++) {
      const v = s.rain[d];
      const h = Math.max(v > 0.2 ? 2 : 0, v / maxR * 54);
      const inWin = sp && d >= di - sp.rainWin[1] && d <= di - sp.rainWin[0];
      const cls = d > ti ? 'fc' : inWin ? 'win' : '';
      bars += `<rect class="${cls}" x="${((d - from) * bw + 1).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${fmtShort(new Date(state.wx.days[d]))}: ${fmtNum(v, 1)} mm</title></rect>`;
    }
    const tx = ((di - from) * bw + bw / 2).toFixed(1);
    const winX = sp ? ((di - sp.rainWin[1] - from) * bw) : 0;
    const winW = sp ? ((sp.rainWin[1] - sp.rainWin[0] + 1) * bw) : 0;
    return `<figure class="rain">
      <svg viewBox="0 0 300 76" preserveAspectRatio="none" role="img" aria-label="Lluvia diaria de los últimos días">
        ${sp ? `<rect class="winbg" x="${winX.toFixed(1)}" y="0" width="${winW.toFixed(1)}" height="60"/>` : ''}
        ${bars}
        <line class="today" x1="${tx}" x2="${tx}" y1="0" y2="62"/>
        <text x="2" y="74">${fmtShort(new Date(state.wx.days[from]))}</text>
        <text x="298" y="74" text-anchor="end">${fmtShort(new Date(state.wx.days[to]))}</text>
      </svg>
      <figcaption>Lluvia diaria (máx. ${fmtNum(maxR)} mm). En ocre, los días que cuentan para esta especie; en gris claro, previsión.</figcaption>
    </figure>`;
  }

  function seasonWord(s) {
    if (s >= 0.99) return 'plena temporada';
    if (s <= 0.01) return 'fuera de temporada';
    return 'principio o final de temporada';
  }

  function renderSheet() {
    const sel = state.sel;
    if (!sel || !sel.inside) return;
    const cell = sel.cell;
    const date = dateFor(state.offset);
    const dayLabel = state.offset === 0 ? 'hoy' : state.offset === 1 ? 'mañana' : fmtDay(date);
    if (!cell) {
      openSheet(`<h2 class="sh-title">Sin bosque en esta cuadrícula</h2>
        <p class="muted">Según OpenStreetMap aquí hay menos de un 3 % de arbolado, así que no se calcula la predicción.</p>
        <div class="sh-actions">
          <button class="btn" data-act="spot-here">${icon('pin')}Guardar punto aquí</button>
          <button class="btn ghost" data-act="route-here">${icon('route')}Cómo llegar</button>
        </div>`);
      return;
    }
    const s = scoreCell(cell.k, state.species, state.offset);
    const sp = s.sp;
    const lv = M.LEVELS[s.level];
    const legal = legalFor(cell);
    const forest = [['pinar', cell.pino], ['frondosas', cell.frondosa], ['mixto', cell.mixto], ['sin especificar', cell.desconocido]]
      .filter(f => f[1] > 0).map(f => `${f[0]} ${f[1]} %`).join(', ');
    const why = [];
    if (s.m) {
      const di = state.wx.todayIdx + state.offset;
      const d1 = new Date(state.wx.days[Math.max(0, di - sp.rainWin[1])]), d2 = new Date(state.wx.days[Math.max(0, di - sp.rainWin[0])]);
      why.push(['rain', `${fmtNum(s.m.rain)} mm de lluvia entre el ${fmtShort(d1)} y el ${fmtShort(d2)}`, `cuentan las lluvias de ${sp.rainWin[0]} a ${sp.rainWin[1]} días antes; buena a partir de ${sp.rain[1]} mm`, s.m.R]);
      why.push(['thermo', `Máximas medias de ${fmtNum(s.m.tm)} °C la última semana`, `ideal entre ${sp.tmax[0]} y ${sp.tmax[1]} °C`, s.m.T]);
      why.push(['frost', s.m.fmin < 0 ? `Mínima de ${fmtNum(s.m.fmin)} °C: ha helado` : `Sin heladas (mínima ${fmtNum(s.m.fmin)} °C)`, '', s.m.F]);
      if (s.m.D < 1) why.push(['sun', 'Días secos y calurosos: el suelo se está secando', '', s.m.D]);
    } else {
      why.push(['rain', 'Sin datos de lluvia', 'conecta a Internet y toca «Lluvia» arriba para descargarlos', 0.5]);
    }
    why.push(['tree', forest ? `Bosque: ${forest}` : 'Muy poco bosque', `busca ${sp.hostLabel}`, s.h.hc]);
    why.push(['mountain', `Altitud media ${fmtNum(cell.alt)} m`, `rango habitual ${fmtNum(sp.alt[0])}–${fmtNum(sp.alt[1])} m`, s.h.af]);
    why.push(['calendar', `${seasonWord(s.s)[0].toUpperCase()}${seasonWord(s.s).slice(1)}`, '', s.s]);

    openSheet(`
      <div class="sh-head">
        <div class="sh-score lv${s.level}">
          <span class="num">${s.score}</span>
          <span class="lvl">${lv.name}</span>
        </div>
        <div class="sh-headtext">
          <h2 class="sh-title">${esc(sp.name)}</h2>
          <p class="muted">${esc(dayLabel)}${cell.muni ? ', ' + esc(cell.muni) : ''}${cell.prov ? ' (' + esc(cell.prov) + ')' : ''}</p>
          ${s.noWeather ? '<p class="warn-text">Sin lluvia descargada: valor orientativo solo por bosque y temporada.</p>' : ''}
        </div>
      </div>
      <div class="legal ${legal.cls}">
        <div class="legal-badge">${icon(legal.cls === 'red' ? 'ban' : 'ticket')}</div>
        <div><strong>${legal.title}</strong><p>${esc(legal.text)}</p>
        <button class="link" data-act="legal">Permisos y normas de la zona</button></div>
      </div>
      <h3 class="sh-sub">Por qué</h3>
      <ul class="why">${why.map(w => `<li>${icon(w[0])}<div><span>${esc(w[1])}</span>${w[2] ? `<small>${esc(w[2])}</small>` : ''}</div>${factorBar(w[3])}</li>`).join('')}</ul>
      ${rainChart(cell.k, s.m ? sp : null)}
      <div class="sh-actions">
        <button class="btn" data-act="spot-here">${icon('pin')}Guardar punto</button>
        <button class="btn" data-act="log-here">${icon('basket')}Apuntar salida</button>
        <button class="btn ghost" data-act="route-here">${icon('route')}Cómo llegar</button>
      </div>
      <p class="fine">Predicción orientativa (modelo v1 sin calibrar). Cuadrícula de 1 km ${cell.id}.</p>`);
  }

  $('#sheet-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const sel = state.sel || {};
    const act = b.dataset.act;
    if (act === 'spot-here') newSpotDialog(sel.tapLat, sel.tapLon);
    else if (act === 'log-here') outingForm({ lat: sel.tapLat, lon: sel.tapLon, quick: true });
    else if (act === 'route-here') openExternal(`https://www.google.com/maps/dir/?api=1&destination=${sel.tapLat.toFixed(5)},${sel.tapLon.toFixed(5)}`);
    else if (act === 'legal') { closeSheet(); showTab('help'); setTimeout(() => $('#sec-legal').scrollIntoView({ behavior: 'smooth' }), 50); }
  });

  /* ------------------------------------------------------------ GPS */
  let watchId = null, follow = false;
  function startGps(center) {
    if (!navigator.geolocation) { toast('Este dispositivo no tiene GPS disponible'); return; }
    follow = !!center;
    if (watchId != null) {
      if (center && state.pos) map.flyTo(state.pos.lat, state.pos.lon, Math.max(map.zoom, 14));
      return;
    }
    $('#fab-locate').classList.add('busy');
    watchId = navigator.geolocation.watchPosition(onPos, (err) => {
      $('#fab-locate').classList.remove('busy');
      toast(err.code === 1 ? 'Sin permiso de ubicación: actívalo en los ajustes de Android para BuscaSetas' : 'No se pudo obtener la ubicación. Sal a cielo abierto y prueba otra vez.', 5000);
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  function onPos(p) {
    const first = !state.pos;
    state.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp, course: p.coords.heading };
    $('#fab-locate').classList.remove('busy');
    $('#fab-locate').classList.add('on');
    if (!meMarker) meMarker = map.addMarker(meEl, state.pos.lat, state.pos.lon);
    else meMarker.setLatLng(state.pos.lat, state.pos.lon);
    if (first && follow) {
      map.flyTo(state.pos.lat, state.pos.lon, Math.max(map.zoom, 14));
      const h = cellAt(state.pos.lat, state.pos.lon);
      if (!h.inside) toast('Estás fuera de la zona piloto de Pinares');
    }
    if (state.active) addTrackPoint(state.pos);
    updateCarPanel();
    updateOutingBar();
    map.render();
  }
  $('#fab-locate').addEventListener('click', () => {
    if (state.pos) { map.flyTo(state.pos.lat, state.pos.lon, Math.max(map.zoom, 14)); return; }
    startGps(true);
  });

  /* brújula */
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h == null) return;
    const so = (screen.orientation && screen.orientation.angle) || 0;
    state.heading = (h + so + 360) % 360;
    meEl.classList.add('has-heading');
    meEl.querySelector('.mk-me-cone').style.transform = `rotate(${state.heading}deg)`;
    updateCarArrow();
  }
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
  else window.addEventListener('deviceorientation', onOrient);

  /* ------------------------------------------------------------ coche */
  $('#fab-car').addEventListener('click', () => {
    if (state.car) { openCarPanel(); return; }
    modal(`<h2>Guardar dónde aparcas</h2>
      <p>Guarda la posición del coche antes de entrar al monte. Para volver, la app te indica dirección y distancia con la brújula, aunque no haya cobertura.</p>
      <div class="m-actions"><button class="btn primary" id="car-save">${icon('car')}Guardar mi posición actual</button>
      <button class="btn ghost" id="car-center">Usar el centro del mapa</button></div>`);
    $('#car-save').onclick = () => {
      if (!state.pos) { startGps(false); toast('Buscando tu posición… vuelve a tocar en unos segundos'); return; }
      if (state.pos.acc > 60) toast(`Precisión baja (±${Math.round(state.pos.acc)} m). Si puedes, espera unos segundos.`);
      saveCar(state.pos.lat, state.pos.lon);
    };
    $('#car-center').onclick = () => saveCar(map.center.lat, map.center.lon);
  });
  function saveCar(lat, lon) {
    state.car = { lat, lon, t: Date.now() };
    store.set('car', state.car);
    drawCar();
    closeModal();
    toast('Coche guardado');
  }
  function openCarPanel() {
    startGps(false);
    const ss = sunset(new Date(), state.car.lat, state.car.lon);
    modal(`<h2>Volver al coche</h2>
      <div class="compass">
        <div class="compass-ring"><span class="n">N</span><div class="compass-arrow" id="car-arrow">${icon('arrow')}</div></div>
        <div class="compass-read"><span id="car-dist">—</span><small id="car-dir">Esperando al GPS…</small></div>
      </div>
      <ul class="facts">
        <li>${icon('sun')}<span>Puesta de sol a las ${fmtTime(ss)} <small id="sun-left"></small></span></li>
        <li id="batt-li" hidden>${icon('battery')}<span id="batt"></span></li>
        <li>${icon('clock')}<span>Aparcado a las ${fmtTime(new Date(state.car.t))}${dayDiff(new Date(), new Date(state.car.t)) ? ' del ' + fmtShort(new Date(state.car.t)) : ''}</span></li>
      </ul>
      <div class="m-actions">
        <button class="btn" id="car-map">${icon('target')}Ver en el mapa</button>
        <button class="btn ghost danger" id="car-del">${icon('trash')}Ya he vuelto: borrar</button>
      </div>`, 'car');
    const left = Math.round((ss - Date.now()) / 60000);
    $('#sun-left').textContent = left > 0 ? `(quedan ${left >= 60 ? Math.floor(left / 60) + ' h ' : ''}${left % 60} min)` : '(ya se ha puesto)';
    if (left > 0 && left < 60) $('#sun-left').classList.add('warn-text');
    if (navigator.getBattery) navigator.getBattery().then(b => {
      $('#batt-li').hidden = false;
      $('#batt').textContent = `Batería ${Math.round(b.level * 100)} %${b.level < 0.2 ? ': baja, ahorra para la vuelta' : ''}`;
    }).catch(() => {});
    $('#car-map').onclick = () => { closeModal(); showTab('map'); map.flyTo(state.car.lat, state.car.lon, 15); };
    $('#car-del').onclick = () => { state.car = null; store.del('car'); drawCar(); closeModal(); toast('Coche borrado'); };
    updateCarPanel();
  }
  function updateCarPanel() {
    if (!state.car || !$('#car-dist')) return;
    if (!state.pos) return;
    const d = haversine(state.pos, state.car);
    const br = bearing(state.pos, state.car);
    $('#car-dist').textContent = fmtDist(d);
    $('#car-dir').textContent = d < 25 ? 'Estás junto al coche' : `Rumbo ${Math.round(br)}° (${cardinal(br)})${state.heading == null ? ': orienta el móvil con el norte arriba' : ''} · GPS ±${Math.round(state.pos.acc)} m`;
    updateCarArrow();
  }
  function updateCarArrow() {
    const a = $('#car-arrow');
    if (!a || !state.pos || !state.car) return;
    const br = bearing(state.pos, state.car);
    const rot = state.heading == null ? br : br - state.heading;
    a.style.transform = `rotate(${rot}deg)`;
  }

  /* ------------------------------------------------------------ puntos privados */
  function saveSpots() { store.set('spots', state.spots); drawSpots(); renderSpots(); }
  function newSpotDialog(lat, lon) {
    if (lat == null) return;
    const h = cellAt(lat, lon);
    modal(`<h2>Guardar punto</h2>
      <p class="muted">Se guarda solo en este móvil. Nunca se envía a ningún servidor.</p>
      <label class="field"><span>Nombre</span><input id="sp-name" maxlength="40" placeholder="Por ejemplo: rodal del cortafuegos"></label>
      <label class="field"><span>Notas</span><textarea id="sp-notes" rows="3" placeholder="Qué salió, cuándo, cómo llegar…"></textarea></label>
      <p class="fine">${lat.toFixed(5)}, ${lon.toFixed(5)}${h.cell && h.cell.muni ? ' · ' + esc(h.cell.muni) : ''}</p>
      <div class="m-actions"><button class="btn primary" id="sp-ok">${icon('pin')}Guardar punto</button></div>`);
    setTimeout(() => $('#sp-name').focus(), 100);
    $('#sp-ok').onclick = () => {
      const name = $('#sp-name').value.trim() || `Punto ${state.spots.length + 1}`;
      state.spots.unshift({ id: uid(), name, notes: $('#sp-notes').value.trim(), lat, lon, t: Date.now(), muni: h.cell ? h.cell.muni : null });
      saveSpots();
      closeModal();
      toast('Punto guardado');
    };
  }
  function openSpot(id) {
    const s = state.spots.find(x => x.id === id);
    if (!s) return;
    modal(`<h2>${esc(s.name)}</h2>
      <p class="muted">Guardado el ${fmtDay(new Date(s.t))}${s.muni ? ', ' + esc(s.muni) : ''}</p>
      ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}
      <p class="fine">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</p>
      <div class="m-actions">
        <button class="btn" id="sp-map">${icon('target')}Ver en el mapa</button>
        <button class="btn" id="sp-route">${icon('route')}Cómo llegar</button>
        <button class="btn ghost danger" id="sp-del">${icon('trash')}Borrar punto</button>
      </div>`);
    $('#sp-map').onclick = () => { closeModal(); showTab('map'); map.flyTo(s.lat, s.lon, 15); };
    $('#sp-route').onclick = () => openExternal(`https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(5)},${s.lon.toFixed(5)}`);
    $('#sp-del').onclick = () => {
      if (!confirmInline($('#sp-del'), '¿Seguro? Toca otra vez para borrar')) return;
      state.spots = state.spots.filter(x => x.id !== id);
      saveSpots(); closeModal(); toast('Punto borrado');
    };
  }
  function confirmInline(btn, msg) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.lastChild.textContent = msg;
    return false;
  }
  function renderSpots() {
    const list = $('#spots-list');
    if (!state.spots.length) {
      list.innerHTML = `<div class="empty">${icon('pin', 'big')}<p>Aún no tienes puntos. Mantén el dedo pulsado en el mapa o usa el botón de abajo para guardar tu posición.</p></div>`;
      return;
    }
    list.innerHTML = state.spots.map(s => `<button class="row" data-spot="${s.id}">
      ${icon('pin')}<div><strong>${esc(s.name)}</strong><small>${fmtDay(new Date(s.t))}${s.muni ? ', ' + esc(s.muni) : ''}</small></div></button>`).join('');
  }
  $('#spots-list').addEventListener('click', (e) => { const b = e.target.closest('[data-spot]'); if (b) openSpot(b.dataset.spot); });
  $('#spot-here').addEventListener('click', () => {
    if (!state.pos) { startGps(false); toast('Buscando tu posición… vuelve a tocar en unos segundos'); return; }
    newSpotDialog(state.pos.lat, state.pos.lon);
  });
  $('#toggle-spots').addEventListener('change', (e) => { state.showSpots = e.target.checked; savePrefs(); drawSpots(); });

  /* ------------------------------------------------------------ salidas (diario) */
  function saveOutings() { store.set('outings', state.outings); renderDiary(); }

  function predictionsFor(points, spId, date) {
    const offset = dayDiff(date, today0());
    if (!state.wx || state.wx.todayIdx + offset - 21 < 0 || offset > 7) return null;
    const seen = new Set();
    let best = null;
    points.forEach(p => {
      const h = cellAt(p[0], p[1]);
      if (!h.cell || seen.has(h.id)) return;
      seen.add(h.id);
      const s = scoreCell(h.cell.k, spId, offset);
      if (!best || s.score > best.score) best = { score: s.score, level: s.level, cell: h.id };
    });
    return best ? Object.assign(best, { cells: Array.from(seen) }) : null;
  }

  function startOuting() {
    if (state.active) { toast('Ya hay una salida en curso'); return; }
    state.active = { id: uid(), start: Date.now(), species: state.species === 'todas' ? 'boletus' : state.species, track: [] };
    store.set('active', state.active);
    startGps(true);
    if (IS_APP) window.AndroidBridge.keepScreenOn(true);
    updateOutingBar();
    showTab('map');
    toast('Salida empezada: se guarda tu recorrido mientras la app esté abierta');
    if (!state.car) setTimeout(() => toast('Consejo: guarda también dónde has aparcado (botón del coche)', 4000), 3400);
  }
  let lastTrackSave = 0;
  function addTrackPoint(p) {
    if (p.acc > 50) return;
    const tr = state.active.track;
    const last = tr[tr.length - 1];
    if (last && haversine({ lat: last[0], lon: last[1] }, p) < 15) return;
    tr.push([+p.lat.toFixed(6), +p.lon.toFixed(6), Math.round((Date.now() - state.active.start) / 1000)]);
    if (Date.now() - lastTrackSave > 20000) { store.set('active', state.active); lastTrackSave = Date.now(); }
  }
  function trackLength(tr) {
    let d = 0;
    for (let i = 1; i < tr.length; i++) d += haversine({ lat: tr[i - 1][0], lon: tr[i - 1][1] }, { lat: tr[i][0], lon: tr[i][1] });
    return d;
  }
  function updateOutingBar() {
    const bar = $('#outing-bar');
    if (!state.active) { bar.hidden = true; return; }
    bar.hidden = false;
    const mins = Math.round((Date.now() - state.active.start) / 60000);
    $('#ob-text').textContent = `Salida en curso: ${mins >= 60 ? Math.floor(mins / 60) + ' h ' : ''}${mins % 60} min, ${fmtDist(trackLength(state.active.track))}`;
  }
  setInterval(updateOutingBar, 30000);
  $('#ob-end').addEventListener('click', () => outingForm({ fromActive: true }));
  $('#start-outing').addEventListener('click', startOuting);

  function outingForm(opts) {
    const spDefault = opts.fromActive ? state.active.species : (state.species === 'todas' ? 'boletus' : state.species);
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    modal(`<h2>${opts.fromActive ? 'Terminar salida' : 'Apuntar salida'}</h2>
      <p class="muted">Apuntar también las salidas sin setas es lo que permite comprobar si la predicción acierta.</p>
      ${opts.quick ? `<label class="field"><span>Fecha</span><input type="date" id="o-date" value="${dateStr}" max="${dateStr}"></label>` : ''}
      <label class="field"><span>¿Qué buscabas?</span><select id="o-target">${M.SPECIES.map(s => `<option value="${s.id}" ${s.id === spDefault ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <fieldset class="field"><legend>¿Encontraste lo que buscabas?</legend>
        <div class="seg"><label><input type="radio" name="o-found" value="1"><span>Sí</span></label><label><input type="radio" name="o-found" value="0"><span>No</span></label></div>
      </fieldset>
      <fieldset class="field"><legend>Especies encontradas</legend>
        <div class="checks">${M.SPECIES.map(s => `<label><input type="checkbox" value="${s.id}"><span>${esc(s.short)}</span></label>`).join('')}<label><input type="checkbox" value="otras"><span>Otras</span></label></div>
      </fieldset>
      <label class="field"><span>Kilos (aprox.)</span><input type="number" id="o-kg" min="0" max="50" step="0.1" inputmode="decimal" placeholder="0"></label>
      <label class="field"><span>Notas</span><textarea id="o-notes" rows="2" placeholder="Estado del suelo, gente, cacería…"></textarea></label>
      <div class="m-actions">
        <button class="btn primary" id="o-ok">${icon('check')}Guardar salida</button>
        ${opts.fromActive ? `<button class="btn ghost danger" id="o-discard">${icon('trash')}Descartar salida</button>` : ''}
      </div>`);
    $('#o-ok').onclick = () => {
      const foundEl = $('input[name="o-found"]:checked');
      if (!foundEl) { toast('Indica si encontraste lo que buscabas'); return; }
      const target = $('#o-target').value;
      const species = $$('.checks input:checked').map(i => i.value);
      const found = foundEl.value === '1';
      let rec;
      if (opts.fromActive) {
        const a = state.active;
        const pts = a.track.length ? a.track : (state.pos ? [[state.pos.lat, state.pos.lon]] : []);
        rec = { id: a.id, start: a.start, end: Date.now(), track: a.track, dist: Math.round(trackLength(a.track)) };
        if (pts.length) { rec.lat = pts[0][0]; rec.lon = pts[0][1]; }
        rec.pred = predictionsFor(pts, target, new Date(a.start));
      } else {
        const dt = $('#o-date') ? new Date($('#o-date').value + 'T12:00:00') : new Date();
        rec = { id: uid(), start: dt.getTime(), end: null, track: [], dist: 0, lat: opts.lat, lon: opts.lon };
        rec.pred = predictionsFor([[opts.lat, opts.lon]], target, dt);
      }
      const h = rec.lat != null ? cellAt(rec.lat, rec.lon) : {};
      Object.assign(rec, {
        target, found, species, kg: parseFloat($('#o-kg').value) || 0,
        notes: $('#o-notes').value.trim(), muni: h.cell ? h.cell.muni : null, model: 'v1',
      });
      state.outings.unshift(rec);
      saveOutings();
      if (opts.fromActive) endActive();
      closeModal();
      toast('Salida guardada en tu diario');
    };
    if (opts.fromActive) $('#o-discard').onclick = () => {
      if (!confirmInline($('#o-discard'), '¿Seguro? Toca otra vez')) return;
      endActive(); closeModal(); toast('Salida descartada');
    };
  }
  function endActive() {
    state.active = null;
    store.del('active');
    if (IS_APP) window.AndroidBridge.keepScreenOn(false);
    updateOutingBar();
    map.render();
  }

  function renderDiary() {
    const o = state.outings;
    const scored = o.filter(x => x.pred && x.pred.level >= 3);
    const hits = scored.filter(x => x.found);
    const low = o.filter(x => x.pred && x.pred.level < 3);
    const lowHits = low.filter(x => x.found);
    $('#diary-stats').innerHTML = o.length ? `
      <div class="stat"><span class="big">${scored.length ? Math.round(hits.length * 100 / scored.length) + ' %' : '—'}</span>
        <span>de acierto en zonas alta o muy alta (${hits.length} de ${scored.length} salidas)</span></div>
      <div class="stat"><span class="big">${low.length ? Math.round(lowHits.length * 100 / low.length) + ' %' : '—'}</span>
        <span>con setas en zonas de probabilidad baja o media (${lowHits.length} de ${low.length})</span></div>
      <p class="fine">La meta del modelo v1 es un 60 % de acierto en zonas alta o muy alta. ${o.length} salidas apuntadas.</p>` :
      `<div class="empty">${icon('basket', 'big')}<p>Apunta cada salida, con o sin setas. Con unas cuantas verás aquí cuánto acierta la predicción en tus zonas.</p></div>`;
    $('#diary-list').innerHTML = o.map(x => {
      const sp = M.SPECIES.find(s => s.id === x.target);
      const lv = x.pred ? M.LEVELS[x.pred.level].name : 'sin predicción';
      return `<button class="row" data-out="${x.id}">
        <span class="res ${x.found ? 'yes' : 'no'}">${icon(x.found ? 'check' : 'x')}</span>
        <div><strong>${fmtDay(new Date(x.start))}${x.muni ? ', ' + esc(x.muni) : ''}</strong>
        <small>${esc(sp ? sp.short : x.target)}: predicción ${lv}${x.pred ? ' (' + x.pred.score + ')' : ''}${x.kg ? ', ' + fmtNum(x.kg, 1) + ' kg' : ''}</small></div></button>`;
    }).join('');
  }
  $('#diary-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-out]');
    if (!b) return;
    const x = state.outings.find(o => o.id === b.dataset.out);
    if (!x) return;
    const sp = M.SPECIES.find(s => s.id === x.target);
    modal(`<h2>Salida del ${fmtDay(new Date(x.start))}</h2>
      <ul class="facts">
        <li>${icon('basket')}<span>${esc(sp ? sp.name : x.target)}: ${x.found ? 'encontrada' : 'no encontrada'}${x.kg ? ', ' + fmtNum(x.kg, 1) + ' kg' : ''}</span></li>
        <li>${icon('chart')}<span>Predicción ${x.pred ? M.LEVELS[x.pred.level].name.toLowerCase() + ' (' + x.pred.score + ')' : 'no disponible'}</span></li>
        ${x.species && x.species.length ? `<li>${icon('leaf')}<span>Encontradas: ${x.species.map(id => { const s = M.SPECIES.find(q => q.id === id); return s ? s.short : 'otras'; }).join(', ')}</span></li>` : ''}
        ${x.dist ? `<li>${icon('route')}<span>${fmtDist(x.dist)} recorridos${x.end ? ' en ' + Math.round((x.end - x.start) / 60000) + ' min' : ''}</span></li>` : ''}
        ${x.muni ? `<li>${icon('pin')}<span>${esc(x.muni)}</span></li>` : ''}
      </ul>
      ${x.notes ? `<p class="notes">${esc(x.notes)}</p>` : ''}
      <div class="m-actions">
        ${x.lat != null ? `<button class="btn" id="out-map">${icon('target')}Ver en el mapa</button>` : ''}
        <button class="btn ghost danger" id="out-del">${icon('trash')}Borrar salida</button>
      </div>`);
    if ($('#out-map')) $('#out-map').onclick = () => { closeModal(); showTab('map'); map.flyTo(x.lat, x.lon, 14); };
    $('#out-del').onclick = () => {
      if (!confirmInline($('#out-del'), '¿Seguro? Toca otra vez para borrar')) return;
      state.outings = state.outings.filter(o => o.id !== x.id);
      saveOutings(); closeModal();
    };
  });

  function csvCell(v) { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  $('#export-csv').addEventListener('click', () => {
    if (!state.outings.length) { toast('No hay salidas que exportar'); return; }
    const head = ['fecha', 'hora_inicio', 'minutos', 'especie_buscada', 'encontrada', 'especies_encontradas', 'kg', 'prediccion', 'nivel', 'municipio', 'lat', 'lon', 'distancia_m', 'notas', 'modelo'];
    const rows = state.outings.map(x => {
      const d = new Date(x.start);
      return [d.toISOString().slice(0, 10), fmtTime(d), x.end ? Math.round((x.end - x.start) / 60000) : '', x.target, x.found ? 'si' : 'no',
        (x.species || []).join(' '), x.kg || 0, x.pred ? x.pred.score : '', x.pred ? M.LEVELS[x.pred.level].name : '', x.muni || '',
        x.lat != null ? x.lat.toFixed(4) : '', x.lon != null ? x.lon.toFixed(4) : '', x.dist || 0, x.notes || '', x.model || ''].map(csvCell).join(';');
    });
    shareFile(`buscasetas-salidas-${W.todayStr()}.csv`, 'text/csv', '﻿' + head.join(';') + '\n' + rows.join('\n') + '\n');
  });

  /* copia de seguridad */
  $('#backup-export').addEventListener('click', () => {
    const data = { app: 'BuscaSetas', version: 1, exported: new Date().toISOString(), spots: state.spots, outings: state.outings, car: state.car };
    shareFile(`buscasetas-copia-${W.todayStr()}.json`, 'application/json', JSON.stringify(data));
  });
  $('#backup-import').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (d.app !== 'BuscaSetas') throw new Error('no es una copia de BuscaSetas');
        const ids = new Set(state.spots.map(s => s.id));
        (d.spots || []).forEach(s => { if (!ids.has(s.id)) state.spots.push(s); });
        const oids = new Set(state.outings.map(s => s.id));
        (d.outings || []).forEach(s => { if (!oids.has(s.id)) state.outings.push(s); });
        state.outings.sort((a, b) => b.start - a.start);
        saveSpots(); saveOutings();
        toast(`Copia restaurada: ${(d.spots || []).length} puntos y ${(d.outings || []).length} salidas`);
      } catch (err) { toast('No se pudo leer la copia: ' + err.message, 5000); }
      e.target.value = '';
    };
    rd.readAsText(f);
  });

  /* ------------------------------------------------------------ capas y descarga sin cobertura */
  $('#fab-layers').addEventListener('click', () => {
    modal(`<h2>Mapa de fondo</h2>
      <div class="radio-list">${Object.values(BASES).map(b => `<label><input type="radio" name="base" value="${b.id}" ${b.id === state.base ? 'checked' : ''}><span>${esc(b.name)}</span></label>`).join('')}</div>
      <label class="switch"><input type="checkbox" id="sw-spots" ${state.showSpots ? 'checked' : ''}><span>Mostrar mis puntos</span></label>
      <h3>Usar sin cobertura</h3>
      <p class="muted">Descarga el mapa de fondo de lo que ves ahora en pantalla, con más detalle al acercarte. La predicción y la normativa ya van dentro de la app; la lluvia se guarda al actualizarla.</p>
      <p class="fine" id="dl-info">Comprobando mapas guardados…</p>
      <div class="progress" id="dl-prog" hidden><span></span></div>
      <div class="m-actions">
        <button class="btn primary" id="dl-go">${icon('download')}Descargar esta zona</button>
        <button class="btn ghost" id="dl-clear">${icon('trash')}Borrar mapas descargados</button>
      </div>`);
    $$('input[name="base"]').forEach(r => r.onchange = () => {
      state.base = r.value; savePrefs(); map.setBaseLayer(BASES[state.base]);
    });
    $('#sw-spots').onchange = (e) => { state.showSpots = e.target.checked; $('#toggle-spots').checked = state.showSpots; savePrefs(); drawSpots(); };
    const info = () => U.tileCacheInfo().then(i => { if ($('#dl-info')) $('#dl-info').textContent = `${fmtNum(i.count)} teselas guardadas en el móvil.`; });
    info();
    $('#dl-clear').onclick = () => U.clearTileCache().then(() => { info(); toast('Mapas descargados borrados'); });
    $('#dl-go').onclick = async () => {
      const base = BASES[state.base];
      if (!base.offline) { toast('Esta capa no permite descargas. Cambia a Topográfico IGN u Ortofoto.', 4500); return; }
      if (!window.caches) { toast('Este dispositivo no permite guardar mapas'); return; }
      const urls = map.tilesForView(map.zoom < 13 ? 3 : 2, 2500);
      if (urls.length > 2500) { toast('Zona demasiado grande: acércate un poco más y vuelve a intentarlo', 4500); return; }
      const btn = $('#dl-go');
      btn.disabled = true;
      $('#dl-prog').hidden = false;
      const res = await U.downloadTiles(urls, (done, total, failed) => {
        if (!$('#dl-prog')) return;
        $('#dl-prog span').style.width = Math.round(done * 100 / total) + '%';
        $('#dl-info').textContent = `Descargando ${done} de ${total} teselas${failed ? ` (${failed} fallos)` : ''}…`;
      });
      btn.disabled = false;
      if (res.corsBlocked === res.done && res.done > 0) toast('El servidor del IGN no permitió la descarga. Prueba con la otra capa.', 5000);
      else toast(`Zona descargada: ${res.done - res.failed} teselas`);
      info();
    };
  });

  /* ------------------------------------------------------------ especies y ayuda */
  function renderSpeciesTab() {
    const I = C.SPECIES_INFO;
    $('#species-list').innerHTML = `
      <details class="card deadly" open>
        <summary>${icon('skull')}<span>Especies mortales de la zona</span></summary>
        <p>Una sola de estas setas en la cesta puede matar. Aprende a reconocerlas antes que las comestibles.</p>
        <ul class="plain">${C.DEADLY.map(d => `<li><strong>${esc(d.name)}.</strong> ${esc(d.tell)}</li>`).join('')}</ul>
      </details>
      ${M.SPECIES.map(sp => {
        const x = I[sp.id];
        return `<details class="card">
          <summary><span class="sw" style="--c:${sp.id === 'niscalo' ? '#D9792B' : sp.id === 'rebozuelo' ? '#E2B42E' : sp.id === 'cesarea' ? '#D9542B' : '#8A5126'}"></span><span>${esc(x.title)}</span></summary>
          <p class="muted">${esc(x.aka)}</p>
          <h4>Cómo es</h4><ul class="plain">${x.look.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          <h4>Dónde y cuándo</h4><p>${esc(x.where)}</p>
          <h4>Con qué se confunde</h4>
          <ul class="look">${x.lookalikes.map(l => `<li><strong>${esc(l.name)}</strong> <em class="risk ${/mortal/i.test(l.risk) ? 'mortal' : ''}">${esc(l.risk)}</em><br>${esc(l.tell)}</li>`).join('')}</ul>
          ${x.rule ? `<p class="rule">${esc(x.rule)}</p>` : ''}
        </details>`;
      }).join('')}`;
  }

  function renderHelp() {
    const S = C.SAFETY, L = C.LEGAL;
    $('#sos-block').innerHTML = `
      <a class="callbtn red" href="tel:112">${icon('phone')}<span><strong>Llamar al 112</strong><small>Emergencias y rescate en montaña</small></span></a>
      <a class="callbtn" href="tel:${S.toxPhone}">${icon('phone')}<span><strong>${S.toxPhoneLabel}</strong><small>${esc(S.toxName)}</small></span></a>
      <ul class="plain">${S.symptoms.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
    $('#legal-block').innerHTML = `
      <p class="lead">${esc(L.headline)}</p>
      <ul class="plain">${L.general.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      ${L.acotados.map(a => `<div class="acot">
        <strong>${esc(a.name)}</strong><p>${esc(a.where)}</p><p>${esc(a.price)}</p>
        ${a.url ? `<button class="btn ghost small" data-url="${esc(a.url)}">${icon('ticket')}${esc(a.urlLabel)}</button>` : ''}
        <small>Fuente: ${esc(a.source)}</small></div>`).join('')}
      <p class="fine">Información recopilada el ${fmtDay(new Date(L.verified + 'T12:00:00'))}. Las normas cambian cada temporada: la responsabilidad de cumplirlas es de quien recolecta.</p>`;
    $('#practices').innerHTML = S.practices.map(s => `<li>${esc(s)}</li>`).join('');
    $('#data-info').innerHTML = `Datos de hábitat generados el ${esc(D.generated)}${D.synthetic ? ' <strong>(DATOS DE PRUEBA, no reales)</strong>' : ''} a partir de ${esc(D.sources.join(', '))}. ${fmtNum(cells.length)} cuadrículas con bosque. Lluvia y temperatura: Open-Meteo.com (CC BY 4.0). Mapas: IGN (CC BY 4.0) y OpenStreetMap.`;
    $('#app-version').textContent = IS_APP && window.AndroidBridge.version ? 'Versión ' + window.AndroidBridge.version() : 'Versión web de prueba';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-url]');
    if (b) { e.preventDefault(); openExternal(b.dataset.url); }
  });

  /* ------------------------------------------------------------ pestañas, modal y atrás */
  function showTab(t) {
    state.tab = t;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + t));
    $$('#tabs [data-tab]').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('sel', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    if (t !== 'map') closeSheet();
    if (t === 'map') requestAnimationFrame(() => map.resize());
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.goto)));

  let modalKind = null;
  function modal(html, kind) {
    $('#modal-body').innerHTML = html;
    $('#modal').classList.add('open');
    $('#modal').setAttribute('aria-hidden', 'false');
    modalKind = kind || null;
  }
  function closeModal() {
    $('#modal').classList.remove('open');
    $('#modal').setAttribute('aria-hidden', 'true');
    modalKind = null;
  }
  $('#modal-close').addEventListener('click', () => { if (!$('#modal').classList.contains('locked')) closeModal(); });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').classList.contains('locked')) closeModal(); });

  window.appBack = function () {
    if ($('#modal').classList.contains('open')) { if (!$('#modal').classList.contains('locked')) closeModal(); return true; }
    if (sheetOpen()) { closeSheet(); return true; }
    if (state.tab !== 'map') { showTab('map'); return true; }
    return false;
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.appBack(); });

  /* ------------------------------------------------------------ aviso inicial */
  function disclaimer() {
    if (store.get('accepted', 0) >= 1) return;
    $('#modal').classList.add('locked');
    modal(`<h2>Antes de empezar</h2>
      <p>BuscaSetas es un <strong>prototipo</strong> para probar en Pinares de Soria y Burgos.</p>
      <ul class="plain">
        <li>La predicción es orientativa y todavía no está calibrada.</li>
        <li>La app <strong>nunca</strong> te dirá que una seta es comestible. Si dudas, no la comas.</li>
        <li>La normativa puede no estar al día. Cumplirla es responsabilidad tuya.</li>
        <li>Tus puntos y salidas se guardan solo en este móvil.</li>
      </ul>
      <label class="switch"><input type="checkbox" id="acc-ok"><span>Lo entiendo</span></label>
      <div class="m-actions"><button class="btn primary" id="acc-go" disabled>Empezar</button></div>`);
    $('#acc-ok').onchange = (e) => { $('#acc-go').disabled = !e.target.checked; };
    $('#acc-go').onclick = () => { store.set('accepted', 1); $('#modal').classList.remove('locked'); closeModal(); };
  }

  /* ------------------------------------------------------------ arranque */
  renderSpeciesChips();
  renderDayChips();
  renderSpots();
  renderDiary();
  renderSpeciesTab();
  renderHelp();
  drawCar();
  drawSpots();
  $('#toggle-spots').checked = state.showSpots;
  if (state.active) { updateOutingBar(); startGps(false); if (IS_APP) window.AndroidBridge.keepScreenOn(true); }
  recompute();
  loadWeather(false);
  disclaimer();
  if (D.synthetic) setTimeout(() => toast('Atención: datos de bosque de PRUEBA, no reales', 5000), 800);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.meteo && Date.now() - new Date(state.meteo.fetched) > 3 * 3600e3) loadWeather(false);
  });
  window.__bs = { state, map, cells, recompute };
})();
