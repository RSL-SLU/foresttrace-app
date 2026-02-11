# PowerShell script to generate placeholder tiles
# Creates colored PNG placeholders for all modules/layers

$ErrorActionPreference = "Stop"

$tilesPath = "client\public\tiles"

if (-not (Test-Path $tilesPath)) {
    Write-Error "Tiles directory not found: $tilesPath"
    exit 1
}

Write-Host "📁 Scanning tiles directory: $tilesPath"

# Find all z/x directories
$zoomDirs = Get-ChildItem -Path $tilesPath -Directory | Where-Object { $_.Name -match '^\d+$' } | Sort-Object Name
$tileLocations = @()

foreach ($z in $zoomDirs) {
    $xDirs = Get-ChildItem -Path $z.FullName -Directory | Where-Object { $_.Name -match '^\d+$' }
    foreach ($x in $xDirs) {
        $tileLocations += @{ z = [int]$z.Name; x = [int]$x.Name; path = $x.FullName }
    }
}

Write-Host "✓ Found $($tileLocations.Count) tile locations (z/x combinations)`n"

# Module configuration
$modules = @(
    @{
        id = "clearcut"
        layers = @(
            @{ file = "red"; color = "FF0000"; name = "Annual Clearcuts" },
            @{ file = "accumulated"; color = "FF6600"; name = "Accumulated" },
            @{ file = "frequency"; color = "FF9900"; name = "Frequency" }
        )
    },
    @{
        id = "biomass"
        layers = @(
            @{ file = "biomass"; color = "00AA00"; name = "Biomass Density" }
        )
    },
    @{
        id = "forest"
        layers = @(
            @{ file = "forest_mature"; color = "1B4D1B"; name = "Mature Forest" },
            @{ file = "forest_young"; color = "66BB6A"; name = "Young Forest" }
        )
    },
    @{
        id = "wildlife"
        layers = @(
            @{ file = "wildlife_birds"; color = "FFD700"; name = "Bird Species" },
            @{ file = "wildlife_mammals"; color = "8B4513"; name = "Mammals" }
        )
    }
)

$years = 2015..2025

$created = 0
$skipped = 0

foreach ($loc in $tileLocations) {
    $xPath = $loc.path
    
    # Find existing y values from existing PNG files
    $files = Get-ChildItem -Path $xPath -Filter "*.png" -File
    $yValues = @()
    
    foreach ($file in $files) {
        if ($file.Name -match '_(\d+)\.png$') {
            $yValues += [int]$matches[1]
        }
    }
    
    $yValues = $yValues | Select-Object -Unique
    
    if ($yValues.Count -eq 0) {
        Write-Host "⚠️  No tiles found in $($loc.z)/$($loc.x), skipping"
        continue
    }
    
    Write-Host "🔄 Processing $($loc.z)/$($loc.x) ($($yValues.Count) tiles)" -NoNewline
    
    # For each module and layer
    foreach ($module in $modules) {
        foreach ($layer in $module.layers) {
            # Determine if needs year subdirectories
            $needsYear = $layer.file -notmatch "^(accumulated|frequency)$"
            
            if ($needsYear) {
                # Create year directories
                foreach ($year in $years) {
                    $yearDir = Join-Path $xPath $year.ToString()
                    if (-not (Test-Path $yearDir)) {
                        New-Item -ItemType Directory -Path $yearDir -Force | Out-Null
                    }
                    
                    # Create tile for each y value
                    foreach ($y in $yValues) {
                        $tileName = "$($layer.file)_$y.png"
                        $tilePath = Join-Path $yearDir $tileName
                        
                        if (Test-Path $tilePath) {
                            $skipped++
                            continue
                        }
                        
                        # Create simple 1x1 PNG with color
                        # PNG signature
                        $png = @(137, 80, 78, 71, 13, 10, 26, 10)
                        
                        # IHDR chunk (1x1 RGBA)
                        $png += @(0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x6c, 0xb7, 0x4e, 0x01)
                        
                        # IDAT chunk (minimal compressed data)
                        $png += @(0, 0, 0, 12, 73, 68, 65, 84, 120, 156, 99, 248, 15, 0, 0, 1, 0, 1, 0x78, 0xda)
                        
                        # IEND chunk
                        $png += @(0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82)
                        
                        [System.IO.File]::WriteAllBytes($tilePath, [byte[]]$png)
                        $created++
                        Write-Host "." -NoNewline
                    }
                }
            } else {
                # Static tiles (no year subdirectories)
                foreach ($y in $yValues) {
                    $tileName = "$($layer.file)_$y.png"
                    $tilePath = Join-Path $xPath $tileName
                    
                    if (Test-Path $tilePath) {
                        $skipped++
                        continue
                    }
                    
                    # Create simple 1x1 PNG
                    $png = @(137, 80, 78, 71, 13, 10, 26, 10)
                    $png += @(0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x6c, 0xb7, 0x4e, 0x01)
                    $png += @(0, 0, 0, 12, 73, 68, 65, 84, 120, 156, 99, 248, 15, 0, 0, 1, 0, 1, 0x78, 0xda)
                    $png += @(0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82)
                    
                    [System.IO.File]::WriteAllBytes($tilePath, [byte[]]$png)
                    $created++
                    Write-Host "." -NoNewline
                }
            }
        }
    }
    
    Write-Host " ✓"
}

Write-Host "`n✅ Complete!"
Write-Host "   Created: $created tiles"
Write-Host "   Skipped: $skipped tiles (already exist)"
Write-Host "`n📊 Modules with placeholder tiles:"

foreach ($module in $modules) {
    Write-Host "   • $($module.id)"
    foreach ($layer in $module.layers) {
        Write-Host "     - $($layer.name)"
    }
}
