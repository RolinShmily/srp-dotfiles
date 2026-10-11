<#
.SYNOPSIS
    SrP-Dotfiles - Windows 统一环境一键管理总控引擎 (基于 manifest/windows.json 声明式驱动)

.DESCRIPTION
    高度对标 Unix 体系 (launch.sh) 的 Windows 自动化管理脚本。
    严格贯彻【Install (软件安装)】与【Config (配置部署)】职责解耦设计：
    
    1. 交互式启动菜单 (launch 入口)
    2. 软件与环境安装模块 (install):
       - PowerShell 远程签名策略 (前置环境准入)
       - Winget 系统核心套件安装 (从 manifest/windows.json 的 wingetPackages 读取)
       - Scoop 环境安装与镜像源配置 (从 manifest/windows.json 的 scoopBuckets 读取)
       - Aria2 多线程下载加速配置 (包管理器性能优化)
       - Scoop 扩展软件与字体安装 (从 manifest/windows.json 的 scoopPackages 读取)
       - 现代 Python 运行时安装 (从 manifest/windows.json 的 pythonManager 读取)
    3. 配置部署模块 (config - 只做派发):
       - Windows 用户级环境变量配置 (SHELL -> pwsh.exe，保障 Zellij 等多端识别)
       - 自动根据 manifest/windows.json 的 configs 部署配置：
         * 普通配置使用覆盖式复制（不使用软链）
         * Windows Terminal 使用局部覆盖，保留机器生成的 defaultProfile / profiles.list
         * Vim 原生配置与 Windows 兼容配置 (%USERPROFILE%\.vimrc & %USERPROFILE%\_vimrc)
         * WezTerm 工业级配置与专属背景图 (%USERPROFILE%\.config\wezterm\)
         * PowerShell 7 全局 Profile ($PROFILE)
         * MCP 服务统一配置 (%USERPROFILE%\.config\mcp 及 %APPDATA%\mcp)
         * 通用应用配置目录 (%USERPROFILE%\.config\<app> 如 fastfetch, zellij)
       - 覆盖语义: 目标已存在则直接删除重写，不备份

.EXAMPLE
    .\start.ps1                  # 启动交互式控制台菜单 (默认)
    .\start.ps1 all              # 自动非交互执行全部 (依赖安装 + 配置部署)
    .\start.ps1 install          # 仅执行系统环境与依赖安装 (不触碰任何配置文件)
    .\start.ps1 config           # 仅部署与同步 Dotfiles 配置文件 (不安装任何软件)
    .\start.ps1 config -f        # 强制覆盖部署当前配置 (-f 或 -Force)
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet('all', 'install', 'config', 'launch', 'help', '')]
    [string]$Action = '',

    [Alias('f')]
    [switch]$Force,

    [ValidateSet('en', 'zh', 'cn', '')]
    [string]$Lang = ''
)

# 确保控制台输出使用 UTF-8 编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# =========================================================================
# start.ps1 - SrP-Dotfiles Windows 统一环境一键管理总控引擎
# 集成: 交互式启动菜单 (Launch) + 依赖安装 (Install) + 配置部署与备份 (Config)
# 特性: 遇错拦截询问 (重试/跳过/终止) + 执行审计账本 + 部署汇总报告
# 配置清单来源: manifest/windows.json
#
# 章节索引 (与 launch.sh 逐节对齐，便于两边对照阅读)
#   0. 全局执行账本与受控步骤执行器    1. 声明清单读取    2. 运行环境探测
#   3. 模块一：环境与软件包检测安装    4. 模块二：配置部署 (只做派发)
#   5. CLI 帮助信息                    6. CLI 参数解析    7. 交互式启动菜单
# =========================================================================

# 基础目录与常量定义 (无编号前导，与 launch.sh 一致)
$DotfilesDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ManifestOs = "windows"
$Global:MANIFEST_OS = $ManifestOs
$ManifestDir = Join-Path $DotfilesDir "manifest"
$ManifestFile = Join-Path $ManifestDir "$ManifestOs.json"
$UserHome = $env:USERPROFILE

. (Join-Path $DotfilesDir "scripts\lib\i18n.ps1")
if ([string]::IsNullOrWhiteSpace($Lang)) {
    $Lang = if ($env:DF_LANG) { $env:DF_LANG } else { 'en' }
}
Set-I18nLanguage -Language $Lang

# 日志输出助手 (格式对标 Unix bash)
function Write-LogInfo { param([string]$Msg) Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $Msg }
function Write-LogSuccess { param([string]$Msg) Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Write-LogWarn { param([string]$Msg) Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-LogError { param([string]$Msg) Write-Host "[FAIL] " -ForegroundColor Red -NoNewline; Write-Host $Msg }

# -------------------------------------------------------------------------
# 0. 全局执行账本与受控步骤执行器 (Step Runner & Two-Stage Interrupt)
# -------------------------------------------------------------------------
$script:ReportSuccess = [System.Collections.Generic.List[string]]::new()
$script:ReportSkipped = [System.Collections.Generic.List[string]]::new()
$script:ReportFailed  = [System.Collections.Generic.List[string]]::new()

$script:LastCtrlCTime = [DateTime]::MinValue
$script:CurrentStepName = ""
$script:StepInterrupted = $false

# 注册控制台两级 Ctrl+C 拦截器 (单击跳过当前步骤，1.2秒内连按彻底退出)
try {
    [Console]::TreatControlCAsInput = $false
    $null = [Console]::CancelKeyPress += {
        param($sender, $eventArgs)
        $now = [DateTime]::UtcNow
        $diff = ($now - $script:LastCtrlCTime).TotalMilliseconds

        if ($diff -le 1200 -and $script:LastCtrlCTime -ne [DateTime]::MinValue) {
            # 1.2 秒内连按两次：彻底终止整个流程
            $eventArgs.Cancel = $false
            Write-Host "`n"
            Write-LogError (Get-I18n 'abort.doubleCtrlC')
            if ($script:CurrentStepName) {
                $script:ReportFailed.Add("$($script:CurrentStepName) (double Ctrl+C)")
            }
            Show-Summary-Report
            [System.Environment]::Exit(130)
        } else {
            # 单次按下：仅中断跳过当前卡住的子步骤
            $eventArgs.Cancel = $true
            $script:LastCtrlCTime = $now
            $script:StepInterrupted = $true
            Write-Host "`n"
            Write-LogWarn (Get-I18n 'interrupt.skip' @($script:CurrentStepName))
        }
    }
} catch {
    # 在非控制台托管环境下静默忽略
}

function Invoke-Step {
    param (
        [string]$Name,
        [scriptblock]$ScriptBlock
    )

    $script:CurrentStepName = $Name
    $script:StepInterrupted = $false

    while ($true) {
        Write-LogInfo (Get-I18n 'step.running' @($Name))
        $stepFailed = $false
        $errorDetails = ""

        try {
            $global:LASTEXITCODE = 0
            & $ScriptBlock

            # Check whether the current step was interrupted once.
            if ($script:StepInterrupted) {
                $script:StepInterrupted = $false
                $script:ReportSkipped.Add("$Name (interrupted)")
                $script:CurrentStepName = ""
                return $false
            }

            # 检查是否有非零外部命令退出码
            if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0 -and $global:LASTEXITCODE -ne -1978335189) {
                # 注意: -1978335189 为 winget 提示软件包已安装且已是最新版的正常返回码
                $stepFailed = $true
                $errorDetails = Get-I18n 'step.exitCode' @($global:LASTEXITCODE)
            }
        } catch [System.Management.Automation.PipelineStoppedException] {
            $script:StepInterrupted = $false
            $script:ReportSkipped.Add("$Name (interrupted)")
            $script:CurrentStepName = ""
            return $false
        } catch {
            if ($script:StepInterrupted) {
                $script:StepInterrupted = $false
                $script:ReportSkipped.Add("$Name (interrupted)")
                $script:CurrentStepName = ""
                return $false
            }
            $stepFailed = $true
            $errorDetails = $_.Exception.Message
        }

        if (-not $stepFailed) {
            $script:ReportSuccess.Add($Name)
            $script:CurrentStepName = ""
            return $true
        }

        # 报错拦截处理
        Write-LogError (Get-I18n 'step.failed' @($Name, $errorDetails))

        Write-Host "----------------------------------------------------" -ForegroundColor Yellow
        Write-Host (Get-I18n 'prompt.failure')
        Write-Host (Get-I18n 'prompt.skip') -ForegroundColor Green
        Write-Host (Get-I18n 'prompt.retry')
        Write-Host (Get-I18n 'prompt.abort')
        Write-Host "----------------------------------------------------" -ForegroundColor Yellow

        $choice = Read-Host (Get-I18n 'prompt.choice')
        if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "s" }

        switch ($choice.ToLower().Trim()) {
            "s" {
                Write-LogWarn (Get-I18n 'step.manualSkip' @($Name))
                $script:ReportSkipped.Add("$Name (manual skip: $errorDetails)")
                $script:CurrentStepName = ""
                return $false
            }
            "r" {
                Write-LogInfo (Get-I18n 'step.retrying' @($Name))
                $script:StepInterrupted = $false
                continue
            }
            "a" {
                Write-LogError (Get-I18n 'step.userAbort')
                $script:ReportFailed.Add("$Name (user abort: $errorDetails)")
                $script:CurrentStepName = ""
                Show-Summary-Report
                exit 1
            }
            default {
                Write-LogWarn (Get-I18n 'step.invalidDefaultSkip')
                $script:ReportSkipped.Add("$Name (default skip: $errorDetails)")
                $script:CurrentStepName = ""
                return $false
            }
        }
    }
}

function Show-Summary-Report {
    Write-Host "`n================================================================" -ForegroundColor Cyan
    Write-Host (Get-I18n 'report.title') -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan

    $totalSuccess = $script:ReportSuccess.Count
    $totalSkipped = $script:ReportSkipped.Count
    $totalFailed  = $script:ReportFailed.Count

    Write-Host (Get-I18n 'report.os' @("$([Environment]::OSVersion.Version.Major) ($([Environment]::OSVersion.VersionString))")) -ForegroundColor Green
    Write-Host (Get-I18n 'report.userHome' @($UserHome)) -ForegroundColor Yellow
    Write-Host (Get-I18n 'report.time' @((Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))) -ForegroundColor Cyan
    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan

    # 1. 成功项
    if ($totalSuccess -gt 0) {
        Write-Host (Get-I18n 'report.success' @($totalSuccess)) -ForegroundColor Green
        foreach ($item in $script:ReportSuccess) {
            Write-Host "  [OK] $item" -ForegroundColor Green
        }
    } else {
        Write-Host (Get-I18n 'report.none') -ForegroundColor Yellow
    }

    # 2. 跳过项
    if ($totalSkipped -gt 0) {
        Write-Host "`n$(Get-I18n 'report.skipped' @($totalSkipped))" -ForegroundColor Yellow
        foreach ($item in $script:ReportSkipped) {
            Write-Host "  [SKIP] $item" -ForegroundColor Yellow
        }
    }

    # 3. 失败项
    if ($totalFailed -gt 0) {
        Write-Host "`n$(Get-I18n 'report.failed' @($totalFailed))" -ForegroundColor Red
        foreach ($item in $script:ReportFailed) {
            Write-Host "  [FAIL] $item" -ForegroundColor Red
        }
    }

    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
    if ($totalSkipped -gt 0 -or $totalFailed -gt 0) {
        Write-Host (Get-I18n 'report.hint') -ForegroundColor Yellow
        Write-Host (Get-I18n 'report.install') -ForegroundColor Cyan
        Write-Host (Get-I18n 'report.config') -ForegroundColor Cyan
    } else {
        Write-Host (Get-I18n 'report.complete') -ForegroundColor Green
    }
    Write-Host "================================================================" -ForegroundColor Cyan
}

# -------------------------------------------------------------------------
# 1. 声明清单读取 (唯一事实源: manifest/<os>.json)
# -------------------------------------------------------------------------
# 清单由 scripts/lib/manifest.ps1 读取 (PowerShell 原生 ConvertFrom-Json)，
# 不依赖 node，因此 install 阶段也能直接读。部署动词来自 scripts/lib/deploy.ps1。

$Global:DF_DotfilesDir = $DotfilesDir
. (Join-Path $DotfilesDir "scripts\lib\manifest.ps1")
. (Join-Path $DotfilesDir "scripts\lib\deploy.ps1")

# -------------------------------------------------------------------------
# 2. 运行环境探测
# -------------------------------------------------------------------------
# Windows 无 OS 探测分支: 固定使用 manifest/windows.json。
# 对应 launch.sh 的 $TARGET_OS (arch | debian-homeserver | debian-vps | termux)。

# -------------------------------------------------------------------------
# 3. 模块一：环境与软件包检测安装 (Install)
# -------------------------------------------------------------------------

function Set-Pwsh-ExecutionPolicy {
    Invoke-Step -Name (Get-I18n 'install.policy') -ScriptBlock {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop
        Write-LogSuccess (Get-I18n 'install.policyDone')
    }
}

function Install-Winget-Packages {
    Write-Host (Get-I18n 'install.wingetStage') -ForegroundColor Cyan
    if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
        Write-LogError (Get-I18n 'install.wingetMissing')
        return
    }

    $packages = Get-ManifestArray -Os "windows" -Key "wingetPackages"
    if ($packages.Count -eq 0) {
        Write-LogWarn (Get-I18n 'install.manifestMissing')
        return
    }

    foreach ($pkgId in $packages) {
        Invoke-Step -Name (Get-I18n 'install.wingetPackage' @($pkgId)) -ScriptBlock {
            $installArgs = @("install", "--id", $pkgId, "--source", "winget", "--accept-source-agreements", "--accept-package-agreements")
            if ($pkgId -eq "Git.Git") { $installArgs += "-e" }
            & winget @installArgs
        }
    }
}

function Install-And-Configure-Scoop {
    Write-Host (Get-I18n 'install.scoopStage') -ForegroundColor Cyan

    # 1. 检测并安装 Scoop
    Invoke-Step -Name (Get-I18n 'install.scoopSetup') -ScriptBlock {
        if (-not (Get-Command "scoop" -ErrorAction SilentlyContinue)) {
            Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
        }
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        if (-not (Get-Command "scoop" -ErrorAction SilentlyContinue)) {
            throw (Get-I18n 'install.scoopPathError')
        }
    }

    # 2. 从 manifest/windows.json 读取并配置 Buckets
    $bucketEntries = Get-ManifestArray -Os "windows" -Key "scoopBuckets"
    $installedBuckets = scoop bucket list 2>$null

    foreach ($entry in $bucketEntries) {
        if ($entry -match '^\s*([^\s=]+)\s*=\s*(.+)$') {
            $bName = $matches[1].Trim()
            $bUrl = $matches[2].Trim()

            Invoke-Step -Name (Get-I18n 'install.scoopBucket' @($bName)) -ScriptBlock {
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

    # 3. 如果包含 aria2，则配置多线程下载优化 (包管理器基础能力加速与防错加固)
    $scoopPkgs = Get-ManifestArray -Os "windows" -Key "scoopPackages"
    if ($scoopPkgs -contains "aria2") {
        Invoke-Step -Name (Get-I18n 'install.aria2') -ScriptBlock {
            scoop install aria2
            # 即时将 Scoop shims 加入当前进程 PATH，杜绝找不到 aria2c 的情况
            $shimsPath = Join-Path $UserHome "scoop\shims"
            if ((Test-Path $shimsPath) -and ($env:PATH -notlike "*$shimsPath*")) {
                $env:PATH = "$shimsPath;$env:PATH"
            }
            # 配置保守稳定的连接参数 (防 CDN 403 阻断与证书误报)
            scoop config aria2-enabled true
            scoop config aria2-warning-enabled false
            scoop config aria2-retry-wait 2
            scoop config aria2-split 3
            scoop config aria2-max-connection-per-server 3
            scoop config aria2-min-split-size 5M
        }
    }
}

function Install-Scoop-Packages {
    Write-Host (Get-I18n 'install.scoopStage3') -ForegroundColor Cyan

    $packages = Get-ManifestArray -Os "windows" -Key "scoopPackages"
    foreach ($pkg in $packages) {
        if ($pkg -eq "aria2") { continue }
        Invoke-Step -Name (Get-I18n 'install.scoopPackage' @($pkg)) -ScriptBlock {
            scoop install $pkg
        }
    }
}

function Install-Python-Runtime {
    Write-Host (Get-I18n 'install.pythonStage') -ForegroundColor Cyan

    $pyManager = Get-ManifestValue -Os "windows" -Key "pythonManager"
    if ($pyManager -eq "uv") {
        Invoke-Step -Name (Get-I18n 'install.pythonManager') -ScriptBlock {
            if (-not (Get-Command "uv" -ErrorAction SilentlyContinue)) {
                irm https://astral.sh/uv/install.ps1 | iex
            }
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            if (-not (Get-Command "uv" -ErrorAction SilentlyContinue)) {
                throw (Get-I18n 'install.pythonMissing')
            }
        }

        Invoke-Step -Name (Get-I18n 'install.pythonRuntime') -ScriptBlock {
            uv python install
        }
    }
}

function Install-Npm-Globals {
    Write-Host (Get-I18n 'install.npmStage') -ForegroundColor Cyan

    # 刷新 PATH 环境变量以确保能识别刚通过 Scoop 安装的 nodejs/npm
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
        Write-LogWarn (Get-I18n 'install.npmMissing')
        return
    }

    $npmPackages = Get-ManifestArray -Os "windows" -Key "npmGlobals"
    if ($npmPackages.Count -eq 0) {
        Write-LogInfo (Get-I18n 'install.npmManifestMissing')
        return
    }

    foreach ($pkg in $npmPackages) {
        Invoke-Step -Name (Get-I18n 'install.npmPackage' @($pkg)) -ScriptBlock {
            npm install -g --ignore-scripts $pkg
        }
    }
}

function Run-Install {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host (Get-I18n 'install.title') -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    Set-Pwsh-ExecutionPolicy
    Install-Winget-Packages
    Install-And-Configure-Scoop
    Install-Scoop-Packages
    Install-Python-Runtime
    Install-Npm-Globals

    Write-Host ""
    Write-LogSuccess (Get-I18n 'install.done')
}

function Configure-User-Environment {
    Invoke-Step -Name (Get-I18n 'config.shell') -ScriptBlock {
        # 设置当前用户环境变量 SHELL 为 pwsh.exe (确保 Zellij 等多端复用器自动派生 PowerShell 7)
        [Environment]::SetEnvironmentVariable("SHELL", "pwsh.exe", "User")
        $env:SHELL = "pwsh.exe"
        $env:ZELLIJ_SHELL = "pwsh.exe"
        Write-LogSuccess (Get-I18n 'config.shellDone')
    }

    Invoke-Step -Name (Get-I18n 'config.git') -ScriptBlock {
        if (Get-Command "git" -ErrorAction SilentlyContinue) {
            & git config --global core.autocrlf input
            Write-LogSuccess (Get-I18n 'config.gitDone')
        } else {
            Write-LogWarn (Get-I18n 'config.gitMissing')
        }
    }
}

# -------------------------------------------------------------------------
# 4. 模块二：配置部署 (Config - 只做派发)
# -------------------------------------------------------------------------

# 单条 config 的派发。只认三个动词: link / copy / custom
function Invoke-ConfigEntry {
    param (
        [Parameter(Mandatory)]$Entry,
        [string]$BackupDir
    )

    $name   = [string]$Entry.name
    $method = [string]$Entry.method

    if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($method)) {
        Write-LogWarn (Get-I18n 'config.invalidEntry')
        return
    }

    # when: 条件路径不存在则整条跳过（例如 Scoop 尚未安装 btop）
    if ($Entry.when) {
        $whenPath = Expand-PathToken ([string]$Entry.when)
        if (-not (Test-Path -LiteralPath $whenPath)) {
            Write-LogInfo (Get-I18n 'config.condition' @($name, $Entry.when))
            return
        }
    }

    # ---- custom: 执行 scripts\configs\<name>.ps1 ----
    if ($method -eq "custom") {
        $customScript = Get-CustomScriptPath $name
        if (-not (Test-Path -LiteralPath $customScript)) {
            Write-LogError (Get-I18n 'config.customMissing' @($name, $customScript))
            return
        }
        Invoke-Step -Name (Get-I18n 'config.custom' @($name)) -ScriptBlock {
            & $customScript -DotfilesDir $Global:DF_DotfilesDir -BackupDir $BackupDir -ManifestOs $ManifestOs -Force:([bool]$Global:DF_Force)
        }
        return
    }

    if ($method -notin @("link", "copy")) {
        Write-LogWarn (Get-I18n 'config.methodUnknown' @($name, $method))
        return
    }

    # ---- link / copy: 读 source + targets ----
    $source = Get-ConfigSourcePath ([string]$Entry.source)
    if (-not (Test-Path -LiteralPath $source)) {
        Write-LogWarn (Get-I18n 'config.sourceMissing' @($name, $Entry.source))
        return
    }

    $targets = @()
    if ($Entry.targets) { $targets = @($Entry.targets) }
    elseif ($Entry.target) { $targets = @($Entry.target) }
    if ($targets.Count -eq 0) {
        Write-LogWarn (Get-I18n 'config.targetMissing' @($name))
        return
    }

    $exclude = @()
    if ($Entry.exclude) { $exclude = @($Entry.exclude) }
    $ifMissing = [bool]$Entry.ifMissing

    foreach ($t in $targets) {
        $dest = Expand-PathToken ([string]$t)
        if ($method -eq "link") {
            Invoke-Step -Name (Get-I18n 'config.link' @($name, $t)) -ScriptBlock {
                Deploy-LinkItem -Source $source -Target $dest -Name $name -BackupDir $BackupDir -Exclude $exclude | Out-Null
            }
        } elseif ([string]$Entry.source -like "*.example") {
            Invoke-Step -Name (Get-I18n 'config.copyExample' @($name, $t)) -ScriptBlock {
                Deploy-CopyExampleItem -Source $source -Target $dest -Name $name -BackupDir $BackupDir -IfMissing:$ifMissing | Out-Null
            }
        } else {
            Invoke-Step -Name (Get-I18n 'config.copy' @($name, $t)) -ScriptBlock {
                Deploy-CopyItem -Source $source -Target $dest -Name $name -BackupDir $BackupDir -Exclude $exclude -IfMissing:$ifMissing | Out-Null
            }
        }
    }
}

function Run-Config {
    param (
        [switch]$ForceDeploy = $Force
    )

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host (Get-I18n 'config.title') -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupDir = Join-Path $UserHome ".dotfiles_backup_$timestamp"

    $Global:DF_DotfilesDir = $DotfilesDir
    $Global:DF_BackupDir   = $backupDir
    $Global:DF_Force       = [bool]$ForceDeploy

    Write-LogInfo (Get-I18n 'config.manifest' @($ManifestFile))
    if ($ForceDeploy) { Write-LogInfo (Get-I18n 'config.force') }

    $configs = @(Get-ManifestArray -Os $ManifestOs -Key "configs")
    if ($configs.Count -eq 0) {
        Write-LogWarn (Get-I18n 'config.none')
        return
    }

    # 1. 终端环境变量适配（一次性前置，非配置项）
    Configure-User-Environment

    # 2. 按 manifest/windows.json 的 configs 顺序逐条派发
    foreach ($entry in $configs) {
        Invoke-ConfigEntry -Entry $entry -BackupDir $backupDir
    }

    Write-Host ""
    Write-LogSuccess (Get-I18n 'config.done')
    Write-Host (Get-I18n 'config.tip')
}

# -------------------------------------------------------------------------
# 5. CLI 帮助信息
# -------------------------------------------------------------------------

function Show-Help {
    Write-Host (Get-I18n 'help.title')
    Write-Host (Get-I18n 'help.source')
    Write-Host ""
    Write-Host (Get-I18n 'help.usage')
    Write-Host ""
    Write-Host (Get-I18n 'help.commands')
    Write-Host ""
    Write-Host (Get-I18n 'help.options')
    Write-Host ""
    Write-Host (Get-I18n 'help.errors')
    Write-Host ""
    Write-Host (Get-I18n 'help.examples')
}

# -------------------------------------------------------------------------
# 6. CLI 参数解析
# -------------------------------------------------------------------------

# 处理明确的 CLI 参数命令
if ($Action -ne '' -and $Action -ne 'launch') {
    switch ($Action) {
        'all'     { Run-Install; Write-Host ""; Run-Config -ForceDeploy:$Force; Show-Summary-Report; exit 0 }
        'install' { Run-Install; Show-Summary-Report; exit 0 }
        'config'  { Run-Config -ForceDeploy:$Force; Show-Summary-Report; exit 0 }
        'help'    { Show-Help; exit 0 }
        default   { Show-Help; exit 1 }
    }
}

# -------------------------------------------------------------------------
# 7. 交互式启动菜单 (无参数直接运行时)
# -------------------------------------------------------------------------
while ($true) {
    try { Clear-Host } catch { }
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host (Get-I18n 'menu.title') -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host (Get-I18n 'menu.os' @("$([Environment]::OSVersion.Version.Major) ($([Environment]::OSVersion.VersionString))")) -ForegroundColor Green
    Write-Host (Get-I18n 'menu.home' @($UserHome)) -ForegroundColor Yellow
    Write-Host " PowerShell: PS $($PSVersionTable.PSVersion.ToString())" -ForegroundColor Cyan
    Write-Host (Get-I18n 'menu.manifest' @($ManifestFile)) -ForegroundColor Magenta
    Write-Host "----------------------------------------------------" -ForegroundColor Cyan
    Write-Host (Get-I18n 'menu.choose')
    Write-Host (Get-I18n 'menu.all') -ForegroundColor Green
    Write-Host (Get-I18n 'menu.install')
    Write-Host (Get-I18n 'menu.config')
    Write-Host (Get-I18n 'menu.language' @($Global:DF_Lang))
    Write-Host (Get-I18n 'menu.exit')
    Write-Host "----------------------------------------------------" -ForegroundColor Cyan

    $choice = Read-Host (Get-I18n 'menu.choice')
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

    switch ($choice) {
        "1" {
            Run-Install
            Write-Host ""
            Run-Config -ForceDeploy:$Force
            Show-Summary-Report
            exit 0
        }
        "2" {
            Run-Install
            Show-Summary-Report
            exit 0
        }
        "3" {
            Run-Config -ForceDeploy:$Force
            Show-Summary-Report
            exit 0
        }
        "4" {
            Write-Host (Get-I18n 'menu.languagePrompt')
            Write-Host (Get-I18n 'menu.english')
            Write-Host (Get-I18n 'menu.chinese')
            $languageChoice = Read-Host (Get-I18n 'menu.languageChoice')
            switch ($languageChoice) {
                "1" { Set-I18nLanguage -Language 'en' }
                "2" { Set-I18nLanguage -Language 'zh' }
                default {
                    Write-LogError (Get-I18n 'menu.invalid' @($languageChoice))
                    continue
                }
            }
            Write-LogInfo (Get-I18n 'menu.languageChanged' @($Global:DF_Lang))
            continue
        }
        "0" {
            Write-LogInfo (Get-I18n 'menu.safeExit')
            exit 0
        }
        default {
            Write-LogError (Get-I18n 'menu.invalid' @($choice))
            continue
        }
    }
}
