# ====================================================================
# PowerShell 7 个人全局配置文件 ($PROFILE)
# 管理来源: SrP-Dotfiles (powershell/profile.ps1)
# ====================================================================

# 1. 设置跨平台默认 Shell 环境变量为 PowerShell 7 (供 Zellij / CLI 终端工具识别)
if (Get-Command "pwsh" -ErrorAction SilentlyContinue) {
    $env:SHELL = "pwsh.exe"
    $env:ZELLIJ_SHELL = "pwsh.exe"
}

# 2. 智能终端 Shell 集成 (如果存在)
$__it_si = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PowerShell\shell-integration_v2.ps1'
if (Test-Path -LiteralPath $__it_si) {
    . $__it_si
}
Remove-Variable __it_si -ErrorAction SilentlyContinue

# 3. 现代提示符引擎 (Oh My Posh)
if (Get-Command "oh-my-posh" -ErrorAction SilentlyContinue) {
    oh-my-posh init pwsh --config 'zash' | Invoke-Expression
}

# 4. 基础常用别名与函数增强
function which ($name) {
    Get-Command $name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

# 快速快捷键与常用别名
Set-Alias -Name ll -Value Get-ChildItem -Option AllScope -ErrorAction SilentlyContinue
Set-Alias -Name g  -Value git -Option AllScope -ErrorAction SilentlyContinue
Set-Alias -Name ff -Value fastfetch -Option AllScope -ErrorAction SilentlyContinue
