<#
Start the plugin test environment, wait for health and seed it.

  .\up.ps1           Stalwart, Nextcloud, Paperless, Papra, Vikunja, mocks
  .\up.ps1 -WithAI   the same plus Ollama with a small model

Safe to run again: containers are reused and the seeds are idempotent.
#>
param([switch]$WithAI)
# Native tools write progress to stderr; with 'Stop' PowerShell 5.1 would
# treat that as an error once output is redirected. Exit codes are checked.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$python = (Get-Command python -ErrorAction SilentlyContinue)
if ($null -eq $python) { $python = Get-Command python3 }

if (-not (Test-Path 'stalwart/stalwart-cli')) {
    Write-Host 'Fetching stalwart-cli for the Stalwart image'
    # Needs bash (Git Bash). The script ends by running the Linux binary,
    # which fails on Windows; the file is all the build needs.
    & bash stalwart/prepare-stalwart-cli.sh
    if (-not (Test-Path 'stalwart/stalwart-cli')) { throw 'stalwart/stalwart-cli is missing' }
}

$composeArgs = @()
$seedArgs = @()
if ($WithAI) {
    $composeArgs = @('--profile', 'ai')
    $seedArgs = @('--with-ai')
}

& docker compose @composeArgs up -d --build --wait --wait-timeout 600
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }
& $python.Source seed/seed_all.py @seedArgs
if ($LASTEXITCODE -ne 0) { throw "seeding failed ($LASTEXITCODE)" }
