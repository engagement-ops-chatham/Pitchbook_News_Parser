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

function Get-AuthHeaders {
  return @{
    Authorization = "Bearer $env:VIBE_API_KEY"
    "Content-Type" = "application/json"
  }
}

function Get-JobResponseCollection {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Response
  )

  if ($null -ne $Response.jobs) {
    return @($Response.jobs)
  }

  if ($null -ne $Response.vibe_jobs) {
    return @($Response.vibe_jobs)
  }

  return @()
}

function Convert-JobDefinitionToJson {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Definition
  )

  return (@{ job = $Definition } | ConvertTo-Json -Depth 10)
}

function Upsert-Job {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$AppId,
    [Parameter(Mandatory = $true)]
    [hashtable]$Definition,
    [Parameter(Mandatory = $true)]
    [object[]]$ExistingJobs
  )

  $existing = $ExistingJobs | Where-Object { $_.name -eq $Definition.name } | Select-Object -First 1
  $body = Convert-JobDefinitionToJson -Definition $Definition
  $headers = Get-AuthHeaders

  if ($null -ne $existing) {
    $jobId = if ($null -ne $existing.id) { $existing.id } elseif ($null -ne $existing.job_id) { $existing.job_id } else { $null }
    if (-not $jobId) {
      throw "Existing job '$($Definition.name)' is missing an id"
    }

    $response = Invoke-RestMethod -Uri "$BaseUrl/api/v1/vibe_apps/$AppId/jobs/$jobId" -Method Patch -Headers $headers -Body $body
    return @{
      operation = "updated"
      name = $Definition.name
      response = $response
    }
  }

  $response = Invoke-RestMethod -Uri "$BaseUrl/api/v1/vibe_apps/$AppId/jobs" -Method Post -Headers $headers -Body $body
  return @{
    operation = "created"
    name = $Definition.name
    response = $response
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

$jobPath = Join-Path $root "jobs\seed_fixture_ingest.js"
if (-not (Test-Path -LiteralPath $jobPath)) {
  throw "Missing job script at $jobPath"
}
$analysisJobPath = Join-Path $root "jobs\process_alert_items.js"
if (-not (Test-Path -LiteralPath $analysisJobPath)) {
  throw "Missing job script at $analysisJobPath"
}

$baseUrl = Get-VibeBaseUrl
$seedScript = Get-Content -LiteralPath $jobPath -Raw
$analysisScript = Get-Content -LiteralPath $analysisJobPath -Raw
$jobDefinitions = @(
  @{
    name = "seed_fixture_ingest"
    job_type = "sync"
    script = $seedScript
    description = "Trusted sync job for fixture seeding and queue reads"
    enabled = $true
    invokable_from_client = $true
    concurrency_policy = "reject_overlapping"
  },
  @{
    name = "process_alert_items"
    job_type = "async"
    script = $analysisScript
    description = "Classifies trigger relevance and corroborates sources"
    enabled = $true
    invokable_from_client = $false
    concurrency_policy = "reject_overlapping"
  }
)

$existingJobResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/vibe_apps/$($env:VIBE_APP_ID)/jobs" -Method Get -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
}
$existingJobs = Get-JobResponseCollection -Response $existingJobResponse

$results = foreach ($definition in $jobDefinitions) {
  Upsert-Job -BaseUrl $baseUrl -AppId $env:VIBE_APP_ID -Definition $definition -ExistingJobs $existingJobs
}

$results | ConvertTo-Json -Depth 10
