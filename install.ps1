# SrP-Dotfiles installer bootstrap.
# Checks for Python 3.9+ and hands over to scripts\main.py.
#
# Python is the only hard requirement:
#   winget install Python.Python.3.12
#
# winget ships with App Installer, which is missing on LTSC images, Windows
# Sandbox and Server. Install it from the Microsoft Store:
#   https://apps.microsoft.com/detail/9NBLGGH4NNS1
# Without the Store (LTSC/Server), download App Installer and its dependencies:
#   https://github.com/microsoft/winget-cli/releases
# winget-free alternatives for Python:
#   https://www.python.org/downloads/windows/
#   irm get.scoop.sh | iex ; scoop install python
#   powershell -c "irm https://astral.sh/uv/install.ps1 | iex" ; uv python install 3.12
#
# Usage:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; .\install.ps1 -y
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
#   irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 -OutFile install.ps1;
#   .\install.ps1 -y
#
# Note: Windows PowerShell 5.1 defaults to the Restricted policy, which blocks
# local .ps1 files ("running scripts is disabled on this system"). Setting the
# policy for the current process is enough; no admin rights are required.
# The install step also sets RemoteSigned for the current user.

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
if (-not (Test-Path (Join-Path $repo "scripts\main.py"))) {
    $repo = if ($env:SRP_DOTFILES_DIR) { $env:SRP_DOTFILES_DIR } else { Join-Path $env:USERPROFILE ".srp-dotfiles" }
}

# The mirror settings live inside the repository, so fetching it cannot rely
# on them. Try git through known proxies first, then a tarball (Worker, then
# GitHub directly).
$repoSlug = "RolinShmily/srp-dotfiles"
$repoRef = if ($env:SRP_REPO_REF) { $env:SRP_REPO_REF } else { "main" }
$installOrigin = if ($env:SRP_INSTALL_ORIGIN) { $env:SRP_INSTALL_ORIGIN } else { "https://dot.srprolin.com" }
$githubUrl = "https://github.com/$repoSlug.git"

$prefixes = @()
if ($env:SRP_GH_PROXY) { $prefixes += $env:SRP_GH_PROXY }
$prefixes += "https://ghfast.top/", "https://gh-proxy.com/", ""

function Get-Repo {
    param([string]$Target)

    if (Get-Command git -ErrorAction SilentlyContinue) {
        $cloneUrls = if ($env:SRP_REPO_URL) { @($env:SRP_REPO_URL) } else { $prefixes | ForEach-Object { "$_$githubUrl" } }
        foreach ($url in $cloneUrls) {
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

    $zip = Join-Path $env:TEMP "srp-dotfiles.zip"
    $extract = Join-Path $env:TEMP "srp-dotfiles-extract"
    foreach ($url in $zipUrls) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $zip -ErrorAction Stop
            Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
            Expand-Archive -Path $zip -DestinationPath $extract -Force
            Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue
            Move-Item (Join-Path $extract "srp-dotfiles-$repoRef") $Target -Force
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
        Write-Host "  `$env:SRP_GH_PROXY = 'https://ghfast.top/'; .\install.ps1 -y"
        Write-Host "  git clone $githubUrl $repo"
        throw "Could not fetch $repoSlug"
    }
}

& $python (Join-Path $repo "scripts\main.py") @args
if ($LASTEXITCODE -ne 0) {
    throw "installer exited with code $LASTEXITCODE"
}
