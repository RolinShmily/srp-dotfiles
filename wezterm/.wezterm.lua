-- ====================================================================
-- WezTerm 配置 
-- 参考借鉴: KevinSilvester/wezterm-config
-- 1. 默认专属背景图，支持 Alt + / 一键切换纯黑专注模式
-- 2. 呼吸感平滑光标 (EaseOut 缓动动画)
-- 3. 智能 URL 清洗剥离与免鼠标 QuickSelect 打开
-- 4. 窗口缩放锁定 (调字号不跳动物理窗口大小)
-- 5. 20000 行大回滚缓冲区、无感退出、彻底消除刺耳蜂鸣
-- 6. 内置现代命令面板 (F2)
-- 7. 优雅清晰 Maple Mono NF CN (14.0pt Regular)
-- ====================================================================

local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

-- ============================ 1. 基础行为与启动 ============================

-- 默认拉起现代 PowerShell 7 (Core)，-NoLogo 跳过版权横幅
config.default_prog = { 'pwsh.exe', '-NoLogo' }

config.exit_behavior = 'CloseOnCleanExit'
config.window_close_confirmation = 'NeverPrompt'
config.automatically_reload_config = true

-- 关闭 Windows 系统蜂鸣警告
config.audible_bell = 'Disabled'

-- 禁用 Win32 控制台低级按键捕获，确保 WezTerm 优先拦截 Alt 组合键 (解决 Alt+t/Alt+w 被抢占)
config.allow_win32_input_mode = false

-- 扩充回滚缓冲区至 20000 行
config.scrollback_lines = 20000

-- 规范化粘贴换行
config.canonicalize_pasted_newlines = 'LineFeed'

-- 便捷启动菜单
config.launch_menu = {
  {
    label = 'PowerShell 7 (pwsh)',
    args = { 'pwsh.exe', '-NoLogo' },
  },
  {
    label = 'WSL',
    args = { 'wsl.exe', '~' },
  },
  {
    label = 'Command Prompt (cmd)',
    args = { 'cmd.exe' },
  },
}

-- ============================ 2. 字体与排版优化 ============================

-- 关闭缺失字形时的弹窗报错 (防止特殊字符触发 configuration error 窗口)
config.warn_about_missing_glyphs = false

config.font = wezterm.font_with_fallback({
  { family = 'Maple Mono NF CN' },
  { family = 'Microsoft YaHei UI' },
  { family = 'Segoe UI Emoji', assume_emoji_presentation = true },
})
config.font_size = 14.0
config.line_height = 1.15

-- 采用全灰度抗锯齿 (Normal)
config.freetype_load_target = 'Normal'
config.freetype_render_target = 'Normal'

config.adjust_window_size_when_changing_font_size = false

config.underline_thickness = '1.5pt'

-- ============================ 3. 光标经典慢速闪烁 ============================

config.default_cursor_style = 'BlinkingBlock'
config.cursor_blink_rate = 650
config.cursor_blink_ease_in = 'Constant'
config.cursor_blink_ease_out = 'Constant'

-- ============================ 4. 窗口外观与低功耗渲染 ============================

config.color_scheme = 'Catppuccin Mocha'

-- 移除独立系统标题栏，将 Windows 原生矢量三按钮 (最小化、最大化、关闭) 嵌入 Tab 栏最右侧
config.window_decorations = 'INTEGRATED_BUTTONS | RESIZE'
config.integrated_title_button_style = 'Windows'
config.integrated_title_button_alignment = 'Right'
config.integrated_title_buttons = { 'Hide', 'Maximize', 'Close' }

-- 窗口框架与原生 Fancy 标签栏深度美化 (消除生硬灰边与杂色，统一为暗紫夜光底槽)
config.window_frame = {
  font = wezterm.font_with_fallback({
    { family = 'Maple Mono NF CN' },
    { family = 'Microsoft YaHei UI' },
  }),
  font_size = 11.5,
  active_titlebar_bg = '#15141e',
  inactive_titlebar_bg = '#15141e',
  active_titlebar_fg = '#f5eeff',
  inactive_titlebar_fg = '#938aa9',
  active_titlebar_border_bottom = '#15141e',
  inactive_titlebar_border_bottom = '#15141e',
  button_fg = '#938aa9',
  button_bg = '#15141e',
  button_hover_fg = '#ffffff',
  button_hover_bg = '#322846',
  border_left_width = '0px',
  border_right_width = '0px',
  border_bottom_height = '0px',
  border_top_height = '0px',
  border_left_color = '#15141e',
  border_right_color = '#15141e',
  border_bottom_color = '#15141e',
  border_top_color = '#15141e',
}

-- 窗口内边距
config.window_padding = {
  left = 12,
  right = 12,
  top = 8,
  bottom = 6,
}

config.enable_tab_bar = true
config.use_fancy_tab_bar = true
config.hide_tab_bar_if_only_one_tab = false
config.show_new_tab_button_in_tab_bar = true
config.tab_max_width = 32

-- 标签栏采用 Catppuccin Mauve 暗紫夜光质感配色与按钮美化
config.colors = {
  tab_bar = {
    background = '#15141e',
    inactive_tab_edge = '#15141e', -- 彻底消除默认灰色分界线
    active_tab = {
      bg_color = '#4a3866',
      fg_color = '#f5eeff',
      intensity = 'Bold',
    },
    inactive_tab = {
      bg_color = '#221c30',
      fg_color = '#938aa9',
    },
    inactive_tab_hover = {
      bg_color = '#322846',
      fg_color = '#e0d4fc',
    },
    -- "+" 新建标签按钮美化
    new_tab = {
      bg_color = '#15141e',
      fg_color = '#938aa9',
    },
    new_tab_hover = {
      bg_color = '#322846',
      fg_color = '#cba6f7',
      intensity = 'Bold',
    },
  },
}

-- ============================ 格式化标签栏：智能进程图标与夜光标题美化 ============================

local function get_process_icon(title)
  local lower = string.lower(title)
  if string.find(lower, 'zellij') then
    return '⚡'
  elseif string.find(lower, 'pi') or string.find(lower, 'agent') then
    return '🤖'
  elseif string.find(lower, 'pwsh') or string.find(lower, 'powershell') then
    return '󰨊'
  elseif string.find(lower, 'cmd') then
    return ''
  elseif string.find(lower, 'wsl') or string.find(lower, 'ubuntu') or string.find(lower, 'bash') or string.find(lower, 'zsh') then
    return '󰌽'
  elseif string.find(lower, 'yazi') then
    return '󰇥'
  elseif string.find(lower, 'btop') or string.find(lower, 'top') then
    return '󰍛'
  elseif string.find(lower, 'vim') or string.find(lower, 'nvim') then
    return ''
  else
    return '󰆍'
  end
end

wezterm.on('format-tab-title', function(tab, tabs, panes, config_obj, hover, max_width)
  local is_active = tab.is_active
  local title = tab.active_pane.title
  if tab.tab_title and #tab.tab_title > 0 then
    title = tab.tab_title
  end

  local icon = get_process_icon(title)
  local tab_num = tostring(tab.tab_index + 1)

  -- 如果 title 已经自带 emoji (比如 ⚡ Zellij / 🤖 Pi Agent)，则不重复前缀图标
  local display_title = title
  if not string.match(title, '^[^\x00-\x7F]') then
    display_title = icon .. ' ' .. title
  end

  local num_color = is_active and '#cba6f7' or (hover and '#b4befe' or '#72678c')
  local text_color = is_active and '#f5eeff' or (hover and '#e0d4fc' or '#938aa9')

  -- 舒展呼吸感间距：前后对称留白，序号与标题分明
  return {
    { Foreground = { Color = num_color } },
    { Attribute = { Intensity = 'Bold' } },
    { Text = '  ' .. tab_num .. '  ' },
    { Foreground = { Color = text_color } },
    { Attribute = { Intensity = is_active and 'Bold' or 'Normal' } },
    { Text = display_title .. '   ' },
  }
end)

config.max_fps = 30

-- ============================ 5. 背景图与纯黑切换 ============================

-- 背景图片路径 (使用 wezterm.config_dir 确保无论在哪个工作目录下启动都能精准加载同级图片)
local CUSTOM_BG_IMAGE = wezterm.config_dir .. '/background.png'

local function get_background(show_image)
  if not show_image then
    -- 模式 1：静谧暗紫夜幕专注背景
    return {
      {
        source = { Color = '#1e192b' },
        height = '100%',
        width = '100%',
      },
    }
  end

  -- 模式 2：背景图 (叠加 0.85 深邃暗紫半透明遮罩，完美唤醒壁纸的紫色极光漫射)
  return {
    {
      source = { File = CUSTOM_BG_IMAGE },
      horizontal_align = 'Center',
    },
    {
      source = { Color = '#1e192b' },
      height = '120%',
      width = '120%',
      vertical_offset = '-10%',
      horizontal_offset = '-10%',
      opacity = 0.85,
    },
  }
end

-- 启动时默认为显示背景图
local show_bg_image = true
config.background = get_background(true)

-- 注册切换事件：在背景图与纯黑之间一键切换
wezterm.on('toggle-bg-image', function(window)
  show_bg_image = not show_bg_image
  window:set_config_overrides({
    background = get_background(show_bg_image),
  })
end)

-- ============================ 6. URL 识别规则 ============================

config.hyperlink_rules = {
  -- 匹配圆括号包裹的 URL: (URL)
  { regex = '\\((\\w+://\\S+)\\)', format = '$1', highlight = 1 },
  -- 匹配方括号包裹的 URL: [URL]
  { regex = '\\[(\\w+://\\S+)\\]', format = '$1', highlight = 1 },
  -- 匹配花括号包裹的 URL: {URL}
  { regex = '\\{(\\w+://\\S+)\\}', format = '$1', highlight = 1 },
  -- 匹配尖括号包裹的 URL: <URL>
  { regex = '<(\\w+://\\S+)>', format = '$1', highlight = 1 },
  -- 匹配常规独立 URL
  { regex = '\\b\\w+://\\S+[)/a-zA-Z0-9-]+', format = '$0' },
  -- 匹配邮箱 mailto
  { regex = '\\b\\w+@[\\w-]+(\\.[\\w-]+)+\\b', format = 'mailto:$0' },
}

-- 鼠标交互：Ctrl + 鼠标左键打开网页链接
config.mouse_bindings = {
  {
    event = { Up = { streak = 1, button = 'Left' } },
    mods = 'CTRL',
    action = act.OpenLinkAtMouseCursor,
  },
}

-- ============================ 7. 快捷键 ============================

config.keys = {
  -- 背景切换：Alt + / 一键切换 专属背景图 / 纯黑底色
  { key = '/', mods = 'ALT', action = act.EmitEvent('toggle-bg-image') },

  -- F1：激活 Vi 键盘复制模式 (Copy Mode)
  { key = 'F1', mods = 'NONE', action = act.ActivateCopyMode },

  -- F2：唤起命令面板 (Command Palette，类似 VSCode Ctrl+Shift+P)
  { key = 'F2', mods = 'NONE', action = act.ActivateCommandPalette },

  -- Alt + Ctrl + u：URL QuickSelect (全屏高亮所有链接，按字母一键打开)
  {
    key = 'u',
    mods = 'ALT|CTRL',
    action = act.QuickSelectArgs({
      label = 'Open URL',
      patterns = {
        '\\((https?://\\S+)\\)',
        '\\[(https?://\\S+)\\]',
        '\\{(https?://\\S+)\\}',
        '<(https?://\\S+)>',
        '\\bhttps?://\\S+[)/a-zA-Z0-9-]+',
      },
      action = wezterm.action_callback(function(window, pane)
        local url = window:get_selection_text_for_pane(pane)
        if url and url ~= '' then
          wezterm.open_with(url)
        end
      end),
    }),
  },

  -- 剪贴板交互
  { key = 'c', mods = 'CTRL|SHIFT', action = act.CopyTo('Clipboard') },
  { key = 'v', mods = 'CTRL|SHIFT', action = act.PasteFrom('Clipboard') },
  { key = 'v', mods = 'CTRL', action = act.PasteFrom('Clipboard') },
  { key = 'Insert', mods = 'SHIFT', action = act.PasteFrom('Clipboard') },

  -- 标签管理与切换 (工业标准 T/W 体系，支持 Ctrl+Shift+t/w 与 Alt+t/w)
  { key = 't', mods = 'CTRL|SHIFT', action = act.SpawnTab('DefaultDomain') },           -- Ctrl + Shift + t：新建标签页并进入
  { key = 'w', mods = 'CTRL|SHIFT', action = act.CloseCurrentTab({ confirm = false }) }, -- Ctrl + Shift + w：秒关当前标签页 (免确认)
  { key = 't', mods = 'ALT', action = act.SpawnTab('DefaultDomain') },                  -- Alt + t：单手新建标签页
  { key = 'w', mods = 'ALT', action = act.CloseCurrentTab({ confirm = false }) },      -- Alt + w：单手秒关当前标签页
  { key = '1', mods = 'ALT', action = act.ActivateTab(0) },                            -- Alt + 1：直达 Tab 1
  { key = '2', mods = 'ALT', action = act.ActivateTab(1) },                            -- Alt + 2：直达 Tab 2
  { key = '3', mods = 'ALT', action = act.ActivateTab(2) },                            -- Alt + 3：直达 Tab 3
  { key = '4', mods = 'ALT', action = act.ActivateTab(3) },                            -- Alt + 4：直达 Tab 4
  { key = 'Tab', mods = 'CTRL', action = act.ActivateTabRelative(1) },                 -- Ctrl + Tab：向后切换 Tab
  { key = 'Tab', mods = 'CTRL|SHIFT', action = act.ActivateTabRelative(-1) },           -- Ctrl + Shift + Tab：向前切换 Tab
  { key = 'Tab', mods = 'SHIFT', action = act.ActivateTabRelative(1) },
}

return config
