#!/usr/bin/env python3
"""
Pull Ontario FMU geometries from ArcGIS REST and write one GeoJSON file per FMU.

Outputs:
- client/public/data/regions/<id>.json
- client/public/data/regions/ontario-index.json

Notes:
- Uses OBJECTID batching (more reliable than offset pagination for this service).
- No third-party dependencies required.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_SERVICE = (
    "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/"
    "LIO_OPEN_DATA/LIO_Open07/MapServer/20"
)


def http_get_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    query = urllib.parse.urlencode(params)
    full_url = f"{url}?{query}"
    req = urllib.request.Request(full_url, headers={"User-Agent": "foresttrace-fmu-puller/1.0"})
    with urllib.request.urlopen(req, timeout=120) as response:
        payload = response.read().decode("utf-8-sig")
    return json.loads(payload)


def to_region_id(name: str) -> str:
    value = name.strip().lower()
    value = re.sub(r"\s+forest$", "", value)
    value = re.sub(r"[^a-z0-9]+", "", value)
    return value.strip()


def simplify_ring(ring: list[list[float]], point_step: int) -> list[list[float]]:
    if point_step <= 1 or len(ring) <= 5:
        return ring

    # Keep first, every Nth point, and last; then ensure closed ring.
    simplified = [ring[0]]
    for idx in range(1, len(ring) - 1):
        if idx % point_step == 0:
            simplified.append(ring[idx])
    simplified.append(ring[-1])

    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])

    if len(simplified) < 4:
        return ring
    return simplified


def convert_geometry(geom: dict[str, Any], point_step: int) -> dict[str, Any] | None:
    rings = geom.get("rings")
    if not rings:
        return None

    cleaned_rings: list[list[list[float]]] = []
    for ring in rings:
        coords: list[list[float]] = []
        for pt in ring:
            if not isinstance(pt, list) or len(pt) < 2:
                continue
            coords.append([float(pt[0]), float(pt[1])])

        if len(coords) < 4:
            continue

        if coords[0] != coords[-1]:
            coords.append(coords[0])

        coords = simplify_ring(coords, point_step)
        cleaned_rings.append(coords)

    if not cleaned_rings:
        return None

    # Simple robust encoding: 1 ring => Polygon, multi ring => MultiPolygon (one ring each).
    if len(cleaned_rings) == 1:
        return {"type": "Polygon", "coordinates": [cleaned_rings[0]]}

    return {
        "type": "MultiPolygon",
        "coordinates": [[ring] for ring in cleaned_rings],
    }


def batched(values: list[int], size: int) -> list[list[int]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


def fetch_feature_batch(service: str, object_ids: list[int]) -> dict[str, Any]:
    return http_get_json(
        f"{service}/query",
        {
            "objectIds": ",".join(str(v) for v in object_ids),
            "outFields": "FMU_NAME,FMU_CODE,OGF_ID",
            "outSR": 4326,
            "returnGeometry": "true",
            "returnM": "false",
            "returnZ": "false",
            "f": "json",
        },
    )


def fetch_features_resilient(service: str, object_ids: list[int]) -> tuple[list[dict[str, Any]], list[int]]:
    """Fetch features for object IDs with recursive split on server-side failures.

    Returns:
      (features, failed_object_ids)
    """
    try:
        resp = fetch_feature_batch(service, object_ids)
        if resp.get("error"):
            raise RuntimeError(str(resp["error"]))
        return (resp.get("features") or [], [])
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as err:
        if len(object_ids) == 1:
            print(f"Skipping OBJECTID {object_ids[0]} after error: {err}", file=sys.stderr)
            return ([], object_ids)

        mid = len(object_ids) // 2
        left = object_ids[:mid]
        right = object_ids[mid:]

        left_features, left_failed = fetch_features_resilient(service, left)
        right_features, right_failed = fetch_features_resilient(service, right)
        return (left_features + right_features, left_failed + right_failed)


def main() -> int:
    parser = argparse.ArgumentParser(description="Pull Ontario FMU boundaries into per-area GeoJSON files.")
    parser.add_argument("--service", default=DEFAULT_SERVICE, help="ArcGIS layer REST URL")
    parser.add_argument(
        "--out-dir",
        default="client/public/data/regions",
        help="Output folder for per-area region JSON files",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=25,
        help="Number of OBJECTIDs per geometry query batch",
    )
    parser.add_argument(
        "--point-step",
        type=int,
        default=5,
        help="Keep every Nth point in rings (1 = no simplification)",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[1/4] Reading layer metadata...")
    meta = http_get_json(args.service, {"f": "json"})

    if meta.get("error"):
        print(f"Service metadata error: {meta['error']}", file=sys.stderr)
        return 1

    oid_field = meta.get("objectIdField") or "OBJECTID"

    print("[2/4] Fetching all OBJECTIDs...")
    ids_resp = http_get_json(
        f"{args.service}/query",
        {
            "where": "1=1",
            "returnIdsOnly": "true",
            "f": "json",
        },
    )

    if ids_resp.get("error"):
        print(f"ID query error: {ids_resp['error']}", file=sys.stderr)
        return 1

    object_ids = sorted(ids_resp.get("objectIds") or [])
    if not object_ids:
        print("No OBJECTIDs returned; nothing to write.")
        return 1

    print(f"Found {len(object_ids)} features.")

    print("[3/4] Pulling geometry batches...")
    features: list[dict[str, Any]] = []
    failed_ids: list[int] = []
    for batch in batched(object_ids, max(1, args.batch_size)):
        batch_features, batch_failed = fetch_features_resilient(args.service, batch)
        features.extend(batch_features)
        failed_ids.extend(batch_failed)

    if not features:
        print("No features with geometry were downloaded.", file=sys.stderr)
        return 1

    print(f"Downloaded {len(features)} feature payloads.")

    print("[4/4] Writing per-area JSON files...")
    index_areas: list[dict[str, Any]] = []
    written = 0

    for item in features:
        attrs = item.get("attributes") or {}
        geom = item.get("geometry") or {}

        name = str(attrs.get("FMU_NAME") or "").strip()
        if not name:
            continue

        region_id = to_region_id(name)
        if not region_id:
            continue

        geojson_geom = convert_geometry(geom, args.point_step)
        if not geojson_geom:
            continue

        feature = {
            "type": "Feature",
            "properties": {
                "id": region_id,
                "name": name,
                "fmuCode": str(attrs.get("FMU_CODE") or ""),
                "ogfId": attrs.get("OGF_ID"),
                "province": "ontario",
                "source": "Ontario GeoHub FMU layer",
            },
            "geometry": geojson_geom,
        }

        fc = {"type": "FeatureCollection", "features": [feature]}
        file_path = out_dir / f"{region_id}.json"
        file_path.write_text(json.dumps(fc, ensure_ascii=True), encoding="utf-8")
        written += 1

        index_areas.append(
            {
                "id": region_id,
                "name": name,
                "fmuCode": str(attrs.get("FMU_CODE") or ""),
                "file": f"data/regions/{region_id}.json",
            }
        )

    # Keep unique by id while preserving sorted output by name.
    unique_by_id = {}
    for area in sorted(index_areas, key=lambda x: x["name"]):
        unique_by_id[area["id"]] = area
    final_areas = list(unique_by_id.values())

    index_payload = {
        "type": "RegionIndex",
        "group": "ontario",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": args.service,
        "areas": final_areas,
    }
    (out_dir / "ontario-index.json").write_text(
        json.dumps(index_payload, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )

    print(f"WROTE={written}")
    print(f"INDEX_AREAS={len(final_areas)}")
    print(f"FAILED_OBJECTIDS={len(failed_ids)}")
    print(f"OUT_DIR={out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
