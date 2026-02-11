#!/usr/bin/env python3
"""
Reorganize existing tile structure to match new temporal architecture.

Current structure:
  tiles/{z}/{x}/red_*.png
  tiles/{z}/{x}/accumulated_*.png
  tiles/{z}/{x}/frequency_*.png

New structure:
  tiles/{z}/{x}/2025/red_*.png          (moved to year subdirectory)
  tiles/{z}/{x}/accumulated_*.png       (stays at root)
  tiles/{z}/{x}/frequency_*.png         (stays at root)

This script moves red_*.png files into 2025/ subdirectories.
"""

import os
import shutil
from pathlib import Path


def reorganize_tiles():
    """Reorganize tiles from flat structure to temporal structure"""
    
    tiles_path = Path(__file__).parent / 'client' / 'public' / 'tiles'
    
    if not tiles_path.exists():
        print(f'❌ Tiles directory not found: {tiles_path}')
        return 1
    
    print(f'📁 Scanning tiles directory: {tiles_path}\n')
    
    moved = 0
    skipped = 0
    errors = 0
    
    # Find all z/x directories
    for z_dir in sorted(tiles_path.iterdir(), key=lambda d: int(d.name) if d.is_dir() and d.name.isdigit() else 999):
        if not z_dir.is_dir() or not z_dir.name.isdigit():
            continue
        
        for x_dir in sorted(z_dir.iterdir(), key=lambda d: int(d.name) if d.is_dir() and d.name.isdigit() else 999):
            if not x_dir.is_dir() or not x_dir.name.isdigit():
                continue
            
            z, x = z_dir.name, x_dir.name
            
            # Find all red_*.png files in this directory
            red_tiles = list(x_dir.glob('red_*.png'))
            
            if not red_tiles:
                continue
            
            print(f'🔄 Processing {z}/{x} ({len(red_tiles)} tiles to move)', end='', flush=True)
            
            # Create 2025 subdirectory
            year_dir = x_dir / '2025'
            year_dir.mkdir(exist_ok=True, parents=True)
            
            # Move each red_*.png file
            for tile in red_tiles:
                try:
                    dest = year_dir / tile.name
                    
                    # Skip if already exists
                    if dest.exists():
                        skipped += 1
                        print('.', end='', flush=True)
                        continue
                    
                    # Move the file
                    shutil.move(str(tile), str(dest))
                    moved += 1
                    print('.', end='', flush=True)
                    
                except Exception as e:
                    print(f'\n❌ Error moving {tile.name}: {e}')
                    errors += 1
            
            print(' ✓')
    
    print(f'\n✅ Complete!')
    print(f'   Moved: {moved} tiles')
    print(f'   Skipped: {skipped} tiles (already in 2025/)')
    if errors:
        print(f'   Errors: {errors}')
    
    print(f'\n📊 Structure after reorganization:')
    print(f'   ✓ Annual tiles:      {tiles_path}/{{z}}/{{x}}/2025/red_*.png')
    print(f'   ✓ Accumulated tiles: {tiles_path}/{{z}}/{{x}}/accumulated_*.png')
    print(f'   ✓ Frequency tiles:   {tiles_path}/{{z}}/{{x}}/frequency_*.png')
    
    return 0


def verify_structure():
    """Verify the new tile structure is correct"""
    
    tiles_path = Path(__file__).parent / 'client' / 'public' / 'tiles'
    
    print(f'\n🔍 Verifying tile structure...\n')
    
    has_errors = False
    
    # Find all z/x directories
    for z_dir in sorted(tiles_path.iterdir(), key=lambda d: int(d.name) if d.is_dir() and d.name.isdigit() else 999):
        if not z_dir.is_dir() or not z_dir.name.isdigit():
            continue
        
        for x_dir in sorted(z_dir.iterdir(), key=lambda d: int(d.name) if d.is_dir() and d.name.isdigit() else 999):
            if not x_dir.is_dir() or not x_dir.name.isdigit():
                continue
            
            z, x = z_dir.name, x_dir.name
            
            # Check for red_*.png at root (should be none)
            red_at_root = list(x_dir.glob('red_*.png'))
            if red_at_root:
                print(f'⚠️  {z}/{x}: Found {len(red_at_root)} red_*.png at root (should be in 2025/)')
                has_errors = True
            
            # Check for red tiles in 2025/
            year_2025 = x_dir / '2025'
            if year_2025.exists():
                red_in_year = list(year_2025.glob('red_*.png'))
                if red_in_year:
                    print(f'✓ {z}/{x}: {len(red_in_year)} red tiles in 2025/')
            
            # Check for accumulated_*.png at root
            accumulated = list(x_dir.glob('accumulated_*.png'))
            if accumulated:
                print(f'✓ {z}/{x}: {len(accumulated)} accumulated tiles at root')
            
            # Check for frequency_*.png at root
            frequency = list(x_dir.glob('frequency_*.png'))
            if frequency:
                print(f'✓ {z}/{x}: {len(frequency)} frequency tiles at root')
    
    if not has_errors:
        print('✅ All tiles are in correct locations!')
    else:
        print('\n⚠️  Some tiles are in unexpected locations - review above')
    
    return 0 if not has_errors else 1


if __name__ == '__main__':
    import sys
    
    print('='*70)
    print('Tile Structure Reorganization Tool')
    print('='*70)
    print()
    
    try:
        # Run reorganization
        result = reorganize_tiles()
        
        if result == 0:
            # Verify after reorganization
            verify_structure()
        
        sys.exit(result)
    except KeyboardInterrupt:
        print('\n\n⏸️  Script interrupted by user')
        sys.exit(1)
    except Exception as e:
        print(f'\n❌ Unexpected error: {e}')
        sys.exit(1)
