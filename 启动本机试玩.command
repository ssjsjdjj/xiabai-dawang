#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '需要先安装 Node.js 20 或更新版本。'
  read -r '?按回车结束'
  exit 1
fi
printf '启动后，在浏览器打开 http://127.0.0.1:8765/preview.html\n保持这个终端窗口开启；按 Ctrl+C 停止服务。\n'
node server/index.js
