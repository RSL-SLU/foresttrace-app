#!/usr/bin/env python3
"""Simplify existing region GeoJSON files in place.

This script does not download anything. It rewrites the already-generated
`client/public/data/regions/*.json` files with fewer vertices so the browser
has less geometry to render when many FMUs are selected at once.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def simplify_ring(ring: list[list[float]], point_step: int) -> list[list[float]]:
    if point_step <= 1 or len(ring) <= 5:
        return ring

    simplified = [ring[0]]
    for idx in range(1, len(ring) - 1):
        if idx % point_step == 0:
            simplified.append(ring[idx])
    simplified.append(ring[-1])

    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])

    return simplified if len(simplified) >= 4 else ring


def simplify_geometry(geometry: dict[str, Any], point_step: int) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type not in {"Polygon", "MultiPolygon"} or not isinstance(coordinates, list):
        return geometry

    if geometry_type == "Polygon":
        rings = coordinates
        simplified_rings: list[list[list[float]]] = []
        for ring in rings:
            if not isinstance(ring, list):
                continue
            coords = [pt[:2] for pt in ring if isinstance(pt, list) and len(pt) >= 2]
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            simplified_rings.append(simplify_ring(coords, point_step))

        if not simplified_rings:
            return None
        return {"type": "Polygon", "coordinates": simplified_rings}

    polygons = coordinates
    simplified_polygons: list[list[list[list[float]]]] = []
    for polygon in polygons:
        if not isinstance(polygon, list):
            continue
        simplified_rings = []
        for ring in polygon:
            if not isinstance(ring, list):
                continue
            coords = [pt[:2] for pt in ring if isinstance(pt, list) and len(pt) >= 2]
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            simplified_rings.append(simplify_ring(coords, point_step))

        if simplified_rings:
            simplified_polygons.append(simplified_rings)

    if not simplified_polygons:
        return None
    return {"type": "MultiPolygon", "coordinates": simplified_polygons}


def main() -> int:
    parser = argparse.ArgumentParser(description="Simplify existing region GeoJSON files in place.")
    parser.add_argument(
        "--input-dir",
        default="client/public/data/regions",
        help="Directory containing region JSON files",
    )
    parser.add_argument(
        "--point-step",
        type=int,
        default=5,
        help="Keep every Nth point in each ring (1 = no simplification)",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    files = [path for path in input_dir.glob("*.json") if path.name != "ontario-index.json"]

    updated = 0
    skipped = 0

    for file_path in files:
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8-sig"))
        except Exception:
            skipped += 1
            continue

        if payload.get("type") != "FeatureCollection":
            skipped += 1
            continue

        features = payload.get("features") or []
        changed = False

        for feature in features:
            geometry = feature.get("geometry") if isinstance(feature, dict) else None
            if not isinstance(geometry, dict):
                continue
            simplified = simplify_geometry(geometry, args.point_step)
            if simplified is None:
                continue
            if simplified != geometry:
                feature["geometry"] = simplified
                changed = True

        if changed:
            file_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
            updated += 1

    print(f"FILES={len(files)}")
    print(f"UPDATED={updated}")
    print(f"SKIPPED={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())