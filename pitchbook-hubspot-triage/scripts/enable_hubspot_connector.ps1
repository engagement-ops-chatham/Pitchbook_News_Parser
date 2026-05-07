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

$baseUrl = Get-VibeBaseUrl
$body = @{
  connector_identifier = "customer_relationship_management_hubspot"
} | ConvertTo-Json -Depth 8

try {
  $response = Invoke-RestMethod -Uri "$baseUrl/api/v1/vibe_apps/$($env:VIBE_APP_ID)/data_connector_enablements" -Method Post -Headers @{
    Authorization = "Bearer $env:VIBE_API_KEY"
    "Content-Type" = "application/json"
  } -Body $body

  $response | ConvertTo-Json -Depth 10
} catch {
  $statusCode = if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    [int]$_.Exception.Response.StatusCode
  } else {
    0
  }

  if ($statusCode -eq 422) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $bodyText = $reader.ReadToEnd()
    @{
      status = 422
      outcome = "admin_enablement_required"
      response = $bodyText
    } | ConvertTo-Json -Depth 8
    return
  }

  throw
}
