# Reorganize tiles from zoom/x/year/file.png to year/zoom/x/file.png structure

$SourceDir = "client\public\tiles"
$BackupDir = "tiles_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Tile Reorganization Script" -ForegroundColor Cyan
Write-Host "From: zoom/x/year/file.png" -ForegroundColor Yellow
Write-Host "To:   year/zoom/x/file.png" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# Create backup
Write-Host "`n[1/4] Creating backup..." -ForegroundColor Cyan
if (Test-Path $SourceDir) {
    Copy-Item -Path $SourceDir -Destination $BackupDir -Recurse -Force
    Write-Host "  Backup created at: $BackupDir" -ForegroundColor Green
}
else {
    Write-Host "  Source directory not found: $SourceDir" -ForegroundColor Red
    exit 1
}

# Find all tile files in year subdirectories
Write-Host "`n[2/4] Scanning for tiles..." -ForegroundColor Cyan
$tiles = Get-ChildItem -Path $SourceDir -Recurse -File -Filter "*.png" | Where-Object { $_.DirectoryName -match '\\(\d+)\\(\d+)\\(\d{4})$' }

Write-Host "  Found $($tiles.Count) tiles to reorganize" -ForegroundColor Green

if ($tiles.Count -eq 0) {
    Write-Host "`n  No tiles found with zoom/x/year structure. Exiting." -ForegroundColor Yellow
    exit 0
}

# Create temporary directory for reorganized tiles
Write-Host "`n[3/4] Reorganizing tiles..." -ForegroundColor Cyan
$tempDir = "tiles_temp_$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$processedCount = 0
$errorCount = 0

foreach ($tile in $tiles) {
    try {
        if ($tile.DirectoryName -match '\\(\d+)\\(\d+)\\(\d{4})$') {
            $zoom = $matches[1]
            $x = $matches[2]
            $year = $matches[3]
            $fileName = $tile.Name
            
            $newDir = Join-Path $tempDir "$year\$zoom\$x"
            New-Item -ItemType Directory -Path $newDir -Force | Out-Null
            
            $newPath = Join-Path $newDir $fileName
            Copy-Item -Path $tile.FullName -Destination $newPath -Force
            
            $processedCount++
            if ($processedCount % 100 -eq 0) {
                Write-Host "  Progress: $processedCount/$($tiles.Count) tiles processed..." -ForegroundColor Gray
            }
        }
    }
    catch {
        Write-Host "  Error processing $($tile.FullName): $_" -ForegroundColor Red
        $errorCount++
    }
}

Write-Host "  Reorganized $processedCount tiles" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "  $errorCount errors occurred" -ForegroundColor Yellow
}

# Remove old zoom-level directories and move new structure in place
Write-Host "`n[4/4] Finalizing structure..." -ForegroundColor Cyan

# Remove old zoom directories from source
Get-ChildItem -Path $SourceDir -Directory | Where-Object { $_.Name -match '^\d+$' -and [int]$_.Name -ge 6 -and [int]$_.Name -le 14 } | ForEach-Object {
    Remove-Item -Path $_.FullName -Recurse -Force
    Write-Host "  Removed old structure: $($_.Name)" -ForegroundColor Gray
}

# Move new structure from temp to source
Get-ChildItem -Path $tempDir -Directory | ForEach-Object {
    $destPath = Join-Path $SourceDir $_.Name
    if (Test-Path $destPath) {
        Get-ChildItem -Path $_.FullName -Recurse | ForEach-Object {
            $relativePath = $_.FullName.Substring($tempDir.Length + 1)
            $finalDest = Join-Path $SourceDir $relativePath
            if ($_.PSIsContainer) {
                New-Item -ItemType Directory -Path $finalDest -Force | Out-Null
            }
            else {
                Copy-Item -Path $_.FullName -Destination $finalDest -Force
            }
        }
    }
    else {
        Move-Item -Path $_.FullName -Destination $SourceDir -Force
    }
    Write-Host "  Created year directory: $($_.Name)" -ForegroundColor Green
}

# Clean up temp directory
Remove-Item -Path $tempDir -Recurse -Force

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Reorganization Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "  Tiles processed: $processedCount" -ForegroundColor White
Write-Host "  Errors: $errorCount" -ForegroundColor White
Write-Host "  Backup location: $BackupDir" -ForegroundColor White

# Also reorganize build directory if it exists
$buildTilesDir = "client\build\tiles"
if (Test-Path $buildTilesDir) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Processing build directory..." -ForegroundColor Cyan
    
    Get-ChildItem -Path $buildTilesDir -Directory | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object {
        Remove-Item -Path $_.FullName -Recurse -Force
    }
    
    Get-ChildItem -Path $SourceDir -Directory | Where-Object { $_.Name -match '^\d{4}$' } | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $buildTilesDir -Recurse -Force
        Write-Host "  Copied $($_.Name) to build directory" -ForegroundColor Green
    }
    
    Write-Host "  Build directory updated" -ForegroundColor Green
}

Write-Host "`nAll done! Your tiles are now organized by year." -ForegroundColor Green
Write-Host "`nTo restore from backup if needed:" -ForegroundColor Yellow
Write-Host "  Remove-Item -Path '$SourceDir' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Move-Item -Path '$BackupDir' -Destination '$SourceDir'" -ForegroundColor Gray

