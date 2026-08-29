" ~/.vimrc - 现代化极简原生 Vim 配置（零外部依赖、开箱即用）

" ------------------------------------------------------------------
" 1. 基础环境与兼容性设置
" ------------------------------------------------------------------
set nocompatible              " 关闭 vi 兼容模式
set encoding=utf-8            " 内部字符编码
set fileencodings=utf-8,gbk,gb18030,latin1 " 文件编码自动识别
set fileformat=unix           " 换行符格式
filetype plugin indent on     " 开启文件类型侦测与缩进规则
syntax enable                 " 开启基础语法高亮
syntax on

" ------------------------------------------------------------------
" 2. 界面与显示增强
" ------------------------------------------------------------------
set number                    " 显示行号
set relativenumber            " 显示相对行号（便于跳转，可根据习惯关闭）
set cursorline                " 高亮当前行
set ruler                     " 状态栏标尺（行号/列号）
set showcmd                   " 显示未输入完成的命令
set showmode                  " 底部显示当前模式 (INSERT/NORMAL)
set laststatus=2              " 总是显示底部状态栏
set scrolloff=5               " 光标上下保留 5 行缓冲距离
set sidescrolloff=5           " 光标左右保留 5 列缓冲距离
set wrap                      " 自动折行
set linebreak                 " 单词边界折行，不打断单词
set list                      " 显示隐藏字符（Tab、行尾空格等）
set listchars=tab:▸\ ,trail:·,extends:❯,precedes:❮

" 终端真彩色与暗色背景支持
if has('termguicolors')
    set termguicolors
endif
set background=dark

" ------------------------------------------------------------------
" 3. 缩进与排版规则 (2 空格 / 4 空格标准)
" ------------------------------------------------------------------
set tabstop=4                 " Tab 宽度为 4
set shiftwidth=4              " 每一级缩进为 4
set softtabstop=4             " 退格时退 4 空格
set expandtab                 " 将 Tab 键自动展开为空格
set autoindent                " 新行自动与前一行缩进对齐
set smartindent               " 智能语法缩进

" 针对特定语言特化缩进（如 JS/TS/Lua/JSON 采用 2 空格）
autocmd FileType javascript,typescript,html,css,json,yaml,lua setlocal tabstop=2 shiftwidth=2 softtabstop=2

" ------------------------------------------------------------------
" 4. 搜索与替换
" ------------------------------------------------------------------
set hlsearch                  " 高亮搜索结果
set incsearch                 " 键入搜索词时实时预览跳转
set ignorecase                " 搜索时忽略大小写
set smartcase                 " 若包含大写字母则精准匹配大小写
if has('nvim')
    set inccommand=nosplit    " 实时预览全局替换效果 (Neovim 特性)
endif

" ------------------------------------------------------------------
" 5. 编辑体验与系统剪贴板
" ------------------------------------------------------------------
set backspace=indent,eol,start " 允许在任意位置使用 Backspace
set mouse=a                   " 开启鼠标支持（支持滚动、选区、点击）
set hidden                    " 允许在有未保存修改时切换 Buffer
set updatetime=300            " 加快响应延迟 (毫秒)
set nobackup                  " 不产生备份文件
set nowritebackup             " 保存时不保留临时备份
set noswapfile                " 禁用 swap 文件

" 剪贴板无缝同步 (优先与系统剪贴板连通)
if has('clipboard')
    set clipboard^=unnamed,unnamedplus
endif

" ------------------------------------------------------------------
" 6. 快捷键与 Leader 键设置
" ------------------------------------------------------------------
let mapleader = " "           " 将空格键设为 Leader 键

" 取消搜索高亮
nnoremap <silent> <Leader>h :nohlsearch<CR>

" 快速保存与退出
nnoremap <Leader>w :w<CR>
nnoremap <Leader>q :q<CR>

" 窗口快速切换 (Ctrl + h/j/k/l)
nnoremap <C-h> <C-w>h
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-l> <C-w>l

" 视觉模式下缩进后保持选中状态
vnoremap < <gv
vnoremap > >gv
