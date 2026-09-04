param(
  [string]$OutputDirectory = "",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $projectRoot "simple/manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$manifest.version
}

if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
  throw "Version must use semantic version format X.Y.Z: $Version"
}

if ([string]::IsNullOrWhiteSpace([string]$manifest.repository)) {
  throw "simple/manifest.json is missing repository"
}

$repository = ([string]$manifest.repository).TrimEnd("/")
$manifest.version = $Version
$manifest.releaseUrl = "{0}/releases/download/v{1}/{2}-v{1}.zip" -f $repository, $Version, $manifest.id

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot "dist"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

# 包名与完整版一致：同一个 Tag 下只有一个规范资产名，manifest.releaseUrl 才不会指错。
$archiveName = "{0}-v{1}.zip" -f $manifest.id, $Version
$archivePath = Join-Path $OutputDirectory $archiveName
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("openbidkit-pet-simple-package-" + [Guid]::NewGuid().ToString("N"))

# 简化版文件平铺到包根目录，宿主仍按 package.json 的 main 加载 main.cjs。
$mappedFiles = [ordered]@{
  "simple/main.cjs"    = "main.cjs"
  "simple/preload.cjs" = "preload.cjs"
  "simple/pet.html"    = "pet.html"
  "simple/pet.css"     = "pet.css"
  "simple/pet.js"      = "pet.js"
  "simple/bubble.html" = "bubble.html"
  "simple/bubble.js"   = "bubble.js"
}

# 与完整版共用、无需改动的业务文件。
$sharedFiles = @(
  "package.json",
  "bubble.css",
  "agent-question.html",
  "agent-question.css",
  "agent-question.js",
  "outline-selection.html",
  "outline-selection.css",
  "outline-selection.js",
  "ai-chat.html",
  "ai-chat.css",
  "ai-chat.js"
)

# 简化版只用到 logo，精灵图与皮肤资源一律不打包。
$assetFiles = @(
  "assets/icon.png"
)

try {
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

  # 发布包中的版本和下载地址以本次 Tag 为准，不修改仓库工作区。
  $manifestJson = $manifest | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText((Join-Path -Path $stageRoot -ChildPath "manifest.json"), $manifestJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

  foreach ($sourceRelativePath in $mappedFiles.Keys) {
    $sourcePath = Join-Path $projectRoot $sourceRelativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Missing package file: $sourceRelativePath"
    }

    $destinationPath = Join-Path $stageRoot $mappedFiles[$sourceRelativePath]
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }

  foreach ($relativePath in ($sharedFiles + $assetFiles)) {
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
  Write-Host "Simple package created: $archivePath"
}
finally {
  $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedStageRoot = [System.IO.Path]::GetFullPath($stageRoot)
  if ($resolvedStageRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStageRoot)) {
    Remove-Item -LiteralPath $resolvedStageRoot -Recurse -Force
  }
}
