from PIL import Image
import numpy as np
import os
import glob

# Find all biomass tiles
tiles_pattern = r'.\client\public\tiles\biomass\agb\2010\**\*.png'
tile_files = glob.glob(tiles_pattern, recursive=True)

print(f"Found {len(tile_files)} tiles")

# Analyze a sample of tiles
all_r_values = []
all_g_values = []
all_b_values = []
tiles_with_data = 0

for tile_path in tile_files[:50]:  # Check first 50 tiles
    img = Image.open(tile_path)
    arr = np.array(img)
    
    if arr.shape[2] >= 4:
        alpha = arr[:,:,3]
        non_zero_mask = alpha > 0
        
        if non_zero_mask.sum() > 0:
            tiles_with_data += 1
            all_r_values.extend(arr[non_zero_mask, 0].tolist())
            all_g_values.extend(arr[non_zero_mask, 1].tolist())
            all_b_values.extend(arr[non_zero_mask, 2].tolist())

print(f"\nTiles with data: {tiles_with_data}")

if all_r_values:
    print(f"\nRed channel:")
    print(f"  Min: {min(all_r_values)}, Max: {max(all_r_values)}")
    print(f"  Unique values count: {len(set(all_r_values))}")
    print(f"  Sample values: {sorted(set(all_r_values))[:20]}")
    
    print(f"\nGreen channel:")
    print(f"  Min: {min(all_g_values)}, Max: {max(all_g_values)}")
    print(f"  Unique values count: {len(set(all_g_values))}")
    print(f"  Sample values: {sorted(set(all_g_values))[:20]}")
    
    print(f"\nBlue channel:")
    print(f"  Min: {min(all_b_values)}, Max: {max(all_b_values)}")
    print(f"  Unique values count: {len(set(all_b_values))}")
    print(f"  Sample values: {sorted(set(all_b_values))[:20]}")
    
    # Check if it's a greyscale-like encoding
    if len(set(all_r_values)) == len(set(all_g_values)) == len(set(all_b_values)):
        print("\nAll channels have same unique count - might be greyscale encoded")
else:
    print("No data found in tiles!")
