# ==============================================================================
# SrP-Dotfiles bootstrap for Windows (PowerShell 5.1 and PowerShell 7).
#
# This script is the entry point. It checks for Python 3.9+, fetches the
# repository when it is not already present, and hands over to
# scripts\main.py, which installs packages and deploys configs from
# manifest\*.json.
#
# The script:
#
# - Requires Python 3.9 or newer.
# - Prefers a local checkout, then SRP_DOTFILES_DIR, then
#   %USERPROFILE%\.srp-dotfiles.
# - Refreshes the auto-managed checkout on every run, so a cached copy cannot
#   pin an obsolete installer.
# - Uses only the bootstrap mirrors below until the repository is available;
#   manifest\mirror.json takes over afterwards.
# ==============================================================================
#
# Requirements
# ==============================================================================
#
# - Python 3.9 or newer. If it is missing, the script prints the available
#   install paths:
#
#     winget install Python.Python.3.12
#
#   winget comes from App Installer, which is absent on LTSC, Sandbox and
#   Server:
#
#     https://apps.microsoft.com/detail/9NBLGGH4NNS1
#
#   Without winget, use python.org, Scoop, or uv:
#
#     https://www.python.org/downloads/windows/
#     irm get.scoop.sh | iex ; scoop install python
#     powershell -c "irm https://astral.sh/uv/install.ps1 | iex" ; uv python install 3.12
#
# - Network access to GitHub, the Worker origin, or one of the mirrors.
#
# Usage
# ==============================================================================
#
# PowerShell 5.1 blocks local scripts by default, so relax the policy for the
# current process first:
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#
# Run directly (the script fetches the repository when needed):
#
#   irm https://dot.srprolin.com/install.ps1 -OutFile install.ps1; .\install.ps1 -y
#
# From a local checkout:
#
#   .\install.ps1                  # confirm each step, install and deploy
#   .\install.ps1 -y               # same, without prompts
#   .\install.ps1 -c               # deploy configs only
#   .\install.ps1 --os windows     # force the target profile
#   .\install.ps1 --dry-run -y     # print the plan only
#
# Command-line options
# ==============================================================================
#
# List values are comma-separated. Quote them to keep a single argument
# ("--apps a,b"); the CLI also accepts space-separated values.
#
# -c, --config
# Deploy configs only; skip package installation.
#
# -y, --yes
# Answer yes to every step. Required when stdin is not a TTY.
#
# --os <name>
# Force arch, debian, fedora, termux or windows instead of detecting it.
#
# --apps <ids>
# Comma-separated app IDs; "none" selects nothing.
#
# --configs <names>
# Comma-separated config names; "none" selects nothing.
#
# --mirror <profile>
# Select a profile from manifest\mirror.json.
#
# --mirror-<name> <value>
# Override github, npm, pypi, go or scoop; "none" clears the field.
#
# --proxy <url>
# Proxy for downloads. "host:port" is probed for its scheme; "none" clears it.
#
# --catalog
# Print the apps/configs/mirrors catalog as JSON and exit.
#
# --dry-run
# Print the plan without changing the system.
#
# Environment
# ==============================================================================
#
# SRP_REPO_URL        Git repository URL (default: GitHub)
# SRP_GH_PROXY        GitHub proxy prefix tried before the built-in list
# SRP_REPO_TARBALL    Repository archive URL
# SRP_REPO_REF        Branch or tag to fetch (default: main)
# SRP_DOTFILES_DIR    Checkout directory (default: %USERPROFILE%\.srp-dotfiles)
# SRP_INSTALL_ORIGIN  Worker base URL (default: https://dot.srprolin.com)
#
# Bootstrap order
# ==============================================================================
#
# This script cannot read manifest\mirror.json yet: it lives inside the
# repository being fetched. It tries, in order:
#
#   1. git clone from SRP_REPO_URL, otherwise GitHub via SRP_GH_PROXY, the
#      built-in mirrors, then direct.
#   2. When git is unavailable or every clone fails: a zip from
#      <origin>/repo.zip, then SRP_REPO_TARBALL, then codeload.
#   3. If everything fails, the script stops with the exact commands to retry.
#
# Worker routes
# ==============================================================================
#
# /                     OS-detected script (Windows: install.ps1)
# /install.sh           Unix bootstrap
# /install.ps1          this script (?os=windows / ?os=unix forces the target)
# /config               checkbox configurator that generates a command
# /api/catalog          apps/configs/mirrors catalog
# /repo.tar.gz          repository tarball (bootstrap fallback)
# /repo.zip             repository zip (bootstrap fallback)
# /health               health probe
#
# ==============================================================================

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
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Install it first: winget install Python.Python.3.12"
    } else {
        Write-Host "winget is not available on this machine."
        Write-Host "  App Installer (provides winget): https://apps.microsoft.com/detail/9NBLGGH4NNS1"
        Write-Host "  Or without winget:"
        Write-Host "    https://www.python.org/downloads/windows/"
        Write-Host "    irm get.scoop.sh | iex ; scoop install python"
        Write-Host '    powershell -c "irm https://astral.sh/uv/install.ps1 | iex" ; uv python install 3.12'
    }
    throw "Python 3.9+ is required"
}

$repo = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (Test-Path (Join-Path $repo "scripts\main.py")) {
    $repoMode = "local"
} elseif ($env:SRP_DOTFILES_DIR) {
    $repo = $env:SRP_DOTFILES_DIR
    $repoMode = "explicit"
} else {
    $repo = Join-Path $env:USERPROFILE ".srp-dotfiles"
    $repoMode = "auto"
}

# Mirrors live inside the repository, so fetching it cannot use them yet.
$repoSlug = "RolinShmily/dotfiles"
$repoRef = if ($env:SRP_REPO_REF) { $env:SRP_REPO_REF } else { "main" }
$installOrigin = if ($env:SRP_INSTALL_ORIGIN) { $env:SRP_INSTALL_ORIGIN } else { "https://dot.srprolin.com" }
$githubUrl = "https://github.com/$repoSlug.git"

$prefixes = @()
if ($env:SRP_GH_PROXY) { $prefixes += $env:SRP_GH_PROXY }
# Mirrors reachable before any configuration exists; keep this in sync with the
# cn profile in manifest/mirror.json.
$prefixes += "https://gh-proxy.com/", "https://gh-proxy.org/", "https://proxy.269601.xyz/", ""

# A dead mirror answers a probe in seconds but makes git stall for minutes.
function Test-Prefix {
    param([string]$Prefix)
    if (-not $Prefix) { return $true }
    try {
        Invoke-WebRequest -Uri "${Prefix}https://github.com/$repoSlug" -Method Head -TimeoutSec 8 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-Revision {
    if (Test-Path (Join-Path $repo ".git")) {
        return (git -C $repo rev-parse --short HEAD 2>$null)
    }
    return $null
}

function Update-Repo {
    param([string]$Target)
    if ((-not $env:SRP_REPO_URL) -and (Test-Path (Join-Path $Target ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        # Fetch by URL: a cached clone may still point at a mirror that died.
        $urls = @($githubUrl) + ($prefixes | Where-Object { $_ } | ForEach-Object { "$_$githubUrl" })
        foreach ($url in $urls) {
            git -C $Target fetch --quiet --depth=1 $url $repoRef 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) { continue }
            git -C $Target reset --quiet --hard FETCH_HEAD 2>$null | Out-Null
            git -C $Target remote set-url origin $githubUrl 2>$null | Out-Null
            return $true
        }
        return $false
    }
    return (Get-Repo -Target $Target)
}

function Get-Repo {
    param([string]$Target)

    if (Get-Command git -ErrorAction SilentlyContinue) {
        $cloneUrls = if ($env:SRP_REPO_URL) { @($env:SRP_REPO_URL) } else { $prefixes | ForEach-Object { "$_$githubUrl" } }
        foreach ($url in $cloneUrls) {
            if (-not $env:SRP_REPO_URL) {
                $prefix = $url.Substring(0, $url.Length - $githubUrl.Length)
                if (-not (Test-Prefix $prefix)) { continue }
            }
            Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue
            git clone --depth=1 $url $Target 2>$null | Out-Null
            if (Test-Path (Join-Path $Target "scripts\main.py")) {
                Write-Host "Repository: $url"
                return $true
            }
        }
    }

    $zipUrls = @("$installOrigin/repo.zip")
    if ($env:SRP_REPO_TARBALL) { $zipUrls += $env:SRP_REPO_TARBALL }
    $zipUrls += "https://codeload.github.com/$repoSlug/zip/refs/heads/$repoRef"
    foreach ($prefix in $prefixes) {
        if ($prefix) {
            $zipUrls += $prefix + "https://codeload.github.com/$repoSlug/zip/refs/heads/$repoRef"
        }
    }

    $zip = Join-Path $env:TEMP "dotfiles.zip"
    $extract = Join-Path $env:TEMP "dotfiles-extract"
    foreach ($url in $zipUrls) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $zip -ErrorAction Stop
            Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
            Expand-Archive -Path $zip -DestinationPath $extract -Force
            Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue
            Move-Item (Join-Path $extract "dotfiles-$repoRef") $Target -Force
            if (Test-Path (Join-Path $Target "scripts\main.py")) {
                Write-Host "Repository: $url"
                return $true
            }
        } catch { }
    }
    return $false
}

if (-not (Test-Path (Join-Path $repo "scripts\main.py"))) {
    if (-not (Get-Repo -Target $repo)) {
        Write-Host "Could not fetch $repoSlug." -ForegroundColor Red
        Write-Host "Try one of:"
        Write-Host "  `$env:SRP_REPO_URL = '<git mirror url>'; .\install.ps1 -y"
        Write-Host "  `$env:SRP_GH_PROXY = 'https://gh-proxy.com/'; .\install.ps1 -y"
        Write-Host "  git clone $githubUrl $repo"
        throw "Could not fetch $repoSlug"
    }
} elseif ($repoMode -eq "auto") {
    if (-not (Update-Repo -Target $repo)) {
        $cached = Get-Revision
        $note = if ($cached) { " at $cached" } else { "" }
        Write-Host "Warning: could not refresh $repo, using the cached copy$note" -ForegroundColor Yellow
    }
}

if ($repoMode -ne "local") {
    $revision = Get-Revision
    if ($revision) { Write-Host "Revision: $revision" }
}

& $python (Join-Path $repo "scripts\main.py") @args
if ($LASTEXITCODE -ne 0) {
    throw "installer exited with code $LASTEXITCODE"
}
