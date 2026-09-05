<#
.SYNOPSIS
    SrP-Dotfiles - Windows 统一环境一键管理总控引擎 (基于 manifest.toml 声明式驱动)

.DESCRIPTION
    高度对标 Unix 体系 (launch.sh) 的 Windows 自动化管理脚本。
    严格贯彻【Install (软件安装)】与【Config (配置软链部署)】职责解耦设计：
    
    1. 交互式启动菜单 (launch 入口)
    2. 软件与环境安装模块 (install):
       - PowerShell 远程签名策略 (前置环境准入)
       - Winget 系统核心套件安装 (从 manifest.toml.windows.winget_packages 读取)
       - Scoop 环境安装与镜像源配置 (从 manifest.toml.windows.scoop_buckets 读取)
       - Aria2 多线程下载加速配置 (包管理器性能优化)
       - Scoop 扩展软件与字体安装 (从 manifest.toml.windows.scoop_packages 读取)
       - 现代 Python 运行时安装 (从 manifest.toml.windows.python_manager 读取)
    3. 符号链接配置部署模块 (config):
       - Windows 用户级环境变量配置 (SHELL -> pwsh.exe，保障 Zellij 等多端识别)
       - 自动根据 manifest.toml.windows.configs 分发软链接与安全备份：
         * WezTerm 工业级配置与专属背景图 (%USERPROFILE%\.config\wezterm\)
         * PowerShell 7 全局 Profile ($PROFILE)
         * 通用应用配置目录 (%USERPROFILE%\.config\<app> 如 fastfetch, zellij)
       - 权限自动降级 (无开发者模式时优雅回退为安全拷贝)

.EXAMPLE
    .\start.ps1                  # 启动交互式控制台菜单 (默认)
    .\start.ps1 all              # 自动非交互执行全部 (依赖安装 + 符号链接部署)
    .\start.ps1 install          # 仅执行系统环境与依赖安装 (不触碰任何配置文件)
    .\start.ps1 config           # 仅部署与同步 Dotfiles 配置文件 (不安装任何软件)
    .\start.ps1 config -Force    # 强制覆盖部署当前配置
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet('all', 'install', 'config', 'launch', 'help', '')]
    [string]$Action = '',

    [switch]$Force
)

# 确保控制台输出使用 UTF-8 编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 基础目录与常量定义
$DotfilesDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ManifestFile = Join-Path $DotfilesDir "manifest.toml"
$UserHome = $env:USERPROFILE

# 日志输出助手 (格式对标 Unix bash)
function Write-LogInfo { param([string]$Msg) Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $Msg }
function Write-LogSuccess { param([string]$Msg) Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Write-LogWarn { param([string]$Msg) Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-LogError { param([string]$Msg) Write-Host "[FAIL] " -ForegroundColor Red -NoNewline; Write-Host $Msg }

# -------------------------------------------------------------------------
# 0. 全局执行账本与受控步骤执行器 (Step Runner)
# -------------------------------------------------------------------------
$script:ReportSuccess = [System.Collections.Generic.List[string]]::new()
$script:ReportSkipped = [System.Collections.Generic.List[string]]::new()
$script:ReportFailed  = [System.Collections.Generic.List[string]]::new()

function Invoke-Step {
    param (
        [string]$Name,
        [scriptblock]$ScriptBlock
    )

    while ($true) {
        Write-LogInfo "正在执行: $Name ..."
        $stepFailed = $false
        $errorDetails = ""

        try {
            $global:LASTEXITCODE = 0
            & $ScriptBlock

            # 检查是否有非零外部命令退出码
            if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0 -and $global:LASTEXITCODE -ne -1978335189) {
                # 注意: -1978335189 为 winget 提示软件包已安装且已是最新版的正常返回码
                $stepFailed = $true
                $errorDetails = "命令返回非零退出码: $global:LASTEXITCODE"
            }
        } catch {
            $stepFailed = $true
            $errorDetails = $_.Exception.Message
        }

        if (-not $stepFailed) {
            $script:ReportSuccess.Add($Name)
            return $true
        }

        # 报错拦截处理
        Write-LogError "步骤 [$Name] 执行失败！($errorDetails)"

        Write-Host "----------------------------------------------------" -ForegroundColor Yellow
        Write-Host " 遇到执行异常，请选择后续处理方式："
        Write-Host "   [S] 跳过此步并继续 (Skip) " -NoNewline; Write-Host "[推荐/默认]" -ForegroundColor Green
        Write-Host "   [R] 重试此步骤 (Retry)"
        Write-Host "   [A] 终止并退出 (Abort)"
        Write-Host "----------------------------------------------------" -ForegroundColor Yellow

        $choice = Read-Host " 请选择 [s/r/a, 默认 s]"
        if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "s" }

        switch ($choice.ToLower().Trim()) {
            "s" {
                Write-LogWarn "已手动跳过步骤: $Name"
                $script:ReportSkipped.Add("$Name (手动跳过: $errorDetails)")
                return $false
            }
            "r" {
                Write-LogInfo "正在重试步骤: $Name ..."
                continue
            }
            "a" {
                Write-LogError "用户主动终止安装部署流程。"
                $script:ReportFailed.Add("$Name (用户中止: $errorDetails)")
                Show-Summary-Report
                exit 1
            }
            default {
                Write-LogWarn "输入无法识别，默认跳过此步骤。"
                $script:ReportSkipped.Add("$Name (手动跳过: $errorDetails)")
                return $false
            }
        }
    }
}

function Show-Summary-Report {
    Write-Host "`n================================================================" -ForegroundColor Cyan
    Write-Host "              📊 SrP-Dotfiles 安装与部署审计报告               " -ForegroundColor White -BackgroundColor DarkBlue
    Write-Host "================================================================" -ForegroundColor Cyan

    $totalSuccess = $script:ReportSuccess.Count
    $totalSkipped = $script:ReportSkipped.Count
    $totalFailed  = $script:ReportFailed.Count

    Write-Host " 🎯 目标操作系统: Windows $([Environment]::OSVersion.Version.Major) ($([Environment]::OSVersion.VersionString))" -ForegroundColor Green
    Write-Host " 👤 当前用户目录: $UserHome" -ForegroundColor Yellow
    Write-Host " ⏱️ 报告生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan

    # 1. 成功项
    if ($totalSuccess -gt 0) {
        Write-Host "✔ 成功完成 ($totalSuccess 项):" -ForegroundColor Green
        foreach ($item in $script:ReportSuccess) {
            Write-Host "  [OK] $item" -ForegroundColor Green
        }
    } else {
        Write-Host "ℹ 没有成功完成的项目。" -ForegroundColor Yellow
    }

    # 2. 跳过项
    if ($totalSkipped -gt 0) {
        Write-Host "`n⚠ 跳过/忽略项目 ($totalSkipped 项):" -ForegroundColor Yellow
        foreach ($item in $script:ReportSkipped) {
            Write-Host "  [SKIP] $item" -ForegroundColor Yellow
        }
    }

    # 3. 失败项
    if ($totalFailed -gt 0) {
        Write-Host "`n✖ 失败/中止项目 ($totalFailed 项):" -ForegroundColor Red
        foreach ($item in $script:ReportFailed) {
            Write-Host "  [FAIL] $item" -ForegroundColor Red
        }
    }

    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
    if ($totalSkipped -gt 0 -or $totalFailed -gt 0) {
        Write-Host " 💡 提示: 针对跳过或未完成的项目，您可以在排查网络/依赖后单独重试：" -ForegroundColor Yellow
        Write-Host "    - 仅重新安装依赖: .\start.ps1 install" -ForegroundColor Cyan
        Write-Host "    - 仅重新部署配置: .\start.ps1 config" -ForegroundColor Cyan
    } else {
        Write-Host " 🎉 恭喜！所有安装与部署项目均完美就绪！" -ForegroundColor Green
    }
    Write-Host "================================================================" -ForegroundColor Cyan
}

# -------------------------------------------------------------------------
# 1. 零依赖原生 TOML 解析器 (纯正则表达式实现)
# -------------------------------------------------------------------------

function Get-TomlArray {
    param (
        [string]$FilePath,
        [string]$Section,
        [string]$Key
    )
    if (-not (Test-Path $FilePath)) {
        Write-LogError "未找到清单文件: $FilePath"
        return @()
    }
    $content = Get-Content $FilePath -Raw -Encoding UTF8
    $pattern = "(?ms)^\s*\[$Section\]\s*.*?(?:^\s*$Key\s*=\s*\[(.*?)\])"
    if ($content -match $pattern) {
        $rawArray = $matches[1]
        $matchesList = [regex]::Matches($rawArray, '"([^"]+)"')
        $results = @($matchesList | ForEach-Object { $_.Groups[1].Value })
        return $results
    }
    return @()
}

function Get-TomlString {
    param (
        [string]$FilePath,
        [string]$Section,
        [string]$Key
    )
    if (-not (Test-Path $FilePath)) { return "" }
    $content = Get-Content $FilePath -Raw -Encoding UTF8
    $pattern = "(?ms)^\s*\[$Section\]\s*.*?(?:^\s*$Key\s*=\s*""([^""]+)"")"
    if ($content -match $pattern) {
        return $matches[1]
    }
    return ""
}

# -------------------------------------------------------------------------
# 模块一：环境与软件包检测安装 (Install - 仅负责软件安装)
# -------------------------------------------------------------------------

function Set-Pwsh-ExecutionPolicy {
    Invoke-Step -Name "配置 PowerShell 远程签名执行策略 (RemoteSigned)" -ScriptBlock {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop
        Write-LogSuccess "PowerShell 执行策略已设置为 RemoteSigned。"
    }
}

function Install-Winget-Packages {
    Write-Host "`n--- [阶段 1/4] 安装核心系统与终端套件 (Winget) ---" -ForegroundColor Cyan
    if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
        Write-LogError "未检测到 winget 命令，请确保系统已安装应用安装程序 (App Installer)。"
        return
    }

    $packages = Get-TomlArray -FilePath $ManifestFile -Section "windows" -Key "winget_packages"
    if ($packages.Count -eq 0) {
        Write-LogWarn "manifest.toml 中未定义 winget_packages，跳过本阶段。"
        return
    }

    foreach ($pkgId in $packages) {
        Invoke-Step -Name "Winget 软件包 [$pkgId]" -ScriptBlock {
            $installArgs = @("install", "--id", $pkgId, "--source", "winget", "--accept-source-agreements", "--accept-package-agreements")
            if ($pkgId -eq "Git.Git") { $installArgs += "-e" }
            & winget @installArgs
        }
    }
}

function Install-And-Configure-Scoop {
    Write-Host "`n--- [阶段 2/4] 配置 Scoop 环境与镜像源加速 ---" -ForegroundColor Cyan

    # 1. 检测并安装 Scoop
    Invoke-Step -Name "Scoop 包管理器安装与环境就绪" -ScriptBlock {
        if (-not (Get-Command "scoop" -ErrorAction SilentlyContinue)) {
            Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
        }
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        if (-not (Get-Command "scoop" -ErrorAction SilentlyContinue)) {
            throw "Scoop 命令未能加入当前环境 PATH"
        }
    }

    # 2. 从 manifest.toml 读取并配置 Buckets
    $bucketEntries = Get-TomlArray -FilePath $ManifestFile -Section "windows" -Key "scoop_buckets"
    $installedBuckets = scoop bucket list 2>$null

    foreach ($entry in $bucketEntries) {
        if ($entry -match '^\s*([^\s=]+)\s*=\s*(.+)$') {
            $bName = $matches[1].Trim()
            $bUrl = $matches[2].Trim()

            Invoke-Step -Name "Scoop 镜像源 Bucket [$bName]" -ScriptBlock {
                if ($bName -eq "main") {
                    if ($installedBuckets -match "\bmain\b") {
                        scoop bucket rm main | Out-Null
                    }
                    scoop bucket add main $bUrl
                } else {
                    if ($installedBuckets -notmatch "\b$bName\b") {
                        scoop bucket add $bName $bUrl
                    }
                }
            }
        }
    }

    # 3. 如果包含 aria2，则配置多线程下载优化 (包管理器基础能力加速)
    $scoopPkgs = Get-TomlArray -FilePath $ManifestFile -Section "windows" -Key "scoop_packages"
    if ($scoopPkgs -contains "aria2") {
        Invoke-Step -Name "Aria2 多线程下载优化配置" -ScriptBlock {
            scoop install aria2
            scoop config aria2-enabled true
            scoop config aria2-retry-wait 2
            scoop config aria2-split 5
            scoop config aria2-max-connection-per-server 5
            scoop config aria2-min-split-size 4M
        }
    }
}

function Install-Scoop-Packages {
    Write-Host "`n--- [阶段 3/4] 安装 Scoop 扩展软件包与字体 ---" -ForegroundColor Cyan

    $packages = Get-TomlArray -FilePath $ManifestFile -Section "windows" -Key "scoop_packages"
    foreach ($pkg in $packages) {
        if ($pkg -eq "aria2") { continue }
        Invoke-Step -Name "Scoop 扩展软件/字体 [$pkg]" -ScriptBlock {
            scoop install $pkg
        }
    }
}

function Install-Python-Runtime {
    Write-Host "`n--- [阶段 4/4] 安装现代 Python 环境与管理器 ---" -ForegroundColor Cyan

    $pyManager = Get-TomlString -FilePath $ManifestFile -Section "windows" -Key "python_manager"
    if ($pyManager -eq "uv") {
        Invoke-Step -Name "Astral uv 现代 Python 包管理器" -ScriptBlock {
            if (-not (Get-Command "uv" -ErrorAction SilentlyContinue)) {
                irm https://astral.sh/uv/install.ps1 | iex
            }
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            if (-not (Get-Command "uv" -ErrorAction SilentlyContinue)) {
                throw "uv 命令未找到"
            }
        }

        Invoke-Step -Name "官方最新 Python 运行时 (通过 uv)" -ScriptBlock {
            uv python install
        }
    }
}

function Run-Install {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "   📦 执行 Windows 依赖软件包全量安装 (manifest.toml)     " -ForegroundColor White -BackgroundColor DarkBlue
    Write-Host "==========================================================" -ForegroundColor Cyan

    Set-Pwsh-ExecutionPolicy
    Install-Winget-Packages
    Install-And-Configure-Scoop
    Install-Scoop-Packages
    Install-Python-Runtime

    Write-Host ""
    Write-LogSuccess "Windows 软件包安装流水线全部完成！(未更改任何配置文件)"
}

# -------------------------------------------------------------------------
# 模块二：符号链接配置部署与安全备份 (Config - 仅负责配置与软链)
# -------------------------------------------------------------------------

function Deploy-Link-Item {
    param (
        [string]$Source,
        [string]$Target,
        [string]$Name,
        [string]$BackupDir
    )

    if (-not (Test-Path $Source)) {
        Write-LogError "未在仓库中找到源配置: $Source"
        throw "源文件不存在: $Source"
    }

    $parentDir = Split-Path -Parent $Target
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    if (Test-Path $Target) {
        $item = Get-Item $Target -Force
        if ($item.LinkType -eq 'SymbolicLink' -and $item.Target -eq $Source) {
            Write-LogSuccess "$Name 已经建立符号链接，状态健康。"
            return
        }

        if (-not (Test-Path $BackupDir)) {
            New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
            Write-LogInfo "创建旧配置安全备份目录: $BackupDir"
        }
        $backupPath = Join-Path $BackupDir (Split-Path -Leaf $Target)
        Move-Item -Path $Target -Destination $backupPath -Force
        Write-LogWarn "已安全归档旧配置至: $backupPath"
    }

    try {
        New-Item -ItemType SymbolicLink -Path $Target -Target $Source -Force -ErrorAction Stop | Out-Null
        Write-LogSuccess "$Name 成功创建符号链接 -> $Target"
    } catch {
        Write-LogWarn "系统未开启开发者模式或权限不足，自动降级为文件复制模式。"
        Copy-Item -Path $Source -Destination $Target -Force
        Write-LogSuccess "$Name 成功部署为独立文件 -> $Target"
    }
}

function Configure-User-Environment {
    Invoke-Step -Name "配置 Windows 用户级 SHELL 环境变量 (pwsh.exe)" -ScriptBlock {
        # 设置当前用户环境变量 SHELL 为 pwsh.exe (确保 Zellij 等多端复用器自动派生 PowerShell 7)
        [Environment]::SetEnvironmentVariable("SHELL", "pwsh.exe", "User")
        $env:SHELL = "pwsh.exe"
        $env:ZELLIJ_SHELL = "pwsh.exe"
        Write-LogSuccess "SHELL 环境变量已成功指向 pwsh.exe。"
    }
}

function Run-Config {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "       ⚙️ 正在部署 Dotfiles 符号链接配置 (manifest.toml)   " -ForegroundColor White -BackgroundColor DarkBlue
    Write-Host "==========================================================" -ForegroundColor Cyan

    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupDir = Join-Path $UserHome ".dotfiles_backup_$timestamp"
    $configsToDeploy = Get-TomlArray -FilePath $ManifestFile -Section "windows" -Key "configs"

    if ($configsToDeploy.Count -eq 0) {
        Write-LogWarn "manifest.toml 中未定义要部署的 configs 项。"
        return
    }

    # 1. 配置 Windows 终端环境变量适配
    Configure-User-Environment

    # 2. 部署 WezTerm 工业级配置体系
    if ($configsToDeploy -contains "wezterm") {
        Write-Host ""
        Write-LogInfo "--- 正在部署 WezTerm 终端配置 ---"
        $weztermDirSource = Join-Path $DotfilesDir "wezterm"
        $weztermLuaSource = Join-Path $weztermDirSource ".wezterm.lua"
        $weztermBgSource = Join-Path $weztermDirSource "background.png"

        $weztermConfigTargetDir = Join-Path $UserHome ".config\wezterm"
        $weztermLuaTarget = Join-Path $weztermConfigTargetDir "wezterm.lua"
        $weztermBgTarget = Join-Path $weztermConfigTargetDir "background.png"
        $weztermCompatTarget = Join-Path $UserHome ".wezterm.lua"

        Invoke-Step -Name "部署 WezTerm 背景图 (background.png)" -ScriptBlock {
            Deploy-Link-Item -Source $weztermBgSource -Target $weztermBgTarget -Name "WezTerm 背景图" -BackupDir $backupDir
        }

        Invoke-Step -Name "部署 WezTerm 主配置 (wezterm.lua)" -ScriptBlock {
            Deploy-Link-Item -Source $weztermLuaSource -Target $weztermLuaTarget -Name "WezTerm 主配置" -BackupDir $backupDir
        }

        Invoke-Step -Name "部署 WezTerm 根目录兼容链接 (.wezterm.lua)" -ScriptBlock {
            Deploy-Link-Item -Source $weztermLuaSource -Target $weztermCompatTarget -Name "WezTerm 根目录兼容链接" -BackupDir $backupDir
        }
    }

    # 3. 部署 PowerShell Profile 全局配置
    if ($configsToDeploy -contains "powershell") {
        Write-Host ""
        Write-LogInfo "--- 正在部署 PowerShell Profile 全局配置 ---"
        $pwshProfileSource = Join-Path $DotfilesDir "powershell\profile.ps1"
        
        $pwshProfileTarget = $PROFILE
        if ([string]::IsNullOrWhiteSpace($pwshProfileTarget)) {
            $pwshProfileTarget = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "PowerShell\Microsoft.PowerShell_profile.ps1"
        }

        Invoke-Step -Name "部署 PowerShell Profile ($($pwshProfileTarget | Split-Path -Leaf))" -ScriptBlock {
            Deploy-Link-Item -Source $pwshProfileSource -Target $pwshProfileTarget -Name "PowerShell Profile" -BackupDir $backupDir
        }
    }

    # 4. 部署通用应用配置目录 (~/.config/<app> - 如 fastfetch, zellij 等)
    $hasCommon = $false
    foreach ($app in $configsToDeploy) {
        if ($app -eq "wezterm" -or $app -eq "powershell") { continue }
        if (-not $hasCommon) {
            Write-Host ""
            Write-LogInfo "--- 正在部署通用应用配置目录 (~/.config/<app>) ---"
            $hasCommon = $true
        }

        $sourceAppDir = Join-Path $DotfilesDir $app
        $targetAppDir = Join-Path $UserHome ".config\$app"

        if (Test-Path $sourceAppDir) {
            Invoke-Step -Name "部署 [$app] 应用配置目录" -ScriptBlock {
                Deploy-Link-Item -Source $sourceAppDir -Target $targetAppDir -Name "[$app] 配置目录" -BackupDir $backupDir
            }
        } else {
            Write-LogWarn "未在仓库中找到配置目录: $sourceAppDir"
        }
    }

    Write-Host ""
    Write-LogSuccess "所有在 manifest.toml 中声明的配置文件均已完成软链接同步！"
    Write-Host " 💡 提示: 在仓库中修改文件即可直接对 Windows 系统产生实时作用。"
}

# -------------------------------------------------------------------------
# 模块三：交互式启动菜单 (Launch 入口)
# -------------------------------------------------------------------------

function Show-Help {
    Write-Host @"
SrP-Dotfiles Windows 声明式一键配置总控脚本 (start.ps1)
配置来源: manifest.toml [windows]

用法:
  .\start.ps1 [子命令] [选项]

子命令:
  all         全量执行：系统依赖安装 + 符号链接配置部署 (默认推荐流水线)
  install     仅安装系统软件与依赖 (基于 manifest.toml, 不触碰任何配置文件)
  config      仅部署并同步符号链接配置文件 (基于 manifest.toml, 不安装任何软件)
  launch      启动交互式彩色菜单 (无参数时的默认行为)
  help        显示本帮助信息

选项:
  -Force      强制覆盖部署现有配置文件，跳过询问

异常处理机制:
  当安装或部署遇到错误时，脚本会自动拦截并提供 [s] 跳过 / [r] 重试 / [a] 终止，
  并在执行结束时生成完整的《安装与部署审计报告》。

示例:
  .\start.ps1             # 打开控制台交互式菜单
  .\start.ps1 all         # 一键全自动完成所有配置
  .\start.ps1 install     # 仅安装软件包
  .\start.ps1 config      # 仅同步配置文件
"@
}

# 处理明确的 CLI 参数命令
if ($Action -ne '' -and $Action -ne 'launch') {
    switch ($Action) {
        'all'     { Run-Install; Write-Host ""; Run-Config; Show-Summary-Report; exit 0 }
        'install' { Run-Install; Show-Summary-Report; exit 0 }
        'config'  { Run-Config; Show-Summary-Report; exit 0 }
        'help'    { Show-Help; exit 0 }
        default   { Show-Help; exit 1 }
    }
}

# -------------------------------------------------------------------------
# 无参数或 Action 为 launch 时：启动交互式欢迎菜单
# -------------------------------------------------------------------------
Clear-Host
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       🚀 欢迎使用 SrP-Dotfiles Windows 一键管理引擎 " -ForegroundColor White -BackgroundColor DarkBlue
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " 🖥️ 操作系统环境: Windows $([Environment]::OSVersion.Version.Major) ($([Environment]::OSVersion.VersionString))" -ForegroundColor Green
Write-Host " 👤 当前用户目录: $UserHome" -ForegroundColor Yellow
Write-Host " 💻 PowerShell:   PS $($PSVersionTable.PSVersion.ToString())" -ForegroundColor Cyan
Write-Host " 📄 规则清单文件: $ManifestFile" -ForegroundColor Magenta
Write-Host "----------------------------------------------------" -ForegroundColor Cyan
Write-Host " 请选择要执行的操作："
Write-Host "   1) 全部执行 (安装全套环境依赖 + 部署符号链接配置) " -NoNewline; Write-Host "[推荐/默认]" -ForegroundColor Green
Write-Host "   2) 仅安装系统依赖与软件包 (Install Packages - 纯软件安装)"
Write-Host "   3) 仅部署与同步配置文件 (Deploy Configs - 纯符号链接同步)"
Write-Host "   0) 退出"
Write-Host "----------------------------------------------------" -ForegroundColor Cyan

$choice = Read-Host " 请输入选项 [1/2/3/0, 默认 1]"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

switch ($choice) {
    "1" {
        Run-Install
        Write-Host ""
        Run-Config
        Show-Summary-Report
    }
    "2" {
        Run-Install
        Show-Summary-Report
    }
    "3" {
        Run-Config
        Show-Summary-Report
    }
    "0" {
        Write-LogInfo "已安全退出。"
        exit 0
    }
    default {
        Write-LogError "无效的选择: $choice"
        exit 1
    }
}

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-LogSuccess "所有操作已成功执行完毕！"
Write-Host "====================================================" -ForegroundColor Cyan
