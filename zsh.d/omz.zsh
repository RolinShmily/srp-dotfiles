# zsh.d/omz.zsh - Oh My Zsh 插件与 Spaceship 主题配置

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
fi
