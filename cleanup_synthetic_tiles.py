#!/usr/bin/env python3
"""
Remove synthetic placeholder tiles and keep only real clearcut tiles.
- Deletes any non-red tiles (biomass_, forest_, wildlife_, accumulated_, frequency_)
- Deletes red tiles in zoom levels not in ALLOWED_ZOOMS
"""

from pathlib import Path

ALLOWED_ZOOMS = {6, 7, 8, 9, 13, 14}
KEEP_PREFIX = "red_"


def should_delete(path: Path) -> bool:
    # Only consider PNG tiles
    if path.suffix.lower() != ".png":
        return False

    # Determine zoom level from path: tiles/{z}/{x}/... or tiles/{z}/{x}/{year}/...
    try:
        rel_parts = path.relative_to(TILES_DIR).parts
        z = int(rel_parts[0])
    except Exception:
        return False

    # Remove any zoom not in allowed list
    if z not in ALLOWED_ZOOMS:
        return True

    # Remove any non-red tiles
    filename = path.name
    if not filename.startswith(KEEP_PREFIX):
        return True

    return False


if __name__ == "__main__":
    TILES_DIR = Path(__file__).parent / "client" / "public" / "tiles"
    if not TILES_DIR.exists():
        raise SystemExit(f"Tiles directory not found: {TILES_DIR}")

    deleted = 0
    skipped = 0

    for png in TILES_DIR.rglob("*.png"):
        if should_delete(png):
            png.unlink()
            deleted += 1
        else:
            skipped += 1

    print(f"✅ Cleanup complete. Deleted {deleted} tiles, kept {skipped} tiles.")
