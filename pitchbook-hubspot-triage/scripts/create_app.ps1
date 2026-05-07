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

function Set-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $lines = if (Test-Path -LiteralPath $Path) {
    Get-Content -LiteralPath $Path
  } else {
    @()
  }

  $pattern = "^{0}=" -f [regex]::Escape($Name)
  $updated = $false
  $newLines = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $updated = $true
      "{0}={1}" -f $Name, $Value
    } else {
      $line
    }
  }

  if (-not $updated) {
    $newLines += "{0}={1}" -f $Name, $Value
  }

  Set-Content -LiteralPath $Path -Value $newLines
  [System.Environment]::SetEnvironmentVariable($Name, $Value)
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

$jsxPath = Join-Path $root "app.jsx"
if (-not (Test-Path -LiteralPath $jsxPath)) {
  throw "Missing app.jsx at $jsxPath"
}

$baseUrl = Get-VibeBaseUrl
$jsx = Get-Content -LiteralPath $jsxPath -Raw
$body = @{
  vibe_app = @{
    name = "PitchBook HubSpot Triage"
    jsx_code = $jsx
    semantic_version = "1.0.0"
    client_record_access = "read"
  }
} | ConvertTo-Json -Depth 8

$response = Invoke-RestMethod -Uri "$baseUrl/api/v1/vibe_apps" -Method Post -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
  "Content-Type" = "application/json"
} -Body $body

if ($response.vibe_app -and $response.vibe_app.id) {
  Set-DotEnvValue -Path $envFile -Name "VIBE_APP_ID" -Value ([string]$response.vibe_app.id)
}

$response | ConvertTo-Json -Depth 10
