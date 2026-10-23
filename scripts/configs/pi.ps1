# scripts/configs/pi.ps1 — Pi 配置初始化（Windows）。
#
# Pi 的本地 resources 直接指向仓库绝对路径，不复制、不软链接：
#   manifest.<os>.piResources -> pi-inject-resources.js -> settings.json
# 外部 skills 仍由安装阶段的 skillsAdd 负责安装到 ~/.pi/agent/skills。
#
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

$piSrc = Join-Path $Global:DF_DotfilesDir "pi"
$piDest = Join-Path $env:USERPROFILE ".pi\agent"
$injectJs = Join-Path $Global:DF_DotfilesDir "scripts\lib\pi-inject-resources.js"

if (-not (Test-Path -LiteralPath $piSrc)) {
    Write-LogWarn (Get-I18n 'pi.noSource' @($piSrc))
    exit 1
}

if (-not (Test-Path -LiteralPath $piDest)) {
    New-Item -ItemType Directory -Path $piDest -Force | Out-Null
}

# ---------- 1. 全局规范 ----------
$agentsMd = Join-Path $piSrc "AGENTS.md"
if (Test-Path -LiteralPath $agentsMd) {
    Deploy-CopyItem -Source $agentsMd -Target (Join-Path $piDest "AGENTS.md") `
                    -Name "Pi AGENTS.md" -BackupDir $Global:DF_BackupDir | Out-Null
}

# ---------- 2. settings.json：按 .example 规则部署并追加注入 piResources ----------
$settingsExample = Join-Path $piSrc "settings.json.example"
$settingsTarget = Join-Path $piDest "settings.json"
if (Test-Path -LiteralPath $settingsExample) {
    Deploy-CopyExampleItem -Source $settingsExample -Target $settingsTarget `
                           -Name "Pi settings.json" -BackupDir $Global:DF_BackupDir | Out-Null

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is required to inject Pi resources: $injectJs"
    }
    & node $injectJs $settingsTarget $ManifestOs
    if (Test-Path -LiteralPath "$settingsTarget.example") {
        & node $injectJs "$settingsTarget.example" $ManifestOs
    }
}

# ---------- 3. Pi 自己维护的 JSON 配置 ----------
# mcp.json / keybindings.json 已存在时保留，模板旁存为 .example。
$mcpExample = Join-Path $piSrc "mcp.json.example"
if (Test-Path -LiteralPath $mcpExample) {
    Deploy-CopyExampleItem -Source $mcpExample -Target (Join-Path $piDest "mcp.json") `
                           -Name "Pi mcp.json" -BackupDir $Global:DF_BackupDir | Out-Null
}

$keybindingsExample = Join-Path $piSrc "keybindings.json.example"
if (Test-Path -LiteralPath $keybindingsExample) {
    Deploy-CopyExampleItem -Source $keybindingsExample -Target (Join-Path $piDest "keybindings.json") `
                           -Name "Pi keybindings.json" -BackupDir $Global:DF_BackupDir | Out-Null
}

Write-LogSuccess (Get-I18n 'pi.done' @($piDest))
