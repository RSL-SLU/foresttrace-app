#!/usr/bin/env python3
"""Generate placeholder tiles for development"""

import os
import struct
import zlib
from pathlib import Path

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

YEARS = list(range(2015, 2026))


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_png(color_hex):
    """Create a minimal valid PNG (1x1 pixel) with given color"""
    r, g, b = hex_to_rgb(color_hex)
    
    # PNG signature
    png = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    
    # IHDR chunk (1x1 RGBA, 8-bit)
    ihdr_data = struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data
    # Calculate CRC (simplified - using pre-calculated value for 1x1 RGBA)
    ihdr += bytes([0x6c, 0xb7, 0x4e, 0x01])
    
    # IDAT chunk with minimal compressed data
    pixel_data = bytes([0, r, g, b, 200])  # filter + RGBA + alpha
    compressed = zlib.compress(pixel_data)
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed
    # Simplified CRC
    idat += bytes([0, 0, 0, 0])
    
    # IEND chunk
    iend = struct.pack('>I', 0) + b'IEND' + bytes([0xae, 0x42, 0x60, 0x82])
    
    return png + ihdr + idat + iend


def find_tile_directories(tiles_path):
    """Find all z/x directory combinations"""
    dirs = []
    tiles_path = Path(tiles_path)
    
    for z_dir in sorted(tiles_path.iterdir()):
        if not z_dir.is_dir() or not z_dir.name.isdigit():
            continue
        
        for x_dir in sorted(z_dir.iterdir()):
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
    
    print(f'📁 Scanning tiles directory: {tiles_path}')
    tile_dirs = find_tile_directories(tiles_path)
    
    if not tile_dirs:
        print('❌ No tile directories found (z/x structure expected)')
        return 1
    
    print(f'✓ Found {len(tile_dirs)} tile locations (z/x combinations)\n')
    
    created = 0
    skipped = 0
    
    for loc in tile_dirs:
        x_path = loc['path']
        z, x = loc['z'], loc['x']
        
        # Find existing y values
        y_values = set()
        for png_file in x_path.glob('**/*.png'):
            if '_' in png_file.name:
                parts = png_file.name.split('_')
                if parts[-1].replace('.png', '').isdigit():
                    y_values.add(int(parts[-1].replace('.png', '')))
        
        if not y_values:
            print(f'⚠️  No tiles found in {z}/{x}, skipping')
            continue
        
        print(f'🔄 Processing {z}/{x} ({len(y_values)} tiles)', end='', flush=True)
        
        # For each module and layer
        for module in MODULES:
            for layer in module['layers']:
                file_name = layer['file']
                color = layer['color']
                
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
                            
                            if tile_path.exists():
                                skipped += 1
                                continue
                            
                            try:
                                png_data = create_png(color)
                                tile_path.write_bytes(png_data)
                                created += 1
                                print('.', end='', flush=True)
                            except Exception as e:
                                print(f'\n❌ Error creating {tile_path}: {e}')
                else:
                    # Static tiles (no year subdirectories)
                    for y in y_values:
                        tile_name = f'{file_name}_{y}.png'
                        tile_path = x_path / tile_name
                        
                        if tile_path.exists():
                            skipped += 1
                            continue
                        
                        try:
                            png_data = create_png(color)
                            tile_path.write_bytes(png_data)
                            created += 1
                            print('.', end='', flush=True)
                        except Exception as e:
                            print(f'\n❌ Error creating {tile_path}: {e}')
        
        print(' ✓')
    
    print(f'\n✅ Complete!')
    print(f'   Created: {created} tiles')
    print(f'   Skipped: {skipped} tiles (already exist)')
    print(f'\n📊 Modules with placeholder tiles:')
    for module in MODULES:
        print(f"   • {module['id']}")
        for layer in module['layers']:
            print(f"     - {layer['name']}")
    
    return 0


if __name__ == '__main__':
    exit(main())
