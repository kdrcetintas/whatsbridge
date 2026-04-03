$repo    = "kdrcetintas/whatsbridge"
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$version = $release.tag_name
$asset   = $release.assets | Where-Object { $_.name -like "*win-x64*" } | Select-Object -First 1

if (-not $asset) {
  Write-Error "No Windows binary found in release $version."
  exit 1
}

Write-Host "Downloading WhatsBridge $version..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile "whatsbridge.exe"
Write-Host "Done. Run .\whatsbridge.exe init to get started."
