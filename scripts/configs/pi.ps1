# scripts/configs/pi.ps1 — Pi Coding Agent 配置部署（Windows）。
#
# 部署策略: 全部 copy 覆盖，不做备份、不做比对。
#   pi\ 目录扇出到 ~\.pi\agent\ 下的四个位置，
#   pi\extensions 按 manifest.json 的 piExtensions 白名单过滤，
#   pi\settings.json.example 复制后再把 manifest 的 piPackages 注入 packages 字段。
#
# 注意: pi\packages\ 下的本地包**不部署**。manifest 的 piPackages 里写
#   @repo/pi/packages/<name>，由 pi-inject-packages.js 展开成仓库绝对路径，Pi 直接从仓库加载。
#
# 独立运行: .\scripts\configs\pi.ps1
# 入口调用: & <本脚本> -DotfilesDir <仓库根> -BackupDir <备份目录> -ManifestOs windows -Force:<bool>

[CmdletBinding()]
param (
    [string]$DotfilesDir,
    [string]$BackupDir,
    [string]$ManifestOs = "windows",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if ($DotfilesDir) { $Global:DF_DotfilesDir = $DotfilesDir }
if (-not $Global:DF_DotfilesDir) {
    $Global:DF_DotfilesDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
if ($BackupDir) { $Global:DF_BackupDir = $BackupDir }
if (-not $Global:DF_BackupDir) {
    $Global:DF_BackupDir = Join-Path $env:USERPROFILE ".dotfiles_backup\manual"
}
$Global:DF_Force = [bool]$Force
$Global:MANIFEST_OS = $ManifestOs

. (Join-Path $PSScriptRoot "..\lib\manifest.ps1")
. (Join-Path $PSScriptRoot "..\lib\deploy.ps1")

# 独立运行时补上日志函数（由入口调用时已存在，不会覆盖）
if (-not (Get-Command Write-LogInfo -ErrorAction SilentlyContinue)) {
    function Write-LogInfo    { param([string]$Msg) Write-Host "[INFO] $Msg" }
    function Write-LogWarn    { param([string]$Msg) Write-Host "[WARN] $Msg" }
    function Write-LogSuccess { param([string]$Msg) Write-Host "[OK]   $Msg" }
    function Write-LogError   { param([string]$Msg) Write-Host "[FAIL] $Msg" }
}

$piSrc  = Join-Path $Global:DF_DotfilesDir "pi"
$piDest = Join-Path $env:USERPROFILE ".pi\agent"
$injectJs = Join-Path $Global:DF_DotfilesDir "scripts\lib\pi-inject-packages.js"

if (-not (Test-Path -LiteralPath $piSrc)) {
    Write-LogWarn "仓库中不存在 pi 目录: $piSrc"
    exit 1
}

if (-not (Test-Path -LiteralPath $piDest)) {
    New-Item -ItemType Directory -Path $piDest -Force | Out-Null
}

# 目标里存在、仓库里没有的项：只提示不删除
function Show-PiOrphans {
    param([Parameter(Mandatory)][string]$SubDir)

    $srcDir  = Join-Path $piSrc $SubDir
    $destDir = Join-Path $piDest $SubDir
    if (-not (Test-Path -LiteralPath $destDir)) { return }

    $orphans = @(Get-ChildItem -LiteralPath $destDir -Force | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $srcDir $_.Name))
    } | ForEach-Object { $_.Name })

    if ($orphans.Count -gt 0) {
        Write-LogWarn "[$SubDir] 目标里存在仓库中已不存在的项（不会自动删除）: $($orphans -join ', ')"
    }
}

# 把 $piSrc\<子目录> 的每个子项覆盖复制到 $piDest\<子目录>\
function Copy-PiEachItem {
    param(
        [Parameter(Mandatory)][string]$SubDir,
        [string[]]$AllowedNames = @()
    )

    $srcDir  = Join-Path $piSrc $SubDir
    $destDir = Join-Path $piDest $SubDir
    if (-not (Test-Path -LiteralPath $srcDir)) { return }

    if (-not (Test-Path -LiteralPath $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $srcDir | ForEach-Object {
        if ($AllowedNames.Count -gt 0 -and ($AllowedNames -notcontains $_.Name)) { return }
        Deploy-CopyItem -Source $_.FullName -Target (Join-Path $destDir $_.Name) `
                        -Name "Pi $SubDir [$($_.Name)]" -BackupDir $Global:DF_BackupDir | Out-Null
    }
}

# 白名单语义: extensions 目录里不在白名单的项一律清理。
# skills / prompts / agents 无白名单，所以只警告孤儿，不删。
function Remove-PiNonAllowlisted {
    param([string[]]$AllowedNames = @())

    if ($AllowedNames.Count -eq 0) { return }

    $destDir = Join-Path $piDest "extensions"
    if (-not (Test-Path -LiteralPath $destDir)) { return }

    Get-ChildItem -LiteralPath $destDir -Force | ForEach-Object {
        if ($AllowedNames -notcontains $_.Name) {
            Write-LogWarn "[extensions] 不在白名单，已清理: $($_.Name)"
            Remove-TargetEntry -Target $_.FullName
        }
    }
}

# ---------- 1. 全局规范 ----------
$agentsMd = Join-Path $piSrc "AGENTS.md"
if (Test-Path -LiteralPath $agentsMd) {
    Deploy-CopyItem -Source $agentsMd -Target (Join-Path $piDest "AGENTS.md") `
                    -Name "Pi AGENTS.md" -BackupDir $Global:DF_BackupDir | Out-Null
}

# ---------- 2. settings.json: 直复制覆盖，再注入 manifest 的 packages ----------
$settingsExample = Join-Path $piSrc "settings.json.example"
if (Test-Path -LiteralPath $settingsExample) {
    $settingsTarget = Join-Path $piDest "settings.json"
    Deploy-CopyItem -Source $settingsExample -Target $settingsTarget `
                    -Name "Pi settings.json" -BackupDir $Global:DF_BackupDir | Out-Null

    $piPackages = @(Get-ManifestArray -Os $ManifestOs -Key "piPackages")
    if ($piPackages.Count -gt 0 -and (Test-Path -LiteralPath $injectJs)) {
        if (Get-Command node -ErrorAction SilentlyContinue) {
            & node $injectJs $settingsTarget @piPackages
        } else {
            Write-LogWarn "未检测到 node，跳过 packages 注入"
        }
    } else {
        Write-LogInfo "manifest 的 piPackages 为空，settings.json 的 packages 保持模板值"
    }
}

# ---------- 2b. mcp.json: 直复制覆盖（pi 内置 MCP 读取本路径）----------
# 注: ~/.pi/agent/mcp.json 也是 pi 自己会写的文件（/mcp 界面、pi mcp add/remove），
#     部署会覆盖那些改动；想保留就把改动搬回 pi\mcp.json.example。
$mcpExample = Join-Path $piSrc "mcp.json.example"
if (Test-Path -LiteralPath $mcpExample) {
    Deploy-CopyItem -Source $mcpExample -Target (Join-Path $piDest "mcp.json") `
                    -Name "Pi mcp.json" -BackupDir $Global:DF_BackupDir | Out-Null
}

# ---------- 2c. keybindings.json: 直复制覆盖 ----------
$keybindingsExample = Join-Path $piSrc "keybindings.json.example"
if (Test-Path -LiteralPath $keybindingsExample) {
    Deploy-CopyItem -Source $keybindingsExample -Target (Join-Path $piDest "keybindings.json") `
                    -Name "Pi keybindings.json" -BackupDir $Global:DF_BackupDir | Out-Null
}

# ---------- 3. extensions（按 manifest 白名单过滤） ----------
$allowedExt = @(Get-ManifestArray -Os $ManifestOs -Key "piExtensions")
Copy-PiEachItem -SubDir "extensions" -AllowedNames $allowedExt
Remove-PiNonAllowlisted -AllowedNames $allowedExt

# ---------- 4. skills / prompts / agents ----------
# agents 不检查孤儿: pi-learn 包会在每次会话通过 syncAgents() 往目标目录写入
# mermaid-maker.md / svg-maker.md，那些不是遗留副本，所以不提醒。
Copy-PiEachItem -SubDir "skills";  Show-PiOrphans -SubDir "skills"
Copy-PiEachItem -SubDir "prompts"; Show-PiOrphans -SubDir "prompts"
Copy-PiEachItem -SubDir "agents"

# ---------- 5. packages ----------
# 本地 Pi 包**不做复制**。manifest 的 piPackages 里写 @repo/pi/packages/<name>，
# 部署时由 pi-inject-packages.js 展开成仓库绝对路径，Pi 直接从仓库加载（local 源不复制）。
# ~\.pi\agent\packages\ 是历史自造约定，已废弃 —— 若存在旧副本请手动删除。

Write-LogSuccess "Pi 配置部署完成 (copy 覆盖): $piDest"
