# scripts/lib/manifest.ps1 — 声明清单 (manifest/<os>.json) 读取库（Windows）。
#
# 唯一事实源: 仓库根目录的 manifest/<os>.json。
# 提供三个只读函数，不做任何部署动作。

if (-not (Get-Command Get-I18n -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "i18n.ps1")
    $bootstrapLang = if ($env:DF_LANG) { $env:DF_LANG } else { 'en' }
    Set-I18nLanguage -Language $bootstrapLang
}

if (-not $Global:MANIFEST_DIR) {
    $root = if ($Global:DF_DotfilesDir) { $Global:DF_DotfilesDir }
            else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
    $Global:MANIFEST_DIR = Join-Path $root "manifest"
}

if (-not $Global:MANIFEST_SECTIONS) {
    $Global:MANIFEST_SECTIONS = @{}
}

function Get-ManifestSection {
    param([Parameter(Mandatory)][string]$Os)

    if (-not $Global:MANIFEST_SECTIONS.ContainsKey($Os)) {
        $manifestPath = Join-Path $Global:MANIFEST_DIR "$Os.json"
        if (-not (Test-Path -LiteralPath $manifestPath)) {
            throw (Get-I18n 'manifest.notFound' @($manifestPath))
        }
        $Global:MANIFEST_SECTIONS[$Os] = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    return $Global:MANIFEST_SECTIONS[$Os]
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
