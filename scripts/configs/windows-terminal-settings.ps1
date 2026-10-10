# scripts/configs/windows-terminal-settings.ps1 — Windows Terminal 局部覆盖部署。
#
# Windows Terminal 的 defaultProfile 与 profiles.list 是机器相关字段：
# 前者可能因安装环境不同而变化，后者由 Terminal 自动维护。因此已有
# settings.json 不能被模板整体替换，只覆盖模板中明确声明的字段。

[CmdletBinding()]
param (
    [Parameter(Mandatory)][string]$DotfilesDir,
    [string]$BackupDir,
    [string]$ManifestOs = "windows",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command Write-LogInfo -ErrorAction SilentlyContinue)) {
    function Write-LogInfo    { param([string]$Msg) Write-Host "[INFO] $Msg" }
    function Write-LogSuccess { param([string]$Msg) Write-Host "[OK]   $Msg" }
}

$source = Join-Path $DotfilesDir "windows-terminal\settings.json.example"
$target = Join-Path $env:LOCALAPPDATA "Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"

if (-not (Test-Path -LiteralPath $source)) {
    throw "Windows Terminal 模板不存在: $source"
}

# 去掉 JSONC 注释，但保留字符串内容（例如 URL 中的 //）。
function Remove-JsoncComments {
    param([Parameter(Mandatory)][string]$Text)

    $builder = [System.Text.StringBuilder]::new()
    $inString = $false
    $escaped = $false
    $inLineComment = $false
    $inBlockComment = $false

    for ($i = 0; $i -lt $Text.Length; $i++) {
        $char = $Text[$i]

        if ($inLineComment) {
            if ($char -eq "`r" -or $char -eq "`n") {
                $inLineComment = $false
                [void]$builder.Append($char)
            } else {
                [void]$builder.Append(' ')
            }
            continue
        }

        if ($inBlockComment) {
            if ($char -eq '*' -and $i + 1 -lt $Text.Length -and $Text[$i + 1] -eq '/') {
                [void]$builder.Append(' ')
                [void]$builder.Append(' ')
                $i++
            } elseif ($char -eq "`r" -or $char -eq "`n") {
                [void]$builder.Append($char)
            } else {
                [void]$builder.Append(' ')
            }
            if ($char -eq '*' -and $i -lt $Text.Length -and $Text[$i] -eq '/') {
                $inBlockComment = $false
            }
            continue
        }

        if ($inString) {
            [void]$builder.Append($char)
            if ($escaped) {
                $escaped = $false
            } elseif ($char -eq '\') {
                $escaped = $true
            } elseif ($char -eq '"') {
                $inString = $false
            }
            continue
        }

        if ($char -eq '"') {
            $inString = $true
            [void]$builder.Append($char)
        } elseif ($char -eq '/' -and $i + 1 -lt $Text.Length -and $Text[$i + 1] -eq '/') {
            $inLineComment = $true
            [void]$builder.Append(' ')
            [void]$builder.Append(' ')
            $i++
        } elseif ($char -eq '/' -and $i + 1 -lt $Text.Length -and $Text[$i + 1] -eq '*') {
            $inBlockComment = $true
            [void]$builder.Append(' ')
            [void]$builder.Append(' ')
            $i++
        } else {
            [void]$builder.Append($char)
        }
    }

    return $builder.ToString()
}

# JSONC 允许对象/数组末尾逗号；ConvertFrom-Json 不允许，且只处理字符串外的逗号。
function Remove-JsoncTrailingCommas {
    param([Parameter(Mandatory)][string]$Text)

    $builder = [System.Text.StringBuilder]::new()
    $inString = $false
    $escaped = $false

    for ($i = 0; $i -lt $Text.Length; $i++) {
        $char = $Text[$i]

        if ($inString) {
            [void]$builder.Append($char)
            if ($escaped) {
                $escaped = $false
            } elseif ($char -eq '\') {
                $escaped = $true
            } elseif ($char -eq '"') {
                $inString = $false
            }
            continue
        }

        if ($char -eq '"') {
            $inString = $true
            [void]$builder.Append($char)
            continue
        }

        if ($char -eq ',') {
            $next = $i + 1
            while ($next -lt $Text.Length -and [char]::IsWhiteSpace($Text[$next])) {
                $next++
            }
            if ($next -lt $Text.Length -and ($Text[$next] -eq '}' -or $Text[$next] -eq ']')) {
                $i = $next - 1
                continue
            }
        }

        [void]$builder.Append($char)
    }

    return $builder.ToString()
}

function ConvertFrom-Jsonc {
    param([Parameter(Mandatory)][string]$Text)

    $withoutComments = Remove-JsoncComments -Text $Text
    $json = Remove-JsoncTrailingCommas -Text $withoutComments
    return ($json | ConvertFrom-Json -AsHashtable)
}

# 递归覆盖 source 中声明的字段；source 未声明的字段保留。
# 两个机器相关字段无论模板是否误加入，都不会覆盖目标值。
function Merge-JsonObject {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Target,
        [Parameter(Mandatory)][System.Collections.IDictionary]$Source,
        [string]$Path = ""
    )

    foreach ($key in $Source.Keys) {
        $keyName = [string]$key
        if (($Path -eq "" -and $keyName -eq "defaultProfile") -or
            ($Path -eq "profiles" -and $keyName -eq "list")) {
            continue
        }

        $sourceValue = $Source[$key]
        if ($Target.Contains($key) -and
            $sourceValue -is [System.Collections.IDictionary] -and
            $Target[$key] -is [System.Collections.IDictionary]) {
            $childPath = if ($Path) { "$Path.$keyName" } else { $keyName }
            Merge-JsonObject -Target $Target[$key] -Source $sourceValue -Path $childPath
        } else {
            $Target[$key] = $sourceValue
        }
    }
}

$sourceConfig = ConvertFrom-Jsonc -Text ([System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8))
if ($sourceConfig -isnot [System.Collections.IDictionary]) {
    throw "Windows Terminal 模板根节点必须是 JSON 对象: $source"
}

$targetParent = Split-Path -Parent $target
if (-not (Test-Path -LiteralPath $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $target)) {
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-LogSuccess "[windows-terminal-settings] 目标不存在，已使用模板创建: $target"
    return
}

$targetConfig = ConvertFrom-Jsonc -Text ([System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8))
if ($targetConfig -isnot [System.Collections.IDictionary]) {
    throw "Windows Terminal 正式配置根节点必须是 JSON 对象: $target"
}

Merge-JsonObject -Target $targetConfig -Source $sourceConfig
$json = $targetConfig | ConvertTo-Json -Depth 100
$temp = "$target.tmp-$PID"

try {
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($temp, $json + [Environment]::NewLine, $utf8NoBom)
    Move-Item -LiteralPath $temp -Destination $target -Force
} finally {
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}

Write-LogSuccess "[windows-terminal-settings] 已局部覆盖，保留 defaultProfile / profiles.list: $target"
