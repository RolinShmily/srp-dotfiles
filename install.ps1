# SrP-Dotfiles bootstrap: check Python 3.9+, fetch the repository, run scripts\main.py.
#
# Python is the only requirement:
#   winget install Python.Python.3.12
# winget comes from App Installer, which is absent on LTSC/Sandbox/Server:
#   https://apps.microsoft.com/detail/9NBLGGH4NNS1
# Without winget: python.org, `scoop install python`, or
#   powershell -c "irm https://astral.sh/uv/install.ps1 | iex"; uv python install 3.12
#
# Usage (PowerShell 5.1 blocks local scripts, so relax the policy for this process):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#   .\install.ps1 -y
#   irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 -OutFile install.ps1; .\install.ps1 -y
#
# Fetch order: git clone (SRP_REPO_URL, then GitHub via SRP_GH_PROXY, ghfast.top,
# gh-proxy.com, direct), then a zip (Worker /repo.zip, codeload).

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
$repoSlug = "RolinShmily/srp-dotfiles"
$repoRef = if ($env:SRP_REPO_REF) { $env:SRP_REPO_REF } else { "main" }
$installOrigin = if ($env:SRP_INSTALL_ORIGIN) { $env:SRP_INSTALL_ORIGIN } else { "https://dot.srprolin.com" }
$githubUrl = "https://github.com/$repoSlug.git"

$prefixes = @()
if ($env:SRP_GH_PROXY) { $prefixes += $env:SRP_GH_PROXY }
$prefixes += "https://ghfast.top/", "https://gh-proxy.com/", ""

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
