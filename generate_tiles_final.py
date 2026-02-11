#!/usr/bin/env python3
"""Generate placeholder tiles for development - Resume-capable version"""

import os
from pathlib import Path
from PIL import Image

# Module configuration
MODULES = [
    {
        'id': 'clearcut',
        'layers': [
            {'file': 'red', 'color': 'FF0000', 'name': 'Annual Clearcuts'},
            {'file': 'accumulated', 'color': 'FF6600', 'name': 'Accumulated'},
            {'file': 'frequency', 'color': 'FF9900', 'name': 'Frequency'},
        ]
    },
    {
        'id': 'biomass',
        'layers': [
            {'file': 'biomass', 'color': '00AA00', 'name': 'Biomass Density'},
        ]
    },
    {
        'id': 'forest',
        'layers': [
            {'file': 'forest_mature', 'color': '1B4D1B', 'name': 'Mature Forest'},
            {'file': 'forest_young', 'color': '66BB6A', 'name': 'Young Forest'},
        ]
    },
    {
        'id': 'wildlife',
        'layers': [
            {'file': 'wildlife_birds', 'color': 'FFD700', 'name': 'Bird Species'},
            {'file': 'wildlife_mammals', 'color': '8B4513', 'name': 'Mammals'},
        ]
    },
]

YEARS = [2025]
TARGET_ZOOMS = {10, 11, 12}
OVERWRITE_EXISTING = True
LAYER_FILE_FILTER = {"red"}


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_png(color_hex, size=256, alpha=200):
    """Create a valid 256x256 RGBA PNG using Pillow"""
    r, g, b = hex_to_rgb(color_hex)
    img = Image.new("RGBA", (size, size), (r, g, b, alpha))
    return img


def find_tile_directories(tiles_path):
    """Find all z/x directory combinations"""
    dirs = []
    tiles_path = Path(tiles_path)
    
    for z_dir in sorted(tiles_path.iterdir(), key=lambda d: int(d.name) if d.is_dir() and d.name.isdigit() else 999):
        if not z_dir.is_dir() or not z_dir.name.isdigit():
            continue
        
        for x_dir in sorted(z_dir.iterdir(), key=lambda d: int(d.name) if d.is_dir() and d.name.isdigit() else 999):
            if not x_dir.is_dir() or not x_dir.name.isdigit():
                continue
            
            dirs.append({
                'z': int(z_dir.name),
                'x': int(x_dir.name),
                'path': x_dir
            })
    
    return dirs


def main():
    tiles_path = Path(__file__).parent / 'client' / 'public' / 'tiles'
    
    if not tiles_path.exists():
        print(f'❌ Tiles directory not found: {tiles_path}')
        return 1
    
    print(f'📁 Scanning tiles directory...')
    tile_dirs = find_tile_directories(tiles_path)
    
    if not tile_dirs:
        print('❌ No tile directories found (z/x structure expected)')
        return 1
    
    print(f'✓ Found {len(tile_dirs)} tile locations\n')
    
    created = 0
    skipped = 0
    errors = 0
    
    for i, loc in enumerate(tile_dirs, 1):
        x_path = loc['path']
        z, x = loc['z'], loc['x']

        if TARGET_ZOOMS and z not in TARGET_ZOOMS:
            continue
        
        # Find existing y values (including subdirectories)
        y_values = set()
        for png_file in x_path.glob('**/*.png'):
            # Skip if in a year subdirectory and not red/accumulated/frequency
            rel_parts = png_file.relative_to(x_path).parts
            if len(rel_parts) == 2 and rel_parts[0].isdigit():
                # This is in a year directory
                name_parts = rel_parts[1].split('_')
            else:
                name_parts = png_file.name.split('_')
            
            if len(name_parts) >= 2 and name_parts[-1].replace('.png', '').isdigit():
                y_values.add(int(name_parts[-1].replace('.png', '')))
        
        if not y_values:
            continue
        
        print(f'[{i}/{len(tile_dirs)}] {z}/{x} ({len(y_values)} tiles)', end='', flush=True)
        
        try:
            # For each module and layer
            for module in MODULES:
                for layer in module['layers']:
                    file_name = layer['file']
                    color = layer['color']

                    if LAYER_FILE_FILTER and file_name not in LAYER_FILE_FILTER:
                        continue
                    
                    # Check if needs year subdirectories
                    needs_year = file_name not in ('accumulated', 'frequency')
                    
                    if needs_year:
                        # Create year directories
                        for year in YEARS:
                            year_dir = x_path / str(year)
                            year_dir.mkdir(exist_ok=True, parents=True)
                            
                            # Create tile for each y value
                            for y in y_values:
                                tile_name = f'{file_name}_{y}.png'
                                tile_path = year_dir / tile_name
                                
                                if tile_path.exists() and not OVERWRITE_EXISTING:
                                    skipped += 1
                                    continue
                                
                                try:
                                    img = create_png(color)
                                    img.save(tile_path, format="PNG")
                                    created += 1
                                except Exception as e:
                                    errors += 1
                                    print(f'\n❌ Error at {tile_path}: {e}', flush=True)
                    else:
                        # Static tiles (no year subdirectories)
                        for y in y_values:
                            tile_name = f'{file_name}_{y}.png'
                            tile_path = x_path / tile_name
                            
                            if tile_path.exists() and not OVERWRITE_EXISTING:
                                skipped += 1
                                continue
                            
                            try:
                                img = create_png(color)
                                img.save(tile_path, format="PNG")
                                created += 1
                            except Exception as e:
                                errors += 1
            
            print(' ✓', flush=True)
        except KeyboardInterrupt:
            print(f'\n⏸️  Interrupted at {z}/{x}')
            break
        except Exception as e:
            print(f'\n⚠️  Error at {z}/{x}: {e}', flush=True)
            errors += 1
    
    print(f'\n✅ Complete!')
    print(f'   Created: {created:,} tiles')
    print(f'   Skipped: {skipped:,} tiles (already exist)')
    if errors:
        print(f'   Errors: {errors}')
    print(f'\n📊 Modules with placeholder tiles:')
    for module in MODULES:
        print(f"   • {module['id']}")
        for layer in module['layers']:
            print(f"     - {layer['name']}")
    
    return 0


if __name__ == '__main__':
    try:
        exit(main())
    except KeyboardInterrupt:
        print('\n\n⏸️  Script interrupted by user')
        exit(0)
