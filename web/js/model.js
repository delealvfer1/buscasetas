/* BuscaSetas · modelo de predicción v1 (reglas explicables)
 *   P = 100 · H · M · T
 *   H hábitat (árbol huésped, cobertura y altitud), M meteorología (lluvia en la
 *   ventana de latencia, temperatura, heladas y sequía reciente), T temporada.
 * Los umbrales son hipótesis de partida para calibrar en campo con el diario de salidas.
 */
(function (global) {
  'use strict';

  // ventanas de temporada: [inicio rampa, inicio pleno, fin pleno, fin rampa, peso] en 'MM-DD'
  const SPECIES = [
    {
      id: 'boletus', short: 'Boletus', name: 'Boletus edulis / pinophilus',
      hostLabel: 'pinar, hayedo o rebollar',
      host: { pino: 1, frondosa: 0.85, mixto: 1, desconocido: 0.75 },
      alt: [900, 1900], rainWin: [8, 21], rain: [15, 45], tmax: [13, 22], frost: -1,
      season: [['08-20', '09-10', '11-05', '11-30', 1], ['05-25', '06-10', '06-30', '07-15', 0.5]],
    },
    {
      id: 'niscalo', short: 'Níscalo', name: 'Níscalo (Lactarius deliciosus)',
      hostLabel: 'pinar',
      host: { pino: 1, frondosa: 0.05, mixto: 0.6, desconocido: 0.7 },
      alt: [300, 1700], rainWin: [6, 16], rain: [15, 40], tmax: [10, 20], frost: -3,
      season: [['09-20', '10-10', '11-25', '12-20', 1]],
    },
    {
      id: 'rebozuelo', short: 'Rebozuelo', name: 'Rebozuelo (Cantharellus)',
      hostLabel: 'rebollar, hayedo o pinar',
      host: { pino: 0.7, frondosa: 1, mixto: 1, desconocido: 0.6 },
      alt: [200, 1600], rainWin: [5, 18], rain: [20, 50], tmax: [14, 25], frost: -1,
      season: [['06-01', '06-20', '11-05', '11-30', 1]],
    },
    {
      id: 'aereus', short: 'Boletus de verano', name: 'Boletus aereus / reticulatus',
      hostLabel: 'rebollar, encinar o castañar',
      host: { pino: 0.05, frondosa: 1, mixto: 0.6, desconocido: 0.3 },
      alt: [300, 1300], rainWin: [6, 16], rain: [15, 40], tmax: [18, 29], frost: 0,
      season: [['05-25', '06-15', '10-05', '10-31', 1]],
    },
    {
      id: 'cesarea', short: 'Oronja', name: 'Amanita caesarea (oronja)',
      hostLabel: 'rebollar, encinar o castañar',
      host: { pino: 0.05, frondosa: 1, mixto: 0.6, desconocido: 0.3 },
      alt: [300, 1250], rainWin: [6, 16], rain: [15, 40], tmax: [20, 29], frost: 2,
      season: [['07-25', '08-15', '10-05', '10-31', 1]],
    },
  ];

  const LEVELS = [
    { min: 0, name: 'Muy baja', color: null },
    { min: 15, name: 'Baja', color: '#F7E27A' },
    { min: 35, name: 'Media', color: '#F2A33A' },
    { min: 55, name: 'Alta', color: '#E2572B' },
    { min: 72, name: 'Muy alta', color: '#A3195B' },
  ];

  function levelOf(score) {
    let l = 0;
    for (let i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i].min) l = i;
    return l;
  }

  function ramp(v, a, b) { return v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a); }
  function trapezoid(v, a, b, c, d) {
    if (v <= a || v >= d) return 0;
    if (v < b) return (v - a) / (b - a);
    if (v <= c) return 1;
    return (d - v) / (d - c);
  }

  function doy(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
  }
  function mdToDoy(md, year) {
    const [m, d] = md.split('-').map(Number);
    return doy(new Date(year, m - 1, d));
  }

  function seasonFactor(sp, date) {
    const y = date.getFullYear(), v = doy(date);
    let best = 0;
    for (const w of sp.season) {
      const f = trapezoid(v, mdToDoy(w[0], y), mdToDoy(w[1], y), mdToDoy(w[2], y), mdToDoy(w[3], y)) * w[4];
      if (f > best) best = f;
    }
    return best;
  }

  function habitat(sp, cell) {
    const cov = (cell.pino * sp.host.pino + cell.frondosa * sp.host.frondosa +
      cell.mixto * sp.host.mixto + cell.desconocido * sp.host.desconocido) / 100;
    const hc = Math.min(1, cov / 0.35);
    const [lo, hi] = sp.alt;
    const af = cell.alt >= lo && cell.alt <= hi ? 1 : cell.alt < lo ? ramp(cell.alt, lo - 250, lo) : 1 - ramp(cell.alt, hi, hi + 250);
    return { H: hc * af, cov, hc, af };
  }

  /** w: {rain, tmax, tmin} arrays (por día); di: índice del día objetivo */
  function meteo(sp, w, di) {
    let rain = 0;
    for (let d = di - sp.rainWin[1]; d <= di - sp.rainWin[0]; d++) rain += w.rain[d] || 0;
    const R = ramp(rain, sp.rain[0], sp.rain[1]);
    let ts = 0, tn = 0, fmin = 99, recent = 0;
    for (let d = di - 6; d <= di; d++) {
      if (w.tmax[d] != null) { ts += w.tmax[d]; tn++; }
      if (w.tmin[d] != null && w.tmin[d] < fmin) fmin = w.tmin[d];
    }
    for (let d = di - 5; d <= di; d++) recent += w.rain[d] || 0;
    const tm = tn ? ts / tn : 15;
    const T = trapezoid(tm, sp.tmax[0] - 7, sp.tmax[0], sp.tmax[1], sp.tmax[1] + 7);
    const F = fmin >= sp.frost ? 1 : fmin <= sp.frost - 5 ? 0.1 : 1 - 0.9 * (sp.frost - fmin) / 5;
    const D = recent < 2 && tm > 24 ? 0.6 : 1;
    return { M: R * T * F * D, rain, R, tm, T, fmin, F, D, recent };
  }

  function score(sp, cell, w, di, date) {
    const h = habitat(sp, cell);
    const s = seasonFactor(sp, date);
    if (!w) {
      const v = Math.round(100 * h.H * s * 0.5);
      return { score: v, level: levelOf(v), h, m: null, s, noWeather: true };
    }
    const m = meteo(sp, w, di);
    const v = Math.round(100 * h.H * m.M * s);
    return { score: v, level: levelOf(v), h, m, s };
  }

  global.SetaModel = { SPECIES, LEVELS, levelOf, score, habitat, meteo, seasonFactor };
})(window);
