param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing environment file at $Path"
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    if ($line -match '^(.*?)=(.*)$') {
      [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
    }
  }
}

function Get-VibeBaseUrl {
  switch ($env:VIBE_ENVIRONMENT) {
    "development" { return "https://webapp-cfc-vibes-dev-eastus.azurewebsites.net" }
    "production" { return "https://www.chathamvibes.com" }
    default { throw "Unsupported VIBE_ENVIRONMENT '$($env:VIBE_ENVIRONMENT)'" }
  }
}

$root = [System.IO.Directory]::GetParent($PSScriptRoot).FullName
$workspaceRoot = [System.IO.Directory]::GetParent($root).FullName
$envFile = Join-Path $workspaceRoot ".env"

Import-DotEnv -Path $envFile

if (-not $env:VIBE_API_KEY) {
  throw "VIBE_API_KEY is required"
}

if (-not $env:VIBE_APP_ID) {
  throw "VIBE_APP_ID is required"
}

$jsxPath = Join-Path $root "app.jsx"
if (-not (Test-Path -LiteralPath $jsxPath)) {
  throw "Missing app.jsx at $jsxPath"
}

$baseUrl = Get-VibeBaseUrl
$jsx = Get-Content -LiteralPath $jsxPath -Raw
$body = @{
  vibe_app = @{
    jsx_code = $jsx
    client_record_access = "read"
  }
} | ConvertTo-Json -Depth 8

$response = Invoke-RestMethod -Uri "$baseUrl/api/v1/vibe_apps/$($env:VIBE_APP_ID)" -Method Patch -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
  "Content-Type" = "application/json"
} -Body $body

$response | ConvertTo-Json -Depth 10
