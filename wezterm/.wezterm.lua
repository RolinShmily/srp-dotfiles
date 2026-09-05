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

-- 完整启用 Windows 原生标题栏与缩放边框
config.window_decorations = 'TITLE | RESIZE'

-- 窗口内边距
config.window_padding = {
  left = 12,
  right = 12,
  top = 8,
  bottom = 6,
}

config.enable_tab_bar = false

config.max_fps = 30

-- ============================ 5. 背景图与纯黑切换 ============================

-- 背景图片路径 (使用 wezterm.config_dir 确保无论在哪个工作目录下启动都能精准加载同级图片)
local CUSTOM_BG_IMAGE = wezterm.config_dir .. '/background.png'

local function get_background(show_image)
  if not show_image then
    -- 模式 1：纯黑深色专注背景
    return {
      {
        source = { Color = '#1e1e2e' },
        height = '100%',
        width = '100%',
      },
    }
  end

  -- 模式 2：背景图 (叠加 0.93 暗色半透明遮罩)
  return {
    {
      source = { File = CUSTOM_BG_IMAGE },
      horizontal_align = 'Center',
    },
    {
      source = { Color = '#1e1e2e' },
      height = '120%',
      width = '120%',
      vertical_offset = '-10%',
      horizontal_offset = '-10%',
      opacity = 0.93,
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

  -- 标签管理 (备用)
  { key = 't', mods = 'CTRL|SHIFT', action = act.SpawnTab('DefaultDomain') },
  { key = 'w', mods = 'CTRL|SHIFT', action = act.CloseCurrentTab({ confirm = false }) },
  { key = 'Tab', mods = 'CTRL', action = act.ActivateTabRelative(1) },
  { key = 'Tab', mods = 'CTRL|SHIFT', action = act.ActivateTabRelative(-1) },
}

return config
