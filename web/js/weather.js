/* BuscaSetas · meteorología (Open-Meteo): 30 días pasados + 7 de previsión
 * en una rejilla de puntos sobre la región, interpolada a cada celda de 1 km
 * con corrección de temperatura por altitud. Se guarda en el móvil para usar sin red.
 */
(function (global) {
  'use strict';

  const KEY = 'bs.meteo.v1';
  const PAST = 30, FUTURE = 8;
  const NLAT = 6, NLON = 8;
  const LAPSE = -0.0065; // °C por metro

  function gridPoints(region) {
    const pts = [];
    for (let i = 0; i < NLAT; i++) {
      for (let j = 0; j < NLON; j++) {
        pts.push({
          lat: region.min_lat + (region.max_lat - region.min_lat) * i / (NLAT - 1),
          lon: region.min_lon + (region.max_lon - region.min_lon) * j / (NLON - 1),
        });
      }
    }
    return pts;
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* almacenamiento lleno */ }
  }

  async function fetchMeteo(region) {
    const pts = gridPoints(region);
    const lat = pts.map(p => p.lat.toFixed(3)).join(',');
    const lon = pts.map(p => p.lon.toFixed(3)).join(',');
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min' +
      '&past_days=' + PAST + '&forecast_days=' + FUTURE + '&timezone=Europe%2FMadrid';
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(to); }
    if (!res.ok) throw new Error('Open-Meteo respondió ' + res.status);
    let js = await res.json();
    if (!Array.isArray(js)) js = [js];
    if (js.length !== pts.length) throw new Error('Respuesta incompleta de Open-Meteo');
    const time = js[0].daily.time;
    const d = {
      fetched: new Date().toISOString(),
      region: region.id,
      time,
      elev: js.map(p => p.elevation),
      rain: js.map(p => p.daily.precipitation_sum.map(v => v == null ? 0 : v)),
      tmax: js.map(p => p.daily.temperature_2m_max),
      tmin: js.map(p => p.daily.temperature_2m_min),
    };
    save(d);
    return d;
  }

  /** Devuelve los datos guardados y, si son viejos (> maxAgeH) intenta actualizarlos. */
  async function get(region, opts) {
    opts = opts || {};
    const cached = load();
    const fresh = cached && cached.region === region.id && (Date.now() - new Date(cached.fetched)) < (opts.maxAgeH || 3) * 3600e3;
    if (fresh && !opts.force) return { data: cached, source: 'cache' };
    try {
      const d = await fetchMeteo(region);
      return { data: d, source: 'red' };
    } catch (e) {
      if (cached && cached.region === region.id) return { data: cached, source: 'cache', error: e };
      return { data: null, source: 'ninguna', error: e };
    }
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * Precalcula las series de cada celda.
   * cells: array de {lat, lon, alt}; devuelve {days, todayIdx, series: Array<{rain,tmax,tmin}>}
   */
  function interpolate(meteo, region, cells) {
    const nd = meteo.time.length;
    let todayIdx = meteo.time.indexOf(todayStr());
    if (todayIdx < 0) {
      // datos de otro día: busca la fecha más cercana
      const t = new Date(todayStr()).getTime();
      todayIdx = Math.min(nd - 1, Math.max(0, Math.round((t - new Date(meteo.time[0]).getTime()) / 86400e3)));
    }
    const series = new Array(cells.length);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const fi = (c.lat - region.min_lat) / (region.max_lat - region.min_lat) * (NLAT - 1);
      const fj = (c.lon - region.min_lon) / (region.max_lon - region.min_lon) * (NLON - 1);
      const i0 = Math.max(0, Math.min(NLAT - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(NLON - 2, Math.floor(fj)));
      const di = Math.max(0, Math.min(1, fi - i0)), dj = Math.max(0, Math.min(1, fj - j0));
      const idx = [i0 * NLON + j0, i0 * NLON + j0 + 1, (i0 + 1) * NLON + j0, (i0 + 1) * NLON + j0 + 1];
      const wts = [(1 - di) * (1 - dj), (1 - di) * dj, di * (1 - dj), di * dj];
      let elev = 0;
      for (let q = 0; q < 4; q++) elev += wts[q] * (meteo.elev[idx[q]] || 0);
      const dz = (c.alt || elev) - elev;
      const rain = new Float32Array(nd), tmax = new Array(nd), tmin = new Array(nd);
      for (let d = 0; d < nd; d++) {
        let r = 0, tx = 0, tn = 0, wx = 0, wn = 0;
        for (let q = 0; q < 4; q++) {
          r += wts[q] * (meteo.rain[idx[q]][d] || 0);
          const a = meteo.tmax[idx[q]][d], b = meteo.tmin[idx[q]][d];
          if (a != null) { tx += wts[q] * a; wx += wts[q]; }
          if (b != null) { tn += wts[q] * b; wn += wts[q]; }
        }
        rain[d] = r;
        tmax[d] = wx ? tx / wx + LAPSE * dz : null;
        tmin[d] = wn ? tn / wn + LAPSE * dz : null;
      }
      series[k] = { rain, tmax, tmin };
    }
    return { days: meteo.time, todayIdx, series };
  }

  function ageText(iso) {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 2) return 'ahora mismo';
    if (mins < 60) return 'hace ' + mins + ' min';
    const h = Math.round(mins / 60);
    if (h < 36) return 'hace ' + h + ' h';
    return 'hace ' + Math.round(h / 24) + ' días';
  }

  global.SetaWeather = { get, interpolate, ageText, todayStr, PAST, FUTURE };
})(window);
