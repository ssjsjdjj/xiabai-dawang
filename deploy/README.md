# 单台服务器部署准备

模板尚未执行公网部署或 Docker 构建。先用本机或同 Wi-Fi 浏览器版验证玩法。

## 准备与启动

需要一台支持 Docker Engine / Compose 的服务器、已解析的域名和可达的80/443端口。微信端还需要小游戏 AppID、AppSecret 及 request 合法域名配置权限。

1. 上传项目源码，**不上传开发测试生成的玩家数据、锁文件和日志**。
2. 进入 `deploy`，复制 `.env.example` 为 `.env`，填写 `GAME_DOMAIN`。游客试玩保留默认登录配置。
3. 需要微信账号避重时填写 `WX_APPID`、`WX_APPSECRET`，设置 `REQUIRE_WECHAT_LOGIN=true`；小游戏 `config.js` 中同时设置 `useWechatLogin: true`。
4. 执行 `docker compose up -d --build`。Caddy 提供 HTTPS，游戏服务只在容器网络开放8765端口。
5. 查看 `docker compose ps`、`docker compose logs --tail=100`，访问 `https://你的域名/health` 检查版本。
6. `config.js` 设置 `serverBase: 'https://你的域名'`，完成微信后台域名配置和真机联调。严格登录模式下普通网页游客不能创建或加入房间。

不要把 AppSecret 写进 `config.js`、网页或小游戏发布包；`.env` 只放在服务器，限制文件访问权限，不要提交到源码库。

同源网页不需要额外 CORS 配置。确有其他网页来源时，在游戏容器环境变量设置 `ALLOWED_ORIGINS`，填写逗号分隔的完整来源。默认不接受任意跨域或 `file:` 来源。

## 持久记录与备份

游戏容器的 `/app/data` 使用 `game_data` 命名卷。记录文件为 `/app/data/players.json`，升级或重建容器均保留。每次开局先把整局题组写入每位玩家历史，写入失败则不发题。

更新前先停止游戏容器并备份历史，例如在 `deploy` 目录执行：

```sh
docker compose stop game
mkdir -p backups
docker compose cp game:/app/data/players.json ./backups/players.json
chmod 600 ./backups/players.json
docker compose up -d --build
```

备份包含不可公开的身份凭证。恢复时停止 game，使用 `docker compose cp ./backups/players.json game:/app/data/players.json`，检查文件属于容器内 node 用户且可读写，再启动服务。不要把 `.lock` 当作历史备份；服务异常终止后的失效锁会在确认进程已不存在时恢复。若容器重启后进程编号被复用，锁可能拒绝启动；先确认旧服务已停止，再只移除 `players.json.lock`，保留 `players.json`。

`docker compose down` 会停服。**不要使用 `down -v` 或删除 `game_data` 卷**，否则玩家避重历史与证书数据可能丢失。迁移服务器时需要一起迁移玩家文件或数据卷，并保持相同的小游戏 AppID；仅迁移源码不会带走历史。固定 Compose 项目名称或目录，避免改名创建全新的空数据卷。

## 运行限制

- 仅支持一个游戏服务实例。对局和成绩仍在内存中，重启会结束正在进行的房间；玩家历史保留。
- 房间分享链接只含房间码。服务默认不记录答案、AppSecret 或微信 session_key 到日志。
- 请求限额按直接连接 IP 统计，反向代理后的用户可能共享限额；公开运营前需完善代理和账号级限流。
- 游客身份不能跨浏览器识别同一个人。需要账号约束时启用微信严格登录，并实际验证同账号换设备的避重效果。
- 微信登录代码尚未用真实凭证联调，Docker 模板尚未构建实测。公开运营还需内容审核、举报、备份监测及运营支持。
