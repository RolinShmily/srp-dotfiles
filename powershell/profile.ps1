# ====================================================================
# PowerShell 7 个人全局配置文件 ($PROFILE)
# 管理来源: SrP-Dotfiles (powershell/profile.ps1)
# 设计哲学: 模块化、按需探测 (Command-Aware)、防御性兜底 (Graceful Fallback)
# ====================================================================

# --------------------------------------------------------------------
# 1. 基础环境与跨平台适配
# --------------------------------------------------------------------

# 设置默认 Shell 环境变量为 PowerShell 7 (供 Zellij / 终端复用器探测)
if (Get-Command "pwsh" -ErrorAction SilentlyContinue) {
    $env:SHELL = "pwsh.exe"
    $env:ZELLIJ_SHELL = "pwsh.exe"
}

# 终端 Shell 集成 (如果环境支持)
$__it_si = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PowerShell\shell-integration_v2.ps1'
if (Test-Path -LiteralPath $__it_si) {
    . $__it_si
}
Remove-Variable __it_si -ErrorAction SilentlyContinue

# 现代提示符引擎 (Oh My Posh - 按需加载)
if (Get-Command "oh-my-posh" -ErrorAction SilentlyContinue) {
    oh-my-posh init pwsh --config 'zash' | Invoke-Expression
}

# Zoxide 智能目录跳转 (按需加载)
if (Get-Command "zoxide" -ErrorAction SilentlyContinue) {
    Invoke-Expression (& zoxide init powershell | Out-String)
}

# --------------------------------------------------------------------
# 2. 命令感知型别名 (Command-Aware: 仅在工具实际安装时安全注册)
# --------------------------------------------------------------------

# 基础内置映射 (永远安全可用)
Set-Alias -Name cl -Value Clear-Host -Option AllScope -ErrorAction SilentlyContinue

# 第三方 CLI 工具按需映射 (检测到安装才注册，杜绝未装工具时的红字报错)
if (Get-Command "zellij"    -ErrorAction SilentlyContinue) { Set-Alias -Name ze -Value zellij    -Option AllScope }
if (Get-Command "fastfetch" -ErrorAction SilentlyContinue) { Set-Alias -Name ff -Value fastfetch -Option AllScope }
if (Get-Command "lazygit"   -ErrorAction SilentlyContinue) { Set-Alias -Name lg -Value lazygit   -Option AllScope }

# which 工具函数 (查找命令路径)
function which ($name) {
    Get-Command $name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

# --------------------------------------------------------------------
# 3. 优雅兜底增强函数 (Graceful Fallbacks)
# --------------------------------------------------------------------

# 现代目录列表 (优先 eza，无 eza 时优雅回退至 Get-ChildItem)
function ll {
    if (Get-Command "eza" -ErrorAction SilentlyContinue) {
        eza -lh --icons --git --group-directories-first @args
    } else {
        Get-ChildItem -Force @args
    }
}

function la {
    if (Get-Command "eza" -ErrorAction SilentlyContinue) {
        eza -lah --icons --git --group-directories-first @args
    } else {
        Get-ChildItem -Force @args
    }
}

function lt {
    if (Get-Command "eza" -ErrorAction SilentlyContinue) {
        eza --tree --level=2 --icons --group-directories-first @args
    } else {
        Get-ChildItem -Recurse -Depth 2 @args
    }
}

# 语法高亮文件查看 (优先 bat，无 bat 时优雅回退至 Get-Content)
function cat {
    if (Get-Command "bat" -ErrorAction SilentlyContinue) {
        bat --style=header,grid,numbers --paging=never @args
    } else {
        Get-Content @args
    }
}

# Yazi 现代文件管理器 (退出时自动同步当前工作目录)
function yz {
    if (-not (Get-Command "yazi" -ErrorAction SilentlyContinue)) {
        Write-Warning "未检测到 Yazi，请先通过 'winget install sxyazi.yazi' 或 '.\start.ps1 install' 进行安装。"
        return
    }
    $tmp = [System.IO.Path]::GetTempFileName()
    yazi @args --cwd-file="$tmp"
    if (Test-Path $tmp) {
        $cwd = Get-Content $tmp -Raw
        if ($cwd -and (Test-Path $cwd.Trim())) {
            Set-Location $cwd.Trim()
        }
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# --------------------------------------------------------------------
# 4. 高频生产力与目录跳转纯函数 (零外部依赖，100% 原生可靠)
# --------------------------------------------------------------------

# 快速跳转到 Projects 开发根目录 (~/Projects 或指定子项目)
function proj {
    param([string]$target = "")
    $base = if ($env:PROJECTS_DIR) { $env:PROJECTS_DIR } else { Join-Path $HOME "Projects" }
    if ($target) {
        Set-Location (Join-Path $base $target)
    } else {
        Set-Location $base
    }
}

# 创建目录并立刻进入 (dir)
function dir {
    param([Parameter(Mandatory=$true)][string]$path)
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-Location $path
}

# 克隆仓库并自动进入该项目目录
function clone {
    param([Parameter(Mandatory=$true)][string]$repo, [string]$dir = "")
    if ($dir) {
        git clone $repo $dir
        if ($LASTEXITCODE -eq 0) { Set-Location $dir }
    } else {
        git clone $repo
        if ($LASTEXITCODE -eq 0) {
            $folderName = [System.IO.Path]::GetFileNameWithoutExtension($repo)
            if (Test-Path $folderName) { Set-Location $folderName }
        }
    }
}

# 一键回到当前 Git 仓库根目录 (对标 Unix: grt)
function grt {
    $root = git rev-parse --show-toplevel 2>$null
    if ($root) { Set-Location $root }
}

# --------------------------------------------------------------------
# 5. Git 极速工作流快捷函数 (对标 Unix zsh.d/git.zsh)
# --------------------------------------------------------------------
function gs   { git status @args }
function gb   { git branch @args }
function gco  { git checkout @args }
function gcob { git checkout -b @args }
function main { git checkout main @args }

function ga   { git add @args }
function gA   { git add -A @args }
function gc   { git commit @args }
function gcm  { git commit -m @args }
function gcam { git add -A; git commit -m @args }

function gp   { git push @args }
function gpf  { git push --force @args }
function gpl  { git pull --rebase @args }

function gl   { git log @args }
function glo  { git log --oneline --graph @args }
function gd   { git diff @args }
function gdc  { git diff --cached @args }
