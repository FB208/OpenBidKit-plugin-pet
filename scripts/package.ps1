param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot "dist"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$archiveName = "{0}-v{1}.zip" -f $manifest.id, $manifest.version
$archivePath = Join-Path $OutputDirectory $archiveName
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("openbidkit-pet-package-" + [Guid]::NewGuid().ToString("N"))
$packageFiles = @(
  "manifest.json",
  "package.json",
  "main.cjs",
  "preload.cjs",
  "pet.html",
  "pet.css",
  "pet.js",
  "assets\icon.png"
)

try {
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

  foreach ($relativePath in $packageFiles) {
    $sourcePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Missing package file: $relativePath"
    }

    $destinationPath = Join-Path $stageRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }

  Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal -Force
  Write-Host "Package created: $archivePath"
}
finally {
  $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedStageRoot = [System.IO.Path]::GetFullPath($stageRoot)
  if ($resolvedStageRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStageRoot)) {
    Remove-Item -LiteralPath $resolvedStageRoot -Recurse -Force
  }
}
