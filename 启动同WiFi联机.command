#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '需要先安装 Node.js 20 或更新版本。'
  read -r '?按回车结束'
  exit 1
fi
printf '让所有玩家连同一个 Wi-Fi，并打开 http://这台电脑的局域网IP:8765/preview.html\n请在系统网络设置中查看本机IP；保持终端窗口开启。\n'
HOST=0.0.0.0 node server/index.js
