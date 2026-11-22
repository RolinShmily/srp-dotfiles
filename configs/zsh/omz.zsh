# zsh/omz.zsh - Oh My Zsh 插件与 Spaceship 主题配置

export ZSH="$HOME/.oh-my-zsh"

if [ -d "$ZSH" ]; then
    # Spaceship Prompt 主题配置
    SPACESHIP_PROMPT_ADD_NEWLINE=false
    SPACESHIP_PROMPT_FIRST_PREFIX_SHOW=false
    SPACESHIP_PROMPT_LAST_SUFFIX_SHOW=false

    if [ "$TERM_PROGRAM" != "WarpTerminal" ]; then
        ZSH_THEME="spaceship"
    fi

    # Oh My Zsh 插件列表
    plugins=(
        git
        zsh-autosuggestions
        zsh-syntax-highlighting
    )

    # 加载 Oh My Zsh
    source "$ZSH/oh-my-zsh.sh"
else
    # 未安装 Oh My Zsh（例如只部署了配置）。用发行版插件兜底，至少保住
    # 自动建议与语法高亮；别名和函数仍由其他模块提供。
    _srp_source_first() {
        local path
        for path in "$@"; do
            if [ -f "$path" ]; then
                source "$path"
                return 0
            fi
        done
        return 1
    }

    _srp_source_first \
        /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
        /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
    # 语法高亮必须最后加载
    _srp_source_first \
        /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
        /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
    unset -f _srp_source_first
fi
