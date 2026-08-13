param(
  [string]$OutputDirectory = "",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$manifest.version
}

if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
  throw "Version must use semantic version format X.Y.Z: $Version"
}

if ([string]::IsNullOrWhiteSpace([string]$manifest.repository)) {
  throw "manifest.json is missing repository"
}

$repository = ([string]$manifest.repository).TrimEnd("/")
$manifest.version = $Version
$manifest.releaseUrl = "{0}/releases/download/v{1}/{2}-v{1}.zip" -f $repository, $Version, $manifest.id

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot "dist"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$archiveName = "{0}-v{1}.zip" -f $manifest.id, $Version
$archivePath = Join-Path $OutputDirectory $archiveName
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("openbidkit-pet-package-" + [Guid]::NewGuid().ToString("N"))
$packageFiles = @(
  "package.json",
  "main.cjs",
  "preload.cjs",
  "effect-registry.js",
  "skin-registry.js",
  "agent-question.html",
  "agent-question.css",
  "agent-question.js",
  "outline-selection.html",
  "outline-selection.css",
  "outline-selection.js",
  "ai-chat.html",
  "ai-chat.css",
  "ai-chat.js",
  "ai-button.html",
  "ai-button.css",
  "ai-button.js",
  "bubble.html",
  "bubble.css",
  "bubble.js",
  "drag-preview.html",
  "drag-preview.css",
  "drag-preview.js",
  "drag-handle.html",
  "drag-handle.css",
  "drag-handle.js",
  "pet.html",
  "pet.css",
  "pet.js"
)
$packageDirectories = @(
  "assets",
  "config-ui"
)

try {
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

  # 发布包中的版本和下载地址以本次 Tag 为准，不修改仓库工作区。
  $manifestJson = $manifest | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText((Join-Path -Path $stageRoot -ChildPath "manifest.json"), $manifestJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

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

  foreach ($relativePath in $packageDirectories) {
    $sourceDirectory = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
      throw "Missing package directory: $relativePath"
    }

    $destinationDirectory = Join-Path $stageRoot $relativePath
    Copy-Item -LiteralPath $sourceDirectory -Destination $destinationDirectory -Recurse -Force
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
