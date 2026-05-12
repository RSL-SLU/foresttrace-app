#!/usr/bin/env python3
"""
Precompute clearcut area (ha) per region/sensor/year from PNG tiles at zoom 12.
Outputs: client/public/data/clearcut_stats.json

Directory layouts handled (auto-detected):
  Direct:  clearcut/{region}_{year}/{zoom}/{x}/{y}.png      → sensor = 'hls'
  Sensor:  clearcut/{region}_{year}/{sensor}/{zoom}/{x}/{y}.png

Pixel counting mirrors clearcutAreaStats.js:
  clearcut pixel = alpha > 0 AND red > 200

Area formula (Web Mercator):
  metersPerPixel = 156543.03392 * cos(lat) / tilesPerAxis
  pixelAreaHa    = metersPerPixel^2 / 10000
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

STATS_ZOOM = 12
TILES_PER_AXIS = 2 ** STATS_ZOOM  # 4096

TILES_ROOT = Path(__file__).parent / "client" / "public" / "tiles" / "clearcut"
OUTPUT_PATH = Path(__file__).parent / "client" / "public" / "data" / "clearcut_stats.json"


def pixel_area_ha(y_xyz: int) -> float:
    center_y = y_xyz + 0.5
    lat_rad = math.atan(math.sinh(math.pi * (1 - (2 * center_y) / TILES_PER_AXIS)))
    meters_per_pixel = (156543.03392 * math.cos(lat_rad)) / TILES_PER_AXIS
    return (meters_per_pixel ** 2) / 10000


def compute_area_under_zoom_root(zoom_root: Path) -> float:
    """Sum clearcut area (ha) for all tiles at STATS_ZOOM under zoom_root."""
    z_dir = zoom_root / str(STATS_ZOOM)
    if not z_dir.is_dir():
        return 0.0

    total_ha = 0.0
    for x_dir in z_dir.iterdir():
        if not x_dir.is_dir():
            continue
        for png_file in x_dir.glob("*.png"):
            if not png_file.stem.isdigit():
                continue
            y_xyz = int(png_file.stem)
            img = Image.open(png_file).convert("RGBA")
            arr = np.array(img, dtype=np.uint8)
            count = int(((arr[:, :, 3] > 0) & (arr[:, :, 0] > 200)).sum())
            if count > 0:
                total_ha += count * pixel_area_ha(y_xyz)

    return total_ha


def main():
    # {"{region}_{sensor}": {"year": ha, ...}}
    stats: dict[str, dict[str, float]] = {}

    for ry_dir in sorted(TILES_ROOT.iterdir()):
        if not ry_dir.is_dir():
            continue

        parts = ry_dir.name.rsplit("_", 1)
        if len(parts) != 2:
            continue
        region, year_str = parts
        if not year_str.isdigit():
            continue

        subdirs = [d for d in ry_dir.iterdir() if d.is_dir()]
        if not subdirs:
            continue

        # Auto-detect layout: numeric subdir names = zoom levels (direct/HLS);
        # non-numeric = sensor folders containing zoom levels.
        if subdirs[0].name.isdigit():
            # Direct layout — treat as HLS
            sensor = "hls"
            cache_key = f"{region}_{sensor}"
            stats.setdefault(cache_key, {})
            print(f"  {region} / {sensor} / {year_str} ...", end=" ", flush=True)
            area = compute_area_under_zoom_root(ry_dir)
            stats[cache_key][year_str] = round(area, 2)
            print(f"{area:,.1f} ha")
        else:
            # Sensor-subfolder layout
            for sensor_dir in sorted(subdirs):
                sensor = sensor_dir.name
                cache_key = f"{region}_{sensor}"
                stats.setdefault(cache_key, {})
                print(f"  {region} / {sensor} / {year_str} ...", end=" ", flush=True)
                area = compute_area_under_zoom_root(sensor_dir)
                stats[cache_key][year_str] = round(area, 2)
                print(f"{area:,.1f} ha")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
