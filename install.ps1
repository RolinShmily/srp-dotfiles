# SrP-Dotfiles installer bootstrap.
# Checks for Python 3.9+ and hands over to scripts\main.py.
#
# Python is the only hard requirement:
#   winget install Python.Python.3.12
#
# Usage:
#   irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 | iex
#   .\install.ps1 -a -y

$ErrorActionPreference = "Stop"

function Find-Python {
    foreach ($name in @("python", "python3")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        & $cmd.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { return $cmd.Source }
    }
    return $null
}

$python = Find-Python
if (-not $python) {
    Write-Host "Python 3.9+ is required but was not found." -ForegroundColor Red
    Write-Host "Install it first: winget install Python.Python.3.12"
    throw "Python 3.9+ is required"
}

$repo = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not (Test-Path (Join-Path $repo "scripts\main.py"))) {
    $repo = if ($env:SRP_DOTFILES_DIR) { $env:SRP_DOTFILES_DIR } else { Join-Path $env:USERPROFILE ".srp-dotfiles" }
    if (-not (Test-Path (Join-Path $repo "scripts\main.py"))) {
        $repoUrl = if ($env:SRP_REPO_URL) { $env:SRP_REPO_URL } else { "https://github.com/RolinShmily/srp-dotfiles.git" }
        if (Get-Command git -ErrorAction SilentlyContinue) {
            git clone --depth=1 $repoUrl $repo
        } else {
            $zip = Join-Path $env:TEMP "srp-dotfiles.zip"
            $extract = Join-Path $env:TEMP "srp-dotfiles-extract"
            Invoke-WebRequest -Uri "https://codeload.github.com/RolinShmily/srp-dotfiles/zip/refs/heads/main" -OutFile $zip
            Expand-Archive -Path $zip -DestinationPath $extract -Force
            Move-Item (Join-Path $extract "srp-dotfiles-main") $repo
        }
    }
}

& $python (Join-Path $repo "scripts\main.py") @args
if ($LASTEXITCODE -ne 0) {
    throw "installer exited with code $LASTEXITCODE"
}
