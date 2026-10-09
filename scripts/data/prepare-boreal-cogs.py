#!/usr/bin/env python3
"""
Prepare boreal-canada-mapping COGs for ForestTrace.

The pipeline writes UTM COGs with float32/NaN bands and its own region names;
the app's COG reader (maplibre-cog-protocol) needs Web Mercator, and its
colorers compare pixels against an integer nodata. This converts each product:

  source (boreal-canada-mapping)                     -> output (<out>/<prefix>/...)
  opera_style/<region>_opera_style_<Y>_cog.tif       -> clearcut-status-v2/<fmu>_<Y>.tif
      bands: STATUS, CONFIDENCE, DETECTION_YEAR, CONFIRMATION_YEAR (uint16, nodata 65535)
      only detections new in Y (not flagged in Y-4..Y-1); repeats become 0
  (derived) union of years Y-4..Y of the above       -> clearcut-status-acc-v2/<fmu>_<Y>.tif
      same bands, one year's record per pixel (AR-confirmed > persistence >
      provisional, latest on a tie); DETECTION_YEAR = first flagged in the window
  ari_ground_truth/<region>_ari_ground_truth_cog.tif -> ari-ground-truth-v1/<fmu>.tif
      band: AR_YEAR (uint16, 0 = no harvest record)
  logging_scars/<region>_logging_scars_cog.tif       -> logging-scars-v1/<fmu>.tif
      bands: SCAR_COUNT, WORST_COHORT_RATIO x 100 (uint16, nodata 65535)
  scanfi_cog/<region>_scanfi_biomass_age_cog.tif     -> scanfi-v1/<fmu>.tif
      bands: BIOMASS_2015/2020/2025 (t/ha), AGE_2015/2020/2025 (years) (uint8, nodata 255)

Everything is reprojected to EPSG:3857 with nearest-neighbour resampling, so
codes and years survive. Work is done block by block through a WarpedVRT,
so the 300-550 MB SCANFI rasters never load whole.

Usage (needs rasterio, e.g. the geo-env conda environment):
  python scripts/data/prepare-boreal-cogs.py
  python scripts/data/prepare-boreal-cogs.py --only clearcut-status-v2 --overwrite
Then upload each product folder with scripts/storage/upload-cogs-vercel.js.
"""

import argparse
import glob
import json
import os
import re
import tempfile
import time

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.shutil import copy as rio_copy
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_geom
from rasterio.windows import Window, from_bounds

# Pipeline region names -> ForestTrace FMU ids (client/public/data/regions/<id>.json)
FMU_IDS = {
    'wabigoon': 'wabigoon',
    'dog_river_matawin': 'dogrivermatawin',
    'gordon_cosens': 'gordoncosens',
    'bancroft_minden': 'bancroftminden',
}

ACC_WINDOW = 5          # years in the accumulated window, as in the app's ARI layer
U16_NODATA = 65535
U8_NODATA = 255
CHUNK_ROWS = 1024
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def write_cog(tmp_tif, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    rio_copy(tmp_tif, dst, driver='COG', compress='DEFLATE', blocksize=512,
             overview_resampling='nearest', bigtiff='IF_SAFER')


def load_fmu_geometry(regions_dir, fmu):
    """The FMU boundary (EPSG:4326) as one GeoJSON geometry, or None."""
    path = os.path.join(regions_dir, f'{fmu}.json')
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        gj = json.load(fh)
    feats = gj['features'] if gj.get('type') == 'FeatureCollection' else [gj]
    polys = []
    for f in feats:
        g = f.get('geometry') or {}
        if g.get('type') == 'Polygon':
            polys.append(g['coordinates'])
        elif g.get('type') == 'MultiPolygon':
            polys.extend(g['coordinates'])
    return {'type': 'MultiPolygon', 'coordinates': polys} if polys else None


def convert(src_path, dst, band_fn, out_dtype, out_nodata, src_nodata=None, clip_geom=None):
    """Warp src to EPSG:3857 and write dst as a COG, mapping bands through band_fn.

    band_fn(bands: float64 array [count, rows, cols], valid: bool mask) -> array [n, rows, cols]
    `valid` is False where the warped pixel is outside the source / nodata, or
    outside clip_geom (an EPSG:4326 geometry -- the FMU boundary). With a clip
    geometry the output is also cropped to its bounds.
    """
    with rasterio.open(src_path) as src:
        nodata = src.nodata if src_nodata is None else src_nodata
        vrt_nodata = -999999.0  # unambiguous marker for "outside / nodata" in the warped view
        with WarpedVRT(src, crs='EPSG:3857', resampling=Resampling.nearest,
                       src_nodata=nodata, nodata=vrt_nodata, dtype='float64') as vrt:
            full = Window(0, 0, vrt.width, vrt.height)
            geom = transform_geom('EPSG:4326', 'EPSG:3857', clip_geom) if clip_geom else None
            if geom:
                xs = [p[0] for poly in geom['coordinates'] for ring in poly for p in ring]
                ys = [p[1] for poly in geom['coordinates'] for ring in poly for p in ring]
                win = from_bounds(min(xs), min(ys), max(xs), max(ys), vrt.transform)
                win = win.round_offsets(op='floor').round_lengths(op='ceil').intersection(full)
            else:
                win = full
            transform = vrt.window_transform(win)
            probe = band_fn(np.zeros((src.count, 1, 1)), np.ones((1, 1), bool))
            profile = {
                'driver': 'GTiff', 'width': int(win.width), 'height': int(win.height), 'count': probe.shape[0],
                'dtype': out_dtype, 'nodata': out_nodata, 'crs': vrt.crs, 'transform': transform,
                'tiled': True, 'blockxsize': 512, 'blockysize': 512, 'compress': 'deflate', 'BIGTIFF': 'IF_SAFER',
            }
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp = os.path.join(tmpdir, 'warped.tif')
                with rasterio.open(tmp, 'w', **profile) as out:
                    for row in range(0, int(win.height), CHUNK_ROWS):
                        rows = min(CHUNK_ROWS, int(win.height) - row)
                        chunk = Window(win.col_off, win.row_off + row, win.width, rows)
                        bands = vrt.read(window=chunk)
                        valid = np.all(bands != vrt_nodata, axis=0) & np.all(np.isfinite(bands), axis=0)
                        if geom:
                            inside = geometry_mask([geom], out_shape=valid.shape,
                                                   transform=vrt.window_transform(chunk), invert=True)
                            valid &= inside
                            # band_fns that read raw bands (scars) need "outside" visible too
                            bands[:, ~inside] = vrt_nodata
                        out.write(band_fn(bands, valid).astype(out_dtype),
                                  window=Window(0, row, int(win.width), rows))
                write_cog(tmp, dst)


def to_u16(bands, valid, scale=None):
    out = np.full(bands.shape, U16_NODATA, np.float64)
    for i in range(bands.shape[0]):
        b = bands[i] * (scale[i] if scale else 1)
        ok = valid & np.isfinite(bands[i])
        out[i][ok] = np.clip(np.rint(b[ok]), 0, U16_NODATA - 1)
    return out


def status_fn(bands, valid):
    return to_u16(bands[:4], valid)


def scars_fn(bands, valid):
    # Band 2 (ratio) is NaN where a stand wasn't scored; keep that as nodata
    # per band rather than blanking SCAR_COUNT with it.
    out = np.full((2,) + bands.shape[1:], U16_NODATA, np.float64)
    inside = np.isfinite(bands[0]) & (bands[0] != -999999.0)
    out[0][inside] = np.clip(np.rint(bands[0][inside]), 0, 65534)
    scored = inside & np.isfinite(bands[1]) & (bands[1] != -999999.0)
    out[1][scored] = np.clip(np.rint(bands[1][scored] * 100), 0, 65534)
    return out


def ari_fn(bands, valid):
    out = np.zeros((1,) + bands.shape[1:], np.float64)   # 0 = no record (also outside)
    out[0][valid] = np.clip(np.rint(bands[0][valid]), 0, 65534)
    return out


def scanfi_fn(bands, valid):
    out = np.full(bands.shape, U8_NODATA, np.float64)
    for i in range(bands.shape[0]):
        ok = valid & np.isfinite(bands[i]) & (bands[i] > -32000)
        out[i][ok] = np.clip(np.rint(bands[i][ok]), 0, U8_NODATA - 1)
    return out


def build_annual_new(year_file, prior_files, dst_src_grid):
    """One year's status raster, keeping only pixels NOT flagged in prior_files.

    The yearly files re-flag a stand every year it stays visible (78-88% of a
    Wabigoon year's flags repeat one of the 4 years before), so the annual
    layer would keep showing old cuts. Repeats become 0 ("checked, nothing
    new"), the same rule the inventory's annual layer follows.
    """
    with rasterio.open(year_file) as cur:
        profile = cur.profile.copy()
        profile.update(driver='GTiff', tiled=True, blockxsize=512, blockysize=512, compress='deflate', BIGTIFF='IF_SAFER')
        priors = [rasterio.open(f) for f in prior_files]
        try:
            with rasterio.open(dst_src_grid, 'w', **profile) as out:
                for row in range(0, cur.height, CHUNK_ROWS):
                    win = Window(0, row, cur.width, min(CHUNK_ROWS, cur.height - row))
                    a = cur.read(window=win).astype(np.float64)
                    seen = np.zeros(a.shape[1:], bool)
                    for p in priors:
                        seen |= np.nan_to_num(p.read(1, window=win)) > 0
                    repeat = seen & (np.nan_to_num(a[0]) > 0)
                    a[:, repeat] = 0
                    out.write(a.astype(profile['dtype']), window=win)
        finally:
            for p in priors:
                p.close()


def build_accumulated(year_files, dst_src_grid):
    """Union of several yearly status rasters on their shared source grid.

    Each pixel keeps ONE year's record (status, confidence, confirmation year
    together -- mixing bands across years produced e.g. STATUS 4 with another
    year's AR confirmation): AR-confirmed (2) over persistence-confirmed (4)
    over provisional (1), the latest year on a tie. DETECTION_YEAR becomes the
    first year the pixel was flagged within the window.
    """
    with rasterio.open(year_files[0]) as first:
        profile = first.profile.copy()
        profile.update(driver='GTiff', tiled=True, blockxsize=512, blockysize=512, compress='deflate', BIGTIFF='IF_SAFER')
        height, width = first.height, first.width
    srcs = [rasterio.open(f) for f in year_files]
    try:
        with rasterio.open(dst_src_grid, 'w', **profile) as out:
            for row in range(0, height, CHUNK_ROWS):
                win = Window(0, row, width, min(CHUNK_ROWS, height - row))
                stack = np.stack([s.read(window=win).astype(np.float64) for s in srcs])   # [years, 4, r, c]
                status = np.where(np.isfinite(stack[:, 0]), stack[:, 0], 0)
                any_data = np.any(np.isfinite(stack[:, 0]), axis=0)
                rank = np.select([status == 2, status == 4, status == 1], [3, 2, 1], 0)
                order = np.arange(len(srcs))[:, None, None]       # year_files are oldest first
                pick = np.argmax(rank * 100 + order, axis=0)      # [r, c]
                acc = np.take_along_axis(stack, pick[None, None], axis=0)[0]   # [4, r, c]
                flagged = rank.max(axis=0) > 0
                first_det = np.min(np.where(rank > 0, stack[:, 2], np.inf), axis=0)
                acc[2] = np.where(flagged, first_det, 0)
                # Unflagged pixels: zero out everything but keep them as "checked"
                for b in range(0, 4):
                    acc[b] = np.where(flagged, acc[b], 0)
                acc = np.where(any_data[None], acc, np.nan)
                out.write(acc.astype(profile['dtype']), window=win)
    finally:
        for s in srcs:
            s.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default='E:/boreal-canada-mapping')
    ap.add_argument('--out', default=None, help='default: <src>/foresttrace_cogs')
    ap.add_argument('--only', nargs='*', help='product prefixes to build (default: all)')
    ap.add_argument('--overwrite', action='store_true')
    ap.add_argument('--regions-dir', default=os.path.join(REPO_ROOT, 'client', 'public', 'data', 'regions'),
                    help='FMU boundary GeoJSON (<fmu>.json) to clip each raster to')
    ap.add_argument('--no-clip', action='store_true', help='keep the full source extent')
    args = ap.parse_args()
    out_root = args.out or os.path.join(args.src, 'foresttrace_cogs')
    want = lambda p: not args.only or p in args.only

    def job(src, prefix, name, fn, dtype, nodata, src_nodata=None):
        fmu = re.match(r'([a-z0-9]+)', name).group(1)
        clip = None if args.no_clip else load_fmu_geometry(args.regions_dir, fmu)
        if clip is None and not args.no_clip:
            log(f'warn: no boundary for {fmu}, not clipping')
        dst = os.path.join(out_root, prefix, name)
        if os.path.exists(dst) and not args.overwrite:
            log(f'skip (exists) {prefix}/{name}')
            return
        t0 = time.time()
        convert(src, dst, fn, dtype, nodata, src_nodata, clip)
        log(f'ok   {prefix}/{name}  {os.path.getsize(dst) / 1e6:.1f} MB  {time.time() - t0:.0f}s')

    # Clearcut status, per year + accumulated window
    status = {}
    for f in glob.glob(os.path.join(args.src, 'opera_style', '*_opera_style_*_cog.tif')):
        m = re.match(r'(.+)_opera_style_(\d{4})_cog\.tif$', os.path.basename(f))
        if m and m.group(1) in FMU_IDS:
            status.setdefault(m.group(1), {})[int(m.group(2))] = f
    for region, years in sorted(status.items()):
        fmu = FMU_IDS[region]
        for year, f in sorted(years.items()):
            if want('clearcut-status-v2'):
                prior = [years[y] for y in range(year - ACC_WINDOW + 1, year) if y in years]
                dst = os.path.join(out_root, 'clearcut-status-v2', f'{fmu}_{year}.tif')
                if os.path.exists(dst) and not args.overwrite:
                    log(f'skip (exists) clearcut-status-v2/{fmu}_{year}.tif')
                else:
                    with tempfile.TemporaryDirectory() as tmpdir:
                        new_src = os.path.join(tmpdir, 'new.tif')
                        build_annual_new(f, prior, new_src)
                        job(new_src, 'clearcut-status-v2', f'{fmu}_{year}.tif', status_fn, 'uint16', U16_NODATA)
            if want('clearcut-status-acc-v2'):
                window = [years[y] for y in range(year - ACC_WINDOW + 1, year + 1) if y in years]
                dst = os.path.join(out_root, 'clearcut-status-acc-v2', f'{fmu}_{year}.tif')
                if os.path.exists(dst) and not args.overwrite:
                    log(f'skip (exists) clearcut-status-acc-v2/{fmu}_{year}.tif')
                    continue
                with tempfile.TemporaryDirectory() as tmpdir:
                    acc_src = os.path.join(tmpdir, 'acc.tif')
                    build_accumulated(window, acc_src)
                    job(acc_src, 'clearcut-status-acc-v2', f'{fmu}_{year}.tif', status_fn, 'uint16', U16_NODATA)

    for region, fmu in FMU_IDS.items():
        if want('ari-ground-truth-v1'):
            f = os.path.join(args.src, 'ari_ground_truth', f'{region}_ari_ground_truth_cog.tif')
            if os.path.exists(f):
                job(f, 'ari-ground-truth-v1', f'{fmu}.tif', ari_fn, 'uint16', 0)
        if want('logging-scars-v1'):
            f = os.path.join(args.src, 'logging_scars', f'{region}_logging_scars_cog.tif')
            if os.path.exists(f):
                job(f, 'logging-scars-v1', f'{fmu}.tif', scars_fn, 'uint16', U16_NODATA)
        if want('scanfi-v1'):
            f = os.path.join(args.src, 'scanfi_cog', f'{region}_scanfi_biomass_age_cog.tif')
            if os.path.exists(f):
                job(f, 'scanfi-v1', f'{fmu}.tif', scanfi_fn, 'uint8', U8_NODATA)

    log(f'done -> {out_root}')


if __name__ == '__main__':
    main()
