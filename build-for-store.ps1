# Build script for Chrome Web Store submission
# Creates a clean zip excluding dev files

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = Join-Path $projectDir "dist"
$zipName = "RedditOutreach-store.zip"

Write-Host "Building RedditOutreach for Chrome Web Store..." -ForegroundColor Cyan

# Create dist directory
if (Test-Path $distDir) {
    Remove-Item -Recurse -Force $distDir
}
New-Item -ItemType Directory -Path $distDir | Out-Null

# Files/folders to include
$includeItems = @(
    "manifest.json",
    "config.js",
    "background",
    "content",
    "popup",
    "services",
    "options",
    "docs",
    "icons"
)

# Copy files to dist
foreach ($item in $includeItems) {
    $source = Join-Path $projectDir $item
    if (Test-Path $source) {
        $dest = Join-Path $distDir $item
        if ((Get-Item $source).PSIsContainer) {
            Copy-Item -Recurse $source $dest
        } else {
            Copy-Item $source $dest
        }
    }
}

# Create zip
$zipPath = Join-Path $projectDir $zipName
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}
Compress-Archive -Path "$distDir\*" -DestinationPath $zipPath

# Cleanup
Remove-Item -Recurse -Force $distDir

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "  Output: $zipPath" -ForegroundColor White
Write-Host ""
Write-Host "Upload this zip to Chrome Web Store Developer Dashboard" -ForegroundColor Cyan
