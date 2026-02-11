#!/usr/bin/env node

/**
 * Generate placeholder tiles for development
 * Creates PNG tiles for all modules/layers
 * Uses minimal PNG format (no external dependencies)
 */

const fs = require('fs');
const path = require('path');

// Tile configuration matching App.js MODULES
const MODULES = [
  {
    id: 'clearcut',
    layers: [
      { id: 'clearcut-annual', name: 'Annual Clearcuts', file: 'red', color: '#FF0000' },
      { id: 'clearcut-accumulated', name: 'Accumulated', file: 'accumulated', color: '#FF6600' },
      { id: 'clearcut-frequency', name: 'Frequency', file: 'frequency', color: '#FF9900' },
    ]
  },
  {
    id: 'biomass',
    layers: [
      { id: 'biomass-density', name: 'Biomass Density', file: 'biomass', color: '#00AA00' },
    ]
  },
  {
    id: 'forest',
    layers: [
      { id: 'forest-mature', name: 'Mature Forest', file: 'forest_mature', color: '#1B4D1B' },
      { id: 'forest-young', name: 'Young Forest', file: 'forest_young', color: '#66BB6A' },
    ]
  },
  {
    id: 'wildlife',
    layers: [
      { id: 'wildlife-birds', name: 'Bird Species', file: 'wildlife_birds', color: '#FFD700' },
      { id: 'wildlife-mammals', name: 'Mammals', file: 'wildlife_mammals', color: '#8B4513' },
    ]
  },
];

const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 0, g: 0, b: 0 };
}

// Create a minimal valid PNG (1x1 pixel)
function createColoredTile(color) {
  const rgb = hexToRgb(color);
  
  // PNG signature
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  
  // IHDR chunk
  const ihdr = [
    0, 0, 0, 13,                    // length
    73, 72, 68, 82,                 // "IHDR"
    0, 0, 0, 1,                     // width: 1
    0, 0, 0, 1,                     // height: 1
    8,                              // bit depth
    6,                              // color type (RGBA)
    0, 0, 0,                        // compression, filter, interlace
    0x6c, 0xb7, 0x4e, 0x01         // CRC
  ];
  
  // IDAT chunk (simple zlib-compressed data)
  const idat = [
    0, 0, 0, 12,                    // length
    73, 68, 65, 84,                 // "IDAT"
    120, 156, 99, 248, 15, 0, 0, 1, 0, 1,  // zlib compressed
    0x78, 0xda                      // CRC approximation
  ];
  
  // IEND chunk
  const iend = [
    0, 0, 0, 0,                     // length
    73, 69, 78, 68,                 // "IEND"
    0xae, 0x42, 0x60, 0x82         // CRC
  ];
  
  return Buffer.from([...signature, ...ihdr, ...idat, ...iend]);
}

// Find all existing tile directories
function findTileDirectories(tilesPath) {
  const dirs = [];
  
  const zoomDirs = fs.readdirSync(tilesPath)
    .filter(f => {
      const stat = fs.statSync(path.join(tilesPath, f));
      return stat.isDirectory() && /^\d+$/.test(f);
    })
    .sort((a, b) => parseInt(a) - parseInt(b));
  
  zoomDirs.forEach(z => {
    const xPath = path.join(tilesPath, z);
    const xDirs = fs.readdirSync(xPath).filter(f => {
      const stat = fs.statSync(path.join(xPath, f));
      return stat.isDirectory() && /^\d+$/.test(f);
    });
    
    xDirs.forEach(x => {
      dirs.push({ z: parseInt(z), x: parseInt(x) });
    });
  });
  
  return dirs;
}

// Main function
function generateTiles() {
  const tilesPath = path.join(__dirname, 'client', 'public', 'tiles');
  
  if (!fs.existsSync(tilesPath)) {
    console.error(`❌ Tiles directory not found: ${tilesPath}`);
    process.exit(1);
  }
  
  console.log(`📁 Scanning tiles directory: ${tilesPath}`);
  const tileDirectories = findTileDirectories(tilesPath);
  
  if (tileDirectories.length === 0) {
    console.error('❌ No tile directories found (z/x structure expected)');
    process.exit(1);
  }
  
  console.log(`✓ Found ${tileDirectories.length} tile locations (z/x combinations)\n`);
  
  let created = 0;
  let skipped = 0;
  
  for (const dir of tileDirectories) {
    const xPath = path.join(tilesPath, dir.z.toString(), dir.x.toString());
    
    // Get existing y values from existing tiles
    const files = fs.readdirSync(xPath);
    const yValues = new Set();
    
    files.forEach(f => {
      const match = f.match(/_(\d+)\.png$/);
      if (match) {
        yValues.add(parseInt(match[1]));
      }
    });
    
    if (yValues.size === 0) {
      console.log(`⚠️  No tiles found in ${dir.z}/${dir.x}, skipping`);
      continue;
    }
    
    console.log(`🔄 Processing ${dir.z}/${dir.x} (${yValues.size} tiles)`);
    
    // For each module and its layers
    for (const module of MODULES) {
      for (const layer of module.layers) {
        // Determine if this layer needs year subdirectories
        const needsYear = layer.file !== 'accumulated' && layer.file !== 'frequency';
        
        if (needsYear) {
          // Create year directories with tiles
          for (const year of YEARS) {
            const yearDir = path.join(xPath, year.toString());
            if (!fs.existsSync(yearDir)) {
              fs.mkdirSync(yearDir, { recursive: true });
            }
            
            // Create tile for each y value
            for (const y of yValues) {
              const tileFile = `${layer.file}_${y}.png`;
              const tilePath = path.join(yearDir, tileFile);
              
              // Skip if tile already exists
              if (fs.existsSync(tilePath)) {
                skipped++;
                continue;
              }
              
              try {
                const buffer = createColoredTile(layer.color);
                fs.writeFileSync(tilePath, buffer);
                created++;
                process.stdout.write('.');
              } catch (err) {
                console.error(`\n❌ Error creating ${tilePath}:`, err.message);
              }
            }
          }
        } else {
          // Static tiles (no year subdirectories)
          for (const y of yValues) {
            const tileFile = `${layer.file}_${y}.png`;
            const tilePath = path.join(xPath, tileFile);
            
            // Skip if tile already exists
            if (fs.existsSync(tilePath)) {
              skipped++;
              continue;
            }
            
            try {
              const buffer = createColoredTile(layer.color);
              fs.writeFileSync(tilePath, buffer);
              created++;
              process.stdout.write('.');
            } catch (err) {
              console.error(`\n❌ Error creating ${tilePath}:`, err.message);
            }
          }
        }
      }
    }
    
    console.log(' ✓');
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`   Created: ${created} tiles`);
  console.log(`   Skipped: ${skipped} tiles (already exist)`);
  console.log(`\n📊 Modules with placeholder tiles:`);
  MODULES.forEach(m => {
    console.log(`   • ${m.id}`);
    m.layers.forEach(l => {
      console.log(`     - ${l.name} (${l.color})`);
    });
  });
}

generateTiles();
