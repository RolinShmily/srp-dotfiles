# scripts/lib/manifest.ps1 — 声明清单 (manifest.json) 读取库（Windows）。
#
# 唯一事实源: 仓库根目录的 manifest.json。
# 提供四个只读函数，不做任何部署动作。

if (-not $Global:MANIFEST_PATH) {
    $root = if ($Global:DF_DotfilesDir) { $Global:DF_DotfilesDir }
            else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
    $Global:MANIFEST_PATH = Join-Path $root "manifest.json"
}

function Get-Manifest {
    if (-not $Global:MANIFEST_CACHE) {
        if (-not (Test-Path -LiteralPath $Global:MANIFEST_PATH)) {
            throw "未找到声明清单: $($Global:MANIFEST_PATH)"
        }
        $Global:MANIFEST_CACHE = Get-Content -LiteralPath $Global:MANIFEST_PATH -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    return $Global:MANIFEST_CACHE
}

function Get-ManifestSection {
    param([Parameter(Mandatory)][string]$Os)

    $m = Get-Manifest
    if (-not $m.PSObject.Properties[$Os]) {
        throw "manifest.json 中不存在 OS 段: $Os"
    }
    return $m.$Os
}

function Get-ManifestArray {
    param(
        [Parameter(Mandatory)][string]$Os,
        [Parameter(Mandatory)][string]$Key
    )

    $section = Get-ManifestSection -Os $Os
    if (-not $section.PSObject.Properties[$Key]) { return @() }
    $value = $section.$Key
    if ($null -eq $value) { return @() }
    return @($value)
}

function Get-ManifestValue {
    param(
        [Parameter(Mandatory)][string]$Os,
        [Parameter(Mandatory)][string]$Key
    )

    $section = Get-ManifestSection -Os $Os
    if (-not $section.PSObject.Properties[$Key]) { return "" }
    return [string]$section.$Key
}
