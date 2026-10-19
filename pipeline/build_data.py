#!/usr/bin/env python3
"""
Genera los datos estáticos de la app (web/data/cells.js) para la región piloto:
una rejilla de celdas de ~1 km con
  - cobertura de bosque por tipo (pino / frondosa / mixto / sin especificar), de OpenStreetMap
  - altitud media de la celda (Open-Meteo Elevation API, MDT Copernicus 90 m)
  - municipio y provincia (límites administrativos de OpenStreetMap)
  - espacio protegido (OpenStreetMap: boundary=protected_area, leisure=nature_reserve)

Se ejecuta en GitHub Actions (necesita Internet). Con --synthetic genera datos falsos
para probar la app sin red.

Uso:  python pipeline/build_data.py --out pipeline/out [--synthetic]
"""
import argparse
import datetime as dt
import json
import math
import os
import random
import sys
import time

REGION = {
    "id": "pinares",
    "name": "Pinares de Soria y Burgos",
    "min_lat": 41.66,
    "max_lat": 42.12,
    "min_lon": -3.36,
    "max_lon": -2.52,
}
CELL_KM = 1.0
SAMPLES = 5            # puntos de muestreo por lado de celda (5x5 = 25)
MIN_FOREST_PCT = 3     # celdas con menos bosque se descartan

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
UA = {"User-Agent": "BuscaSetas-prototipo/0.1 (github.com/delealvfer1/buscasetas)"}

LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


# ---------------------------------------------------------------- rejilla

def make_grid():
    lat0 = (REGION["min_lat"] + REGION["max_lat"]) / 2
    d_lat = CELL_KM / 111.32
    d_lon = CELL_KM / (111.32 * math.cos(math.radians(lat0)))
    rows = math.ceil((REGION["max_lat"] - REGION["min_lat"]) / d_lat)
    cols = math.ceil((REGION["max_lon"] - REGION["min_lon"]) / d_lon)
    return d_lat, d_lon, rows, cols


def cell_center(r, c, d_lat, d_lon):
    return (REGION["min_lat"] + (r + 0.5) * d_lat, REGION["min_lon"] + (c + 0.5) * d_lon)


# ---------------------------------------------------------------- Overpass

def overpass(query, label):
    import requests
    last = None
    for attempt in range(3):
        for url in OVERPASS_URLS:
            try:
                t0 = time.time()
                r = requests.post(url, data={"data": query}, headers=UA, timeout=300)
                if r.status_code == 200:
                    js = r.json()
                    n = len(js.get("elements", []))
                    log(f"  Overpass {label}: {n} elementos desde {url} en {time.time()-t0:.0f}s")
                    if js.get("remark"):
                        log("  aviso Overpass:", js["remark"][:300])
                        if "runtime error" in js["remark"] and n == 0:
                            last = js["remark"]
                            continue
                    return js["elements"]
                last = f"HTTP {r.status_code} {r.text[:200]}"
                log(f"  Overpass {label}: {url} -> {last}")
            except Exception as e:  # noqa: BLE001
                last = repr(e)
                log(f"  Overpass {label}: {url} -> error {last[:200]}")
            time.sleep(5)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"Overpass falló para {label}: {last}")


def element_geometry(el):
    """Convierte un elemento de Overpass (out geom) en geometría shapely (polígono)."""
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, unary_union

    if el["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]
        if len(pts) < 4 or pts[0] != pts[-1]:
            return None
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        return poly if not poly.is_empty else None

    if el["type"] == "relation":
        outers, inners = [], []
        for m in el.get("members", []):
            if m.get("type") != "way" or not m.get("geometry"):
                continue
            pts = [(p["lon"], p["lat"]) for p in m["geometry"] if p]
            if len(pts) < 2:
                continue
            (inners if m.get("role") == "inner" else outers).append(LineString(pts))
        if not outers:
            return None
        polys = list(polygonize(unary_union(outers)))
        if not polys:
            return None
        geom = unary_union(polys)
        if inners:
            ipolys = list(polygonize(unary_union(inners)))
            if ipolys:
                geom = geom.difference(unary_union(ipolys))
        if not geom.is_valid:
            geom = geom.buffer(0)
        return geom if not geom.is_empty else None
    return None


def forest_type(tags):
    lt = (tags.get("leaf_type") or "").lower()
    if lt == "needleleaved":
        return "pino"
    if lt == "broadleaved":
        return "frondosa"
    if lt in ("mixed", "leafless"):
        return "mixto"
    wood = (tags.get("wood") or "").lower()
    if wood == "coniferous":
        return "pino"
    if wood == "deciduous":
        return "frondosa"
    if wood == "mixed":
        return "mixto"
    txt = " ".join((tags.get(k) or "") for k in ("genus", "species", "taxon", "name")).lower()
    if any(w in txt for w in ("pinus", "pino", "pinar")):
        return "pino"
    if any(w in txt for w in ("quercus", "fagus", "castanea", "roble", "rebollo", "haya", "encina", "castaño", "melojo")):
        return "frondosa"
    return "desconocido"


def protected_kind(tags):
    txt = " ".join((tags.get(k) or "") for k in
                   ("protection_title", "designation", "name", "protected_area")).lower()
    pc = (tags.get("protect_class") or "").strip()
    if any(w in txt for w in ("parque natural", "reserva natural", "monumento natural", "parque nacional",
                              "paisaje protegido", "espacio natural", "parque regional")):
        return "enp"
    if tags.get("boundary") == "national_park" or pc in ("1", "1a", "1b", "2", "3", "5"):
        return "enp"
    if pc == "97" or any(w in txt for w in ("natura", "zec", "zepa", "lic ", "especial conservación",
                                            "especial protección para las aves", "importancia comunitaria",
                                            "especial conservacion")):
        return "n2000"
    if tags.get("leisure") == "nature_reserve":
        return "enp"
    return "otro"


# ---------------------------------------------------------------- Copernicus HRL

DLT_URL = ("https://image.discomap.eea.europa.eu/arcgis/rest/services/GioLandPublic/"
           "HRL_DominantLeafType2018/ImageServer/exportImage")
PX = 20  # píxeles por lado de celda (~50 m)


def fetch_dlt(rows, cols, d_lat, d_lon):
    """Tipo de hoja dominante 2018 (Copernicus HRL, 10 m): 0 sin árboles, 1 frondosas, 2 coníferas.
    Devuelve (pct_coniferas, pct_frondosas) por celda, arrays de rows*cols."""
    import io
    import numpy as np
    import requests
    s, w = REGION["min_lat"], REGION["min_lon"]
    n, e = s + rows * d_lat, w + cols * d_lon
    W, H = cols * PX, rows * PX
    url = (f"{DLT_URL}?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR=4326&size={W},{H}"
           f"&format=tiff&pixelType=U8&noData=255&interpolation=RSP_NearestNeighbor&f=image")
    last = None
    for attempt in range(4):
        try:
            r = requests.get(url, headers=UA, timeout=240)
            ct = r.headers.get("content-type", "")
            if r.status_code == 200 and "json" not in ct and "text" not in ct and len(r.content) > 1000:
                break
            last = f"HTTP {r.status_code} {ct} {r.text[:200] if 'text' in ct or 'json' in ct else len(r.content)}"
        except Exception as ex:  # noqa: BLE001
            last = repr(ex)
        log("  Copernicus intento", attempt + 1, "->", last)
        time.sleep(10 * (attempt + 1))
    else:
        raise RuntimeError(f"Copernicus no respondió: {last}")
    try:
        from PIL import Image
        arr = np.array(Image.open(io.BytesIO(r.content)))
    except Exception as ex:  # noqa: BLE001
        log("  PIL no pudo leer el TIFF:", repr(ex)[:150], "- pruebo tifffile")
        import tifffile
        arr = tifffile.imread(io.BytesIO(r.content))
    arr = np.squeeze(arr)
    log(f"  Copernicus: imagen {arr.shape} {arr.dtype}, valores {dict(zip(*[x.tolist() for x in np.unique(arr, return_counts=True)]))}")
    if arr.shape != (H, W):
        raise RuntimeError(f"Tamaño inesperado {arr.shape}, esperaba {(H, W)}")
    arr = arr[::-1]  # fila 0 = sur, como la rejilla
    blocks = arr.reshape(rows, PX, cols, PX).swapaxes(1, 2).reshape(rows * cols, PX * PX)
    valid = (blocks <= 2).sum(axis=1)
    con = (blocks == 2).sum(axis=1)
    bro = (blocks == 1).sum(axis=1)
    den = np.maximum(valid, 1)
    return np.round(con * 100 / den).astype(int), np.round(bro * 100 / den).astype(int), valid


# ---------------------------------------------------------------- elevación

def fetch_elevations(points):
    import requests
    out = []
    for i in range(0, len(points), 100):
        chunk = points[i:i + 100]
        lat = ",".join(f"{p[0]:.5f}" for p in chunk)
        lon = ",".join(f"{p[1]:.5f}" for p in chunk)
        url = f"https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}"
        for attempt in range(6):
            try:
                r = requests.get(url, headers=UA, timeout=60)
                if r.status_code == 200:
                    out.extend(r.json()["elevation"])
                    break
                log(f"  elevación HTTP {r.status_code}: {r.text[:120]}")
            except Exception as e:  # noqa: BLE001
                log("  elevación error", repr(e)[:120])
            time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError("No se pudo obtener la elevación")
        time.sleep(0.3)
    return out


# ---------------------------------------------------------------- diagnóstico MFE

def probe_mfe_wfs():
    """Solo diagnóstico: busca capas WFS del Mapa Forestal (para una versión futura)."""
    import requests
    urls = [
        "https://geoserver.iepnb.es/geoserver/foto_fija_mfe/ff_uso/wfs?service=WFS&request=GetCapabilities",
        "https://geoserver.iepnb.es/geoserver/wfs?service=WFS&request=GetCapabilities",
    ]
    for u in urls:
        try:
            r = requests.get(u, headers=UA, timeout=60)
            names = [ln.strip() for ln in r.text.split("<") if ln.startswith("Name>") or ln.startswith("wfs:Name>")]
            log(f"  WFS {u} -> HTTP {r.status_code}, {len(r.text)} bytes; capas: {names[:40]}")
        except Exception as e:  # noqa: BLE001
            log(f"  WFS {u} -> error {repr(e)[:150]}")


# ---------------------------------------------------------------- real

def build_real():
    import numpy as np
    from shapely import points as shp_points
    from shapely.strtree import STRtree

    d_lat, d_lon, rows, cols = make_grid()
    log(f"Rejilla {rows} filas x {cols} columnas = {rows*cols} celdas (dLat={d_lat:.6f}, dLon={d_lon:.6f})")

    s, w, n, e = REGION["min_lat"], REGION["min_lon"], REGION["max_lat"], REGION["max_lon"]
    TYPES = ["pino", "frondosa", "mixto", "desconocido"]
    forest_source = None
    cov_pct = None
    if os.environ.get("FOREST_SOURCE", "copernicus") == "copernicus":
        log("Descargando tipo de arbolado de Copernicus (HRL Dominant Leaf Type 2018)…")
        try:
            con, bro, valid = fetch_dlt(rows, cols, d_lat, d_lon)
            cov_pct = np.zeros((rows * cols, 4), dtype=int)
            cov_pct[:, 0] = con
            cov_pct[:, 1] = bro
            forest_source = "copernicus"
            log(f"  celdas con datos válidos: {(valid > 0).sum()} de {rows*cols}")
        except Exception as ex:  # noqa: BLE001
            log("  Copernicus falló, uso OpenStreetMap:", repr(ex)[:300])
    if cov_pct is None:
        cov_pct = forest_from_osm(rows, cols, d_lat, d_lon)
        forest_source = "osm"

    total = cov_pct.sum(axis=1)
    keep = np.where(total >= MIN_FOREST_PCT)[0]
    log(f"  fuente de bosque: {forest_source}; celdas con bosque >= {MIN_FOREST_PCT}%: {len(keep)} de {rows*cols}")
    share = cov_pct[keep].sum(axis=0) / max(1, cov_pct[keep].sum())
    log("  reparto de superficie forestal: " + ", ".join(f"{TYPES[k]} {share[k]*100:.1f}%" for k in range(4)))
    return finish_real(rows, cols, d_lat, d_lon, cov_pct, keep, forest_source)


def forest_from_osm(rows, cols, d_lat, d_lon):
    import numpy as np
    from shapely import points as shp_points
    from shapely.strtree import STRtree
    s, w, n, e = REGION["min_lat"], REGION["min_lon"], REGION["max_lat"], REGION["max_lon"]

    # --- bosques, en 4 trozos para no saturar Overpass
    log("Descargando bosques de OpenStreetMap…")
    elements = {}
    mid_lat, mid_lon = (s + n) / 2, (w + e) / 2
    tiles = [(s, w, mid_lat, mid_lon), (s, mid_lon, mid_lat, e), (mid_lat, w, n, mid_lon), (mid_lat, mid_lon, n, e)]
    for i, (ts, tw, tn, te) in enumerate(tiles):
        bb = f"{ts},{tw},{tn},{te}"
        q = f"""[out:json][timeout:400][maxsize:1073741824];
(
  way["landuse"="forest"]({bb});
  relation["landuse"="forest"]({bb});
  way["natural"="wood"]({bb});
  relation["natural"="wood"]({bb});
  way["landcover"="trees"]({bb});
);
out tags geom;"""
        for el in overpass(q, f"bosques {i+1}/4"):
            elements[(el["type"], el["id"])] = el
        time.sleep(10)
    log(f"  {len(elements)} elementos de bosque únicos")

    geoms, types = [], []
    tcount = {}
    for el in elements.values():
        g = element_geometry(el)
        if g is None:
            continue
        t = forest_type(el.get("tags", {}))
        geoms.append(g)
        types.append(t)
        tcount[t] = tcount.get(t, 0) + 1
    log(f"  {len(geoms)} polígonos de bosque válidos; por tipo: {tcount}")
    if len(geoms) < 50:
        raise RuntimeError("Muy pocos polígonos de bosque: algo ha fallado")

    # --- puntos de muestreo
    offs = [(i + 0.5) / SAMPLES for i in range(SAMPLES)]
    lats, lons = [], []
    for r in range(rows):
        for c in range(cols):
            for oy in offs:
                for ox in offs:
                    lats.append(s + (r + oy) * d_lat)
                    lons.append(w + (c + ox) * d_lon)
    pts = shp_points(np.array(lons), np.array(lats))
    per_cell = SAMPLES * SAMPLES
    log(f"  {len(pts)} puntos de muestreo")

    tree = STRtree(geoms)
    pidx, gidx = tree.query(pts, predicate="intersects")
    TYPES = ["pino", "frondosa", "mixto", "desconocido"]
    # para cada punto: conjunto de tipos
    flags = np.zeros((len(pts), 4), dtype=bool)
    tarr = np.array([TYPES.index(t) for t in types])
    flags[pidx, tarr[gidx]] = True
    # resolver: específicos ganan a "desconocido"; pino+frondosa = mixto
    has_p, has_f, has_m, has_d = flags[:, 0], flags[:, 1], flags[:, 2], flags[:, 3]
    pt_type = np.full(len(pts), -1)
    pt_type[has_d] = 3
    pt_type[has_p] = 0
    pt_type[has_f] = 1
    pt_type[has_m | (has_p & has_f)] = 2
    cov = np.zeros((rows * cols, 4), dtype=int)
    cell_of_pt = np.arange(len(pts)) // per_cell
    for k in range(4):
        cov[:, k] = np.bincount(cell_of_pt[pt_type == k], minlength=rows * cols)
    return np.round(cov * 100 / per_cell).astype(int)


def finish_real(rows, cols, d_lat, d_lon, cov_pct, keep, forest_source):
    import numpy as np
    from shapely import points as shp_points
    from shapely.strtree import STRtree
    s, w, n, e = REGION["min_lat"], REGION["min_lon"], REGION["max_lat"], REGION["max_lon"]

    # --- límites administrativos
    log("Descargando municipios y provincias…")
    q = f"""[out:json][timeout:300];
relation["boundary"="administrative"]["admin_level"~"^(6|8)$"]({s},{w},{n},{e});
out tags geom;"""
    adm = overpass(q, "límites")
    munis, provs = [], []
    for el in adm:
        g = element_geometry(el)
        if g is None:
            continue
        name = el.get("tags", {}).get("name", "?")
        lvl = el.get("tags", {}).get("admin_level")
        (munis if lvl == "8" else provs).append((name, g))
    log(f"  {len(munis)} municipios, {len(provs)} provincias")

    centers = [cell_center(i // cols, i % cols, d_lat, d_lon) for i in keep]
    cpts = shp_points(np.array([p[1] for p in centers]), np.array([p[0] for p in centers]))

    def assign(polys):
        res = np.full(len(cpts), -1)
        if not polys:
            return res
        t = STRtree([g for _, g in polys])
        a, b = t.query(cpts, predicate="within")
        res[a] = b
        return res

    muni_idx = assign(munis)
    prov_idx = assign(provs)
    muni_names = [m[0] for m in munis]
    prov_names = [p[0] for p in provs]

    # --- espacios protegidos
    log("Descargando espacios protegidos…")
    q = f"""[out:json][timeout:300];
(
  way["boundary"="protected_area"]({s},{w},{n},{e});
  relation["boundary"="protected_area"]({s},{w},{n},{e});
  way["leisure"="nature_reserve"]({s},{w},{n},{e});
  relation["leisure"="nature_reserve"]({s},{w},{n},{e});
  relation["boundary"="national_park"]({s},{w},{n},{e});
);
out tags geom;"""
    prot_el = overpass(q, "protegidos")
    prots = []
    for el in prot_el:
        g = element_geometry(el)
        if g is None:
            continue
        tg = el.get("tags", {})
        prots.append({
            "n": tg.get("name") or tg.get("protection_title") or "Espacio protegido",
            "k": protected_kind(tg),
            "t": tg.get("protection_title") or tg.get("designation") or "",
            "g": g,
        })
    log("  espacios protegidos: " + "; ".join(f"{p['n']} [{p['k']}|{p['t']}]" for p in prots)[:3000])

    rank = {"enp": 3, "n2000": 2, "otro": 1}
    prot_idx = np.full(len(keep), -1)
    if prots:
        t = STRtree([p["g"] for p in prots])
        # muestreo de 9 puntos por celda; asigna si >= 3 están dentro
        sub = [(i + 0.5) / 3 for i in range(3)]
        sp_lat, sp_lon, owner = [], [], []
        for j, ci in enumerate(keep):
            r, c = divmod(int(ci), cols)
            for oy in sub:
                for ox in sub:
                    sp_lat.append(s + (r + oy) * d_lat)
                    sp_lon.append(w + (c + ox) * d_lon)
                    owner.append(j)
        spts = shp_points(np.array(sp_lon), np.array(sp_lat))
        owner = np.array(owner)
        a, b = t.query(spts, predicate="within")
        hits = {}
        for pa, pb in zip(a, b):
            key = (int(owner[pa]), int(pb))
            hits[key] = hits.get(key, 0) + 1
        best = {}
        for (j, pb), cnt in hits.items():
            if cnt < 3:
                continue
            cur = best.get(j)
            if cur is None or rank[prots[pb]["k"]] > rank[prots[cur]["k"]]:
                best[j] = pb
        for j, pb in best.items():
            prot_idx[j] = pb
    used = sorted(set(int(x) for x in prot_idx if x >= 0))
    remap = {old: new for new, old in enumerate(used)}
    prot_list = [{"n": prots[o]["n"], "k": prots[o]["k"], "t": prots[o]["t"]} for o in used]
    prot_idx = [remap[int(x)] if x >= 0 else -1 for x in prot_idx]
    log(f"  celdas en espacio protegido: {sum(1 for x in prot_idx if x >= 0)}")

    # --- altitud
    log("Descargando altitudes (Open-Meteo / Copernicus DEM)…")
    alts = fetch_elevations(centers)
    alts = [int(round(a)) if a is not None else 0 for a in alts]
    log(f"  altitud min {min(alts)} m, max {max(alts)} m")

    try:
        probe_mfe_wfs()
    except Exception as e:  # noqa: BLE001
        log("  diagnóstico MFE falló:", repr(e)[:200])

    return {
        "rows": rows, "cols": cols, "dLat": d_lat, "dLon": d_lon,
        "idx": [int(i) for i in keep],
        "alt": alts,
        "pino": [int(cov_pct[i, 0]) for i in keep],
        "frondosa": [int(cov_pct[i, 1]) for i in keep],
        "mixto": [int(cov_pct[i, 2]) for i in keep],
        "desconocido": [int(cov_pct[i, 3]) for i in keep],
        "muni": [int(x) for x in muni_idx],
        "prov": [int(x) for x in prov_idx],
        "prot": prot_idx,
        "munis": muni_names,
        "provs": prov_names,
        "prots": prot_list,
        "synthetic": False,
        "forest_source": forest_source,
    }


# ---------------------------------------------------------------- sintético

def build_synthetic():
    """Datos inventados con forma plausible, solo para probar la app sin red."""
    random.seed(7)
    d_lat, d_lon, rows, cols = make_grid()
    towns = [("Navaleno", 41.84, -3.00), ("Covaleda", 41.93, -2.88), ("Quintanar de la Sierra", 41.99, -3.04),
             ("San Leonardo de Yagüe", 41.83, -3.07), ("Vinuesa", 41.91, -2.76), ("Abejar", 41.81, -2.78),
             ("Duruelo de la Sierra", 41.95, -2.93), ("Salas de los Infantes", 42.02, -3.28)]
    blobs = [(41.90 + random.uniform(-0.2, 0.2), -2.95 + random.uniform(-0.35, 0.35),
              random.uniform(0.04, 0.12), random.choice(["pino", "pino", "pino", "frondosa", "mixto"]))
             for _ in range(60)]
    out = {k: [] for k in ("idx", "alt", "pino", "frondosa", "mixto", "desconocido", "muni", "prov", "prot")}
    for r in range(rows):
        for c in range(cols):
            lat, lon = cell_center(r, c, d_lat, d_lon)
            vals = {"pino": 0.0, "frondosa": 0.0, "mixto": 0.0}
            for bl, bo, rad, t in blobs:
                dd = math.hypot((lat - bl) / rad, (lon - bo) / (rad * 1.3))
                vals[t] += max(0.0, 1.2 - dd)
            tot = sum(vals.values())
            if tot < 0.08:
                continue
            scale = min(1.0, tot) * 100 / tot
            pct = {k: int(v * scale) for k, v in vals.items()}
            if sum(pct.values()) < MIN_FOREST_PCT:
                continue
            out["idx"].append(r * cols + c)
            alt = 1000 + 600 * math.exp(-((lat - 41.99) ** 2 / 0.01 + (lon + 2.85) ** 2 / 0.02)) \
                + 120 * math.sin(lat * 40) + 80 * math.cos(lon * 30)
            out["alt"].append(int(alt))
            out["pino"].append(pct["pino"])
            out["frondosa"].append(pct["frondosa"])
            out["mixto"].append(pct["mixto"])
            out["desconocido"].append(0)
            ti = min(range(len(towns)), key=lambda i: (towns[i][1] - lat) ** 2 + (towns[i][2] - lon) ** 2)
            out["muni"].append(ti)
            out["prov"].append(0 if lon > -3.05 else 1)
            out["prot"].append(0 if (41.97 < lat < 42.03 and -2.90 < lon < -2.80) else
                               (1 if (41.70 < lat < 41.78 and -3.10 < lon < -3.00) else -1))
    out.update({
        "rows": rows, "cols": cols, "dLat": d_lat, "dLon": d_lon,
        "munis": [t[0] for t in towns], "provs": ["Soria", "Burgos"],
        "prots": [{"n": "Parque Natural de la Laguna Negra y Circos Glaciares de Urbión", "k": "enp", "t": "Parque Natural"},
                  {"n": "Parque Natural del Cañón del Río Lobos", "k": "enp", "t": "Parque Natural"}],
        "synthetic": True,
    })
    return out


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="pipeline/out")
    ap.add_argument("--synthetic", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    log(f"BuscaSetas · datos de hábitat · región {REGION['name']} · {dt.datetime.utcnow().isoformat()}Z")
    try:
        data = build_synthetic() if args.synthetic else build_real()
    finally:
        with open(os.path.join(args.out, "log.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(LOG) + "\n")
    sources = ["© OpenStreetMap contributors (ODbL)", "Open-Meteo Elevation API (Copernicus DEM GLO-90)"]
    if data.get("forest_source") == "copernicus":
        sources.insert(0, "Copernicus Land Monitoring Service, HRL Dominant Leaf Type 2018 (© Unión Europea, EEA)")
    data.update({
        "version": 1,
        "generated": dt.date.today().isoformat(),
        "region": REGION,
        "sources": sources,
    })
    js = "window.SETAS_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(os.path.join(args.out, "cells.js"), "w", encoding="utf-8") as f:
        f.write(js)
    log(f"Escrito cells.js ({len(js)//1024} KB, {len(data['idx'])} celdas) en {time.time()-t0:.0f}s")
    with open(os.path.join(args.out, "log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    sys.exit(main())
