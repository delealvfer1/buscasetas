/* BuscaSetas · motor de mapa ligero (teselas + capa canvas + marcadores)
 * Sin dependencias: proyección Web Mercator, arrastre, pellizco, rueda, doble toque,
 * pulsación larga e inercia. Las teselas se guardan en Cache Storage cuando se
 * descargan para usar sin cobertura.
 */
(function (global) {
  'use strict';

  const TILE = 256;
  const TILE_CACHE = 'teselas-v1';

  function worldSize(z) { return TILE * Math.pow(2, z); }
  function lon2x(lon, z) { return (lon + 180) / 360 * worldSize(z); }
  function lat2y(lat, z) {
    const s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z);
  }
  function x2lon(x, z) { return x / worldSize(z) * 360 - 180; }
  function y2lat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / worldSize(z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function tileUrl(template, z, x, y) {
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  class SetaMap {
    constructor(el, opts) {
      opts = opts || {};
      this.el = el;
      this.minZoom = opts.minZoom || 7;
      this.maxZoom = opts.maxZoom || 18;
      this.center = { lat: opts.lat || 41.9, lon: opts.lon || -2.95 };
      this.zoom = opts.zoom || 11;
      this.base = null;
      this.tiles = new Map();
      this.overlays = [];
      this.markers = new Set();
      this.handlers = {};
      this.useCache = !!(global.caches && opts.cache !== false);
      this._raf = 0;
      this._anim = null;
      this._build();
      this._bind();
      this.resize();
    }

    /* ---------- construcción ---------- */
    _build() {
      const el = this.el;
      el.classList.add('sm-map');
      el.style.touchAction = 'none';
      this.tilePane = document.createElement('div');
      this.tilePane.className = 'sm-tiles';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sm-canvas';
      this.markerPane = document.createElement('div');
      this.markerPane.className = 'sm-markers';
      this.attrib = document.createElement('div');
      this.attrib.className = 'sm-attrib';
      el.append(this.tilePane, this.canvas, this.markerPane, this.attrib);
      this.ctx = this.canvas.getContext('2d');
      if (global.ResizeObserver) {
        new ResizeObserver(() => this.resize()).observe(el);
      } else {
        global.addEventListener('resize', () => this.resize());
      }
    }

    resize() {
      const r = this.el.getBoundingClientRect();
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.dpr = global.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
      this.render(true);
    }

    /* ---------- API pública ---------- */
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
    emit(ev, data) { (this.handlers[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

    setBaseLayer(layer) {
      this.base = layer;
      for (const [k, t] of this.tiles) { this._dropTile(k, t); }
      this.attrib.innerHTML = layer.attribution || '';
      this.render(true);
    }

    getCenter() { return { lat: this.center.lat, lon: this.center.lon }; }
    getZoom() { return this.zoom; }

    setView(lat, lon, zoom) {
      this._stopAnim();
      this.center = { lat, lon };
      if (zoom != null) this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
      this.render(true);
      this.emit('moveend');
    }

    flyTo(lat, lon, zoom, ms) {
      zoom = zoom == null ? this.zoom : clamp(zoom, this.minZoom, this.maxZoom);
      ms = ms || 450;
      const from = { lat: this.center.lat, lon: this.center.lon, zoom: this.zoom };
      const t0 = performance.now();
      this._stopAnim();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.zoom = from.zoom + (zoom - from.zoom) * e;
        // interpola en coordenadas de mundo para un movimiento recto
        const z = this.zoom;
        const fx = lon2x(from.lon, z), fy = lat2y(from.lat, z);
        const tx = lon2x(lon, z), ty = lat2y(lat, z);
        this.center = { lon: x2lon(fx + (tx - fx) * e, z), lat: y2lat(fy + (ty - fy) * e, z) };
        this.render(true);
        if (k < 1) this._anim = requestAnimationFrame(step);
        else { this._anim = null; this.emit('moveend'); }
      };
      this._anim = requestAnimationFrame(step);
    }

    fitBounds(minLat, minLon, maxLat, maxLon, pad) {
      pad = pad == null ? 24 : pad;
      let z = this.maxZoom;
      for (; z > this.minZoom; z -= 0.25) {
        const w = lon2x(maxLon, z) - lon2x(minLon, z);
        const h = lat2y(minLat, z) - lat2y(maxLat, z);
        if (w <= this.w - pad * 2 && h <= this.h - pad * 2) break;
      }
      this.setView((minLat + maxLat) / 2, (minLon + maxLon) / 2, z);
    }

    zoomAround(newZoom, sx, sy, animate) {
      newZoom = clamp(newZoom, this.minZoom, this.maxZoom);
      const ll = this.screenToLatLng(sx, sy);
      if (!animate) {
        this.zoom = newZoom;
        this._keepUnder(ll, sx, sy);
        this.render(true);
        return;
      }
      const z0 = this.zoom, t0 = performance.now(), ms = 260;
      this._stopAnim();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        this.zoom = z0 + (newZoom - z0) * e;
        this._keepUnder(ll, sx, sy);
        this.render(true);
        if (k < 1) this._anim = requestAnimationFrame(step);
        else { this._anim = null; this.emit('moveend'); }
      };
      this._anim = requestAnimationFrame(step);
    }

    latLngToScreen(lat, lon) {
      const z = this.zoom;
      return {
        x: lon2x(lon, z) - lon2x(this.center.lon, z) + this.w / 2,
        y: lat2y(lat, z) - lat2y(this.center.lat, z) + this.h / 2,
      };
    }

    screenToLatLng(x, y) {
      const z = this.zoom;
      const wx = lon2x(this.center.lon, z) + x - this.w / 2;
      const wy = lat2y(this.center.lat, z) + y - this.h / 2;
      return { lat: y2lat(wy, z), lon: x2lon(wx, z) };
    }

    /** metros por píxel en el centro */
    metersPerPixel() {
      return 156543.03392 * Math.cos(this.center.lat * Math.PI / 180) / Math.pow(2, this.zoom);
    }

    getBounds() {
      const a = this.screenToLatLng(0, 0), b = this.screenToLatLng(this.w, this.h);
      return { minLat: b.lat, maxLat: a.lat, minLon: a.lon, maxLon: b.lon };
    }

    addOverlay(fn) { this.overlays.push(fn); this.render(); return fn; }

    addMarker(el, lat, lon, opts) {
      opts = opts || {};
      const m = { el, lat, lon, ax: opts.anchorX == null ? 0.5 : opts.anchorX, ay: opts.anchorY == null ? 0.5 : opts.anchorY };
      el.classList.add('sm-marker');
      if (opts.onClick) {
        el.addEventListener('pointerdown', e => e.stopPropagation());
        el.addEventListener('click', e => { e.stopPropagation(); opts.onClick(e); });
      } else {
        el.style.pointerEvents = 'none';
      }
      this.markerPane.appendChild(el);
      const self = this;
      m.setLatLng = function (la, lo) { m.lat = la; m.lon = lo; self._placeMarker(m); };
      m.remove = function () { el.remove(); self.markers.delete(m); };
      this.markers.add(m);
      this._placeMarker(m);
      return m;
    }

    /** Lista de URLs de teselas para descargar la vista actual hasta maxZ */
    tilesForView(extraLevels, maxTiles) {
      if (!this.base) return [];
      const b = this.getBounds();
      const z0 = Math.max(this.minZoom, Math.round(this.zoom));
      const zMax = Math.min(this.base.maxZoom || 18, z0 + extraLevels);
      const urls = [];
      for (let z = Math.max(this.minZoom, z0 - 2); z <= zMax; z++) {
        const x0 = Math.floor(lon2x(b.minLon, z) / TILE), x1 = Math.floor(lon2x(b.maxLon, z) / TILE);
        const y0 = Math.floor(lat2y(b.maxLat, z) / TILE), y1 = Math.floor(lat2y(b.minLat, z) / TILE);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          urls.push(tileUrl(this.base.url, z, x, y));
          if (urls.length > maxTiles) return urls;
        }
      }
      return urls;
    }

    /* ---------- render ---------- */
    render(now) {
      if (now) { this._draw(); return; }
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }

    _draw() {
      this._drawTiles();
      this._drawOverlays();
      for (const m of this.markers) this._placeMarker(m);
      this.emit('move');
    }

    _placeMarker(m) {
      const p = this.latLngToScreen(m.lat, m.lon);
      const visible = p.x > -80 && p.y > -80 && p.x < this.w + 80 && p.y < this.h + 80;
      m.el.style.display = visible ? '' : 'none';
      if (!visible) return;
      const w = m.el.offsetWidth, h = m.el.offsetHeight;
      m.el.style.transform = `translate(${Math.round(p.x - w * m.ax)}px, ${Math.round(p.y - h * m.ay)}px)`;
    }

    _drawOverlays() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      for (const fn of this.overlays) {
        ctx.save();
        try { fn(ctx, this); } catch (e) { console.error(e); }
        ctx.restore();
      }
    }

    _drawTiles() {
      if (!this.base) return;
      const maxNative = this.base.maxZoom || 18;
      const tz = clamp(Math.round(this.zoom), this.minZoom, maxNative);
      const scale = Math.pow(2, this.zoom - tz);
      const size = TILE * scale;
      const cx = lon2x(this.center.lon, this.zoom), cy = lat2y(this.center.lat, this.zoom);
      const offX = cx - this.w / 2, offY = cy - this.h / 2;
      const x0 = Math.floor(offX / size), x1 = Math.floor((offX + this.w) / size);
      const n = Math.pow(2, tz);
      const y0 = Math.max(0, Math.floor(offY / size)), y1 = Math.min(n - 1, Math.floor((offY + this.h) / size));
      const lid = this.base.id;
      const needed = new Set();
      let allLoaded = true;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${lid}/${tz}/${x}/${y}`;
          needed.add(key);
          let t = this.tiles.get(key);
          if (!t) t = this._createTile(key, tz, x, y);
          if (!t.loaded && !t.failed) allLoaded = false;
        }
      }
      for (const [key, t] of this.tiles) {
        if (t.layer !== lid) { this._dropTile(key, t); continue; }
        const s2 = TILE * Math.pow(2, this.zoom - t.z);
        const left = Math.floor(t.x * s2 - offX), top = Math.floor(t.y * s2 - offY);
        const right = Math.floor((t.x + 1) * s2 - offX), bottom = Math.floor((t.y + 1) * s2 - offY);
        const onScreen = right > 0 && bottom > 0 && left < this.w && top < this.h;
        if (needed.has(key)) {
          t.img.style.zIndex = 2;
        } else if (!allLoaded && onScreen && Math.abs(t.z - tz) <= 3) {
          t.img.style.zIndex = 1; // tesela de otro nivel mientras cargan las nuevas
        } else {
          this._dropTile(key, t);
          continue;
        }
        t.img.style.transform = `translate(${left}px, ${top}px)`;
        t.img.style.width = (right - left + 0.5) + 'px';
        t.img.style.height = (bottom - top + 0.5) + 'px';
      }
    }

    _createTile(key, z, x, y) {
      const img = document.createElement('img');
      img.className = 'sm-tile';
      img.alt = '';
      img.draggable = false;
      const t = { img, z, x, y, layer: this.base.id, loaded: false, failed: false, objUrl: null };
      img.onload = () => { t.loaded = true; img.classList.add('ok'); this.render(); };
      img.onerror = () => { t.failed = true; this.render(); };
      this.tiles.set(key, t);
      this.tilePane.appendChild(img);
      const url = tileUrl(this.base.url, z, x, y);
      if (this.useCache) {
        global.caches.open(TILE_CACHE).then(c => c.match(url)).then(resp => {
          if (!this.tiles.has(key)) return;
          if (resp) {
            return resp.blob().then(b => { t.objUrl = URL.createObjectURL(b); img.src = t.objUrl; });
          }
          img.src = url;
        }).catch(() => { img.src = url; });
      } else {
        img.src = url;
      }
      return t;
    }

    _dropTile(key, t) {
      t.img.onload = t.img.onerror = null;
      t.img.remove();
      if (t.objUrl) URL.revokeObjectURL(t.objUrl);
      this.tiles.delete(key);
    }

    _keepUnder(ll, sx, sy) {
      const z = this.zoom;
      const wx = lon2x(ll.lon, z) - (sx - this.w / 2);
      const wy = lat2y(ll.lat, z) - (sy - this.h / 2);
      this.center = { lon: x2lon(wx, z), lat: y2lat(wy, z) };
    }

    _stopAnim() { if (this._anim) { cancelAnimationFrame(this._anim); this._anim = null; } }

    /* ---------- gestos ---------- */
    _bind() {
      const el = this.el;
      const pts = new Map();
      let mode = null, start = null, lastTap = null, tapTimer = 0, pressTimer = 0, moved = false;
      let vel = [];

      const local = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

      const startPan = (p) => {
        mode = 'pan';
        start = { p, cx: lon2x(this.center.lon, this.zoom), cy: lat2y(this.center.lat, this.zoom), t: performance.now() };
        vel = [{ x: p.x, y: p.y, t: performance.now() }];
      };
      const startPinch = () => {
        const [a, b] = [...pts.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        mode = 'pinch';
        start = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, ll: this.screenToLatLng(mid.x, mid.y) };
      };

      el.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button > 0) return;
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        this._stopAnim();
        const p = local(e);
        pts.set(e.pointerId, p);
        if (pts.size === 1) {
          moved = false;
          startPan(p);
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => {
            if (!moved && pts.size === 1) {
              mode = 'press';
              const ll = this.screenToLatLng(p.x, p.y);
              this.emit('longpress', { lat: ll.lat, lon: ll.lon, x: p.x, y: p.y });
            }
          }, 600);
        } else if (pts.size === 2) {
          clearTimeout(pressTimer);
          moved = true;
          startPinch();
        }
      });

      el.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        const p = local(e);
        pts.set(e.pointerId, p);
        if (mode === 'pan' && pts.size === 1) {
          const dx = p.x - start.p.x, dy = p.y - start.p.y;
          if (!moved && Math.hypot(dx, dy) > 6) { moved = true; clearTimeout(pressTimer); }
          if (!moved) return;
          this.center = { lon: x2lon(start.cx - dx, this.zoom), lat: y2lat(start.cy - dy, this.zoom) };
          const now = performance.now();
          vel.push({ x: p.x, y: p.y, t: now });
          while (vel.length > 2 && now - vel[0].t > 100) vel.shift();
          this.render();
        } else if (mode === 'pinch' && pts.size >= 2) {
          const [a, b] = [...pts.values()];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          this.zoom = clamp(start.zoom + Math.log2(d / start.dist), this.minZoom, this.maxZoom);
          this._keepUnder(start.ll, mid.x, mid.y);
          this.render();
        }
      });

      const end = (e) => {
        if (!pts.has(e.pointerId)) return;
        const p = local(e);
        pts.delete(e.pointerId);
        clearTimeout(pressTimer);
        if (mode === 'pinch') {
          if (pts.size === 1) { startPan([...pts.values()][0]); moved = true; return; }
          mode = null;
          const r = Math.round(this.zoom);
          if (Math.abs(r - this.zoom) > 0.01) this.zoomAround(r, this.w / 2, this.h / 2, true);
          else this.emit('moveend');
          return;
        }
        if (mode === 'pan' && pts.size === 0) {
          mode = null;
          if (!moved) {
            const now = performance.now();
            if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
              clearTimeout(tapTimer);
              lastTap = null;
              this.zoomAround(Math.round(this.zoom) + 1, p.x, p.y, true);
            } else {
              lastTap = { x: p.x, y: p.y, t: now };
              const ll = this.screenToLatLng(p.x, p.y);
              tapTimer = setTimeout(() => { lastTap = null; this.emit('click', { lat: ll.lat, lon: ll.lon, x: p.x, y: p.y }); }, 260);
            }
            return;
          }
          // inercia
          const now = performance.now();
          const v0 = vel[0], v1 = vel[vel.length - 1];
          const dt = Math.max(1, v1.t - v0.t);
          let vx = (v1.x - v0.x) / dt, vy = (v1.y - v0.y) / dt;
          if (now - v1.t > 80 || Math.hypot(vx, vy) < 0.25) { this.emit('moveend'); return; }
          let last = now;
          const step = (t) => {
            const d = t - last; last = t;
            vx *= Math.pow(0.994, d); vy *= Math.pow(0.994, d);
            const z = this.zoom;
            this.center = { lon: x2lon(lon2x(this.center.lon, z) - vx * d, z), lat: y2lat(lat2y(this.center.lat, z) - vy * d, z) };
            this.render(true);
            if (Math.hypot(vx, vy) > 0.02) this._anim = requestAnimationFrame(step);
            else { this._anim = null; this.emit('moveend'); }
          };
          this._anim = requestAnimationFrame(step);
          return;
        }
        if (mode === 'press' && pts.size === 0) mode = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = local(e);
        const dz = -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022);
        this.zoomAround(this.zoom + clamp(dz, -1, 1), p.x, p.y, false);
        clearTimeout(this._wheelEnd);
        this._wheelEnd = setTimeout(() => this.emit('moveend'), 200);
      }, { passive: false });
    }
  }

  /** Descarga teselas a Cache Storage (para usar sin cobertura). */
  async function downloadTiles(urls, onProgress, signal) {
    const cache = await global.caches.open(TILE_CACHE);
    let done = 0, failed = 0, corsBlocked = 0;
    const queue = urls.slice();
    const worker = async () => {
      while (queue.length) {
        if (signal && signal.aborted) return;
        const u = queue.shift();
        try {
          if (!(await cache.match(u))) {
            const r = await fetch(u, { mode: 'cors' });
            if (r.ok) await cache.put(u, r); else failed++;
          }
        } catch (e) { failed++; corsBlocked++; }
        done++;
        onProgress && onProgress(done, urls.length, failed);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { done, failed, corsBlocked };
  }

  async function tileCacheInfo() {
    if (!global.caches) return { count: 0 };
    const c = await global.caches.open(TILE_CACHE);
    const keys = await c.keys();
    return { count: keys.length };
  }

  async function clearTileCache() {
    if (global.caches) await global.caches.delete(TILE_CACHE);
  }

  global.SetaMap = SetaMap;
  global.SetaMapUtil = { lon2x, lat2y, x2lon, y2lat, downloadTiles, tileCacheInfo, clearTileCache };
})(window);
