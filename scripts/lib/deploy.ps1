# scripts/lib/deploy.ps1 — 部署动词库（Windows）。
#
# 只实现两个动词: link / copy。不负责编排与账本（那属于 start.ps1）。
#
# 调用方需先设置:
#   $Global:DF_DotfilesDir   仓库根目录
#   $Global:DF_BackupDir     备份目录
#   $Global:DF_Force         是否强制覆盖 (bool)
# 并定义 Write-LogInfo / Write-LogWarn / Write-LogSuccess / Write-LogError

if (-not (Get-Command Get-I18n -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "i18n.ps1")
    $bootstrapLang = if ($env:DF_LANG) { $env:DF_LANG } else { 'en' }
    Set-I18nLanguage -Language $bootstrapLang
}

function Get-DeployUserHome {
    if ($env:USERPROFILE) { return $env:USERPROFILE }
    return $HOME
}

function Get-ScoopRoot {
    if ($env:SCOOP) { return $env:SCOOP }
    return (Join-Path (Get-DeployUserHome) "scoop")
}

# 展开清单里的路径占位符: ~ | %APPDATA% | $SCOOP | $PROFILE
function Expand-PathToken {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $p = $Path.Trim()

    if ($p -eq '~') { return (Get-DeployUserHome) }
    if ($p.StartsWith('~/') -or $p.StartsWith('~\')) {
        $rest = $p.Substring(2).Replace('/', '\')
        return (Join-Path (Get-DeployUserHome) $rest)
    }
    if ($p -eq '$PROFILE') {
        if ([string]::IsNullOrWhiteSpace($PROFILE)) {
            return (Join-Path ([Environment]::GetFolderPath('MyDocuments')) "PowerShell\Microsoft.PowerShell_profile.ps1")
        }
        return $PROFILE
    }
    if ($p.Contains('%LOCALAPPDATA%')) {
        $p = $p.Replace('%LOCALAPPDATA%', [Environment]::GetFolderPath('LocalApplicationData'))
    }
    if ($p.Contains('%APPDATA%')) {
        $p = $p.Replace('%APPDATA%', [Environment]::GetFolderPath('ApplicationData'))
    }
    if ($p.Contains('$SCOOP')) {
        $p = $p.Replace('$SCOOP', (Get-ScoopRoot))
    }
    return $p
}

# link/copy 的源统一解释为"仓库内相对路径"
function Get-ConfigSourcePath {
    param([string]$Relative)
    Join-Path $Global:DF_DotfilesDir $Relative
}

# custom 条目的脚本路径
function Get-CustomScriptPath {
    param([string]$Name)
    Join-Path $Global:DF_DotfilesDir "scripts\configs\$Name.ps1"
}

# 安全删除目标: 软链/Junction 只删重解析点本身，绝不碰它指向的内容
function Remove-TargetEntry {
    param([Parameter(Mandatory)][string]$Target)

    $item = Get-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }

    $isReparse = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    if ($isReparse) {
        if ($item.PSIsContainer) { [System.IO.Directory]::Delete($Target, $false) }
        else { [System.IO.File]::Delete($Target) }
        return
    }

    if ($item.PSIsContainer) {
        Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue
    }
}

# 归档或删除已有目标（非链接）
function Remove-OrArchiveTarget {
    param([string]$Target, [string]$BackupDir)

    if ($Global:DF_Force) {
        Write-LogWarn (Get-I18n 'deploy.forceDelete' @($Target))
        Remove-TargetEntry -Target $Target
        return
    }

    if ($BackupDir) {
        if (-not (Test-Path -LiteralPath $BackupDir)) {
            New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        }
        $backupPath = Join-Path $BackupDir (Split-Path -Leaf $Target)
        try {
            Move-Item -LiteralPath $Target -Destination $backupPath -Force -ErrorAction Stop
            Write-LogWarn (Get-I18n 'deploy.backup' @($Target, $backupPath))
            return
        } catch {
            Write-LogWarn (Get-I18n 'deploy.archiveFailed' @($Target))
        }
    }
    Remove-TargetEntry -Target $Target
}

# link <源> <目标> [-Exclude 名称数组]
# 依次尝试: SymbolicLink -> Junction(目录)/HardLink(文件) -> 递归复制
function Deploy-LinkItem {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Target,
        [string]$Name = "配置项",
        [string]$BackupDir,
        [string[]]$Exclude = @()
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        Write-LogError (Get-I18n 'deploy.sourceMissing' @($Name, $Source))
        return $false
    }

    $isDir = (Get-Item -LiteralPath $Source).PSIsContainer

    # 目录 + 排除项: 建真实目录，逐项链接
    if ($isDir -and $Exclude.Count -gt 0) {
        if (-not (Test-Path -LiteralPath $Target)) {
            New-Item -ItemType Directory -Path $Target -Force | Out-Null
        }
        Get-ChildItem -LiteralPath $Source | Where-Object { $Exclude -notcontains $_.Name } | ForEach-Object {
            Deploy-LinkItem -Source $_.FullName -Target (Join-Path $Target $_.Name) `
                            -Name "$Name [$($_.Name)]" -BackupDir $BackupDir | Out-Null
        }
        return $true
    }

    $parent = Split-Path -Parent $Target
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path -LiteralPath $Target) {
        $item = Get-Item -LiteralPath $Target -Force
        if ($item.LinkType -in @('SymbolicLink', 'Junction') -and
            ($item.Target -eq $Source -or $item.Target -contains $Source)) {
            Write-LogInfo (Get-I18n 'deploy.linkCorrect' @($Name, $Target))
            return $true
        }
        Remove-OrArchiveTarget -Target $Target -BackupDir $BackupDir
    }

    # 1. 符号链接
    try {
        New-Item -ItemType SymbolicLink -Path $Target -Target $Source -Force -ErrorAction Stop | Out-Null
        Write-LogSuccess (Get-I18n 'deploy.linked' @($Name, $Target))
        return $true
    } catch { }

    # 2. 免特权回退: 目录用 Junction，文件用 HardLink
    try {
        if ($isDir) {
            New-Item -ItemType Junction -Path $Target -Target $Source -Force -ErrorAction Stop | Out-Null
        } else {
            New-Item -ItemType HardLink -Path $Target -Target $Source -Force -ErrorAction Stop | Out-Null
        }
        Write-LogSuccess (Get-I18n 'deploy.linkedFallback' @($Name, $Target))
        return $true
    } catch { }

    # 3. 最终降级: 复制
    Write-LogWarn (Get-I18n 'deploy.linkCopyFallback' @($Name, $Target))
    if ($isDir) {
        Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
    } else {
        Copy-Item -LiteralPath $Source -Destination $Target -Force
    }
    Write-LogSuccess (Get-I18n 'deploy.copied' @($Name, $Target))
    return $true
}

# copy <源> <目标> [-Exclude 名称数组] [-IfMissing]
# 覆盖式语义: 目标已存在则直接删除后复制，**不做备份**。
# -Exclude: 源为目录时跳过的顶层项（目标目录仍会被整体重建）。
# -IfMissing 是唯一的例外开关: 目标已存在就跳过（-Force 时仍覆盖）。
function Deploy-CopyItem {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Target,
        [string]$Name = "配置项",
        [string]$BackupDir,
        [string[]]$Exclude = @(),
        [switch]$IfMissing
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        Write-LogError (Get-I18n 'deploy.sourceMissing' @($Name, $Source))
        return $false
    }

    if ($IfMissing -and (Test-Path -LiteralPath $Target) -and -not $Global:DF_Force) {
        Write-LogInfo (Get-I18n 'deploy.ifMissing' @($Name, $Target))
        return $true
    }

    $parent = Split-Path -Parent $Target
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $isDir = (Get-Item -LiteralPath $Source).PSIsContainer

    # 目录 + 排除项: 重建目标目录，逐项覆盖复制（跳过 Exclude）
    if ($isDir -and $Exclude.Count -gt 0) {
        Remove-TargetEntry -Target $Target
        New-Item -ItemType Directory -Path $Target -Force | Out-Null
        foreach ($child in Get-ChildItem -LiteralPath $Source) {
            if ($Exclude -contains $child.Name) {
                Write-LogInfo (Get-I18n 'deploy.exclude' @($Name, $child.Name))
                continue
            }
            Deploy-CopyItem -Source $child.FullName -Target (Join-Path $Target $child.Name) `
                            -Name "$Name [$($child.Name)]" -BackupDir $BackupDir | Out-Null
        }
        Write-LogSuccess (Get-I18n 'deploy.overwriteExclude' @($Name, ($Exclude -join ', '), $Target))
        return $true
    }

    $existing = Get-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue

    # 重解析点(软链/Junction): 必须先删链接本身，否则 Copy-Item 会写穿到链接目标
    if ($existing -and ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        Remove-TargetEntry -Target $Target
        $existing = $null
    }

    # 文件→文件: 原地覆盖内容，保留目标 inode
    # (Scoop persist 用硬链接实现，删后重建会打断链接导致应用读到旧文件)
    if (-not $isDir -and $existing -and -not $existing.PSIsContainer) {
        [System.IO.File]::WriteAllBytes($Target, [System.IO.File]::ReadAllBytes($Source))
        Write-LogSuccess (Get-I18n 'deploy.overwriteInPlace' @($Name, $Target))
        return $true
    }

    if ($existing) {
        Remove-TargetEntry -Target $Target
    }

    Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
    Write-LogSuccess (Get-I18n 'deploy.overwrite' @($Name, $Target))
    return $true
}

# .example 模板部署: 正式目标已存在时保留原文件，模板落到 <目标>.example；
# 正式目标不存在时直接以模板创建正式目标。
function Get-ExampleTarget {
    param([Parameter(Mandatory)][string]$Target)

    $existing = Get-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue
    if ($existing) {
        Write-LogInfo (Get-I18n 'deploy.exampleExisting' @($Target))
        return "$Target.example"
    }

    Write-LogInfo (Get-I18n 'deploy.exampleMissing' @($Target))
    return $Target
}

function Deploy-CopyExampleItem {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Target,
        [string]$Name = "示例配置",
        [string]$BackupDir,
        [switch]$IfMissing
    )

    $exampleTarget = Get-ExampleTarget -Target $Target
    Deploy-CopyItem -Source $Source -Target $exampleTarget -Name $Name `
                    -BackupDir $BackupDir -IfMissing:$IfMissing
}
