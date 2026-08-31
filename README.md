# 双人早睡家庭 App

一个面向两个人自用的早睡打卡应用。安卓端使用 React + Vite + Capacitor，后端使用 Go 标准库，数据直接保存为 JSON 文件，不需要数据库。手机号作为稳定用户 ID，当前私人版本暂不使用密码或短信验证码。

## 已实现

- 首次配置服务器后输入手机号；老用户直接恢复家庭，新用户再选择新建或通过邀请码加入。
- 手机号在一个后端内唯一，卸载重装或换手机后可重新签发成员令牌。
- 新建家庭或通过邀请码加入，家庭最多两个人。
- 创建者使用原始设计中的工作日/周末推荐分值和罚金开始。
- 一键按服务器当前时间打卡；手动补卡或修改在双人家庭中需要另一人确认后才生效，发起人可在确认前撤回。
- 记录页提供 5 分钟步进的就地编辑面板、待确认通知和同意/拒绝/撤回操作；尚未到达的睡觉日期不显示操作，当天未打卡时可直接按当前时间打卡。
- 每位成员每自然月可申请最多 2 次特殊情况豁免；记录页显示已通过、待确认和剩余额度。双人家庭需由对方确认，通过后当天按有效记录计入完成率，但为 0 分、0 罚金且不计入平均入睡时间。
- 实时计算双方的每日结果、个人与双人总分、等级、罚金、打卡天数、平均入睡时间和完成率；积分在现有时间档位之间按分钟平滑计算到一位小数，罚金仍按整档计算；本周完成率只统计截至今天应打卡的天数，历史周按实际周跨度计算。
- 周报完整展示本周折线、等级与奖励参考，并用一条紧凑卡片按相同星期进度对比上周积分和平均入睡时间；历史周使用摘要列表，按需展开单周详情。
- 设置中提供所有成员可查看的“奖励规则”和“等级说明”二级页面；奖励规则为 App 内置表格，不再由创建者编辑自由文本。
- 设置中可以修改当前成员的称呼；手机号继续作为只读身份 ID，头像自动使用称呼首字。
- 创建者可在设置的二级页面修改本周积分规则；普通成员可查看完整的具体档位，但不能修改。
- 计分规则保存后，本周记录立即重新计算。
- 打开 App 或新一周第一次写入时自动切换活动周，并归档有记录的上一周；历史归档冻结，不受后续改规则影响。
- 睡觉日期按“所属晚上”记录，凌晨截止前归到前一天；活动周从周日夜开始、到周六夜结束。旧版周一制家庭首次读取时会把边界周日记录自动移入新周，并把刚结束的旧周重算为周一至周六。
- 设置页每 30 天提示双方复盘一次计分与奖励规则；复盘页展示周期完成度、个人积分/罚金/豁免、平均入睡时间、前后 7 天趋势和完整周奖励参考，由创建者在共同复盘后开始新周期。复盘不生成账单或自动结算。
- 顶部显示同步中、离线或最后同步时间；App 进入后台后暂停轮询，重新回到前台时立即刷新。
- 设置中可以导出完整家庭 JSON 备份；创建者可恢复同一家庭、相同成员组成的备份，恢复时保留当前成员登录凭证。
- 底部“菜价”支持家庭商品与店铺搜索、单价/总价录入、重量和容量换算、优惠原价、品质星级、各店最新价、现场比价、分店独立统计、价格趋势，以及历史记录编辑、删除和撤销；菜价数据随家庭备份导出与恢复。
- 当前周和历史周都保存奖励规则版本；现行奖励首档要求至少 5 个有效记录日且达到 5 分，后续调整内置奖励数值不会改变旧周的奖励参考。
- 每个家庭一个 JSON 文件，写入采用临时文件替换并保留 `.bak` 备份。
- 健康检查接口：`GET /ping`。

## 目录

```text
early-sleep-family-app/
├── server/                  Go 后端源码
├── mobile/                  React + Capacitor 安卓源码
├── docs/                    设计书、API、原始规则
└── dist/
    ├── android/             可直接安装的 APK
    └── server/              Linux 后端可执行文件
```

## 直接使用

### 1. 在 Linux 服务器启动后端

根据服务器架构选择文件：

```bash
chmod +x dist/server/early-sleep-server-linux-amd64
mkdir -p updates/web updates/android
DATA_DIR=./data UPDATE_DIR=./updates LISTEN_ADDR=:8080 ./dist/server/early-sleep-server-linux-amd64
```

ARM64 服务器将文件名换为 `early-sleep-server-linux-arm64`。验证：

```bash
curl http://服务器地址:8080/ping
```

应返回：

```json
{"message":"pong"}
```

`UPDATE_DIR` 是 App 热更新资源目录，默认值为当前工作目录下的 `updates/`。目录不存在或尚未发布 `manifest.json` 时，业务接口仍可正常运行，更新地址返回 404。

### GitHub Actions 自动发布后端

仓库内的 [`.github/workflows/deploy-server.yml`](.github/workflows/deploy-server.yml) 会在 `main` 分支的 ARM64 Linux 后端包发生变化时自动发布，也可以在 GitHub Actions 页面手动运行。工作流通过 SSH 登录服务器，在 `/data/early-sleep-family-app` 执行 `git pull --ff-only origin main`，然后重启监听 `31080` 端口的 API 并检查 `/ping`。新版本启动失败时，会自动启动上一个健康版本。

先在 GitHub 仓库的 `Settings → Environments` 中创建 `production` 环境，再配置以下 Secrets：

- `DEPLOY_SSH_HOST`：服务器域名或 IP。
- `DEPLOY_SSH_USER`：部署用 SSH 用户。
- `DEPLOY_SSH_PRIVATE_KEY`：该用户的 SSH 私钥。
- `DEPLOY_SSH_KNOWN_HOSTS`：服务器的 `known_hosts` 记录；在可信电脑上运行 `ssh-keyscan -H 服务器地址` 获取并核对指纹后填写。非 22 端口使用 `ssh-keyscan -p 端口 -H 服务器地址`。
- `DEPLOY_SSH_PORT`：可选，默认 `22`。

`DEPLOY_SSH_PRIVATE_KEY` 对应的公钥需要加入服务器部署用户的 `~/.ssh/authorized_keys`。服务器中的仓库也必须能正常执行 `git pull origin main`，并且部署用户需要拥有 `/data/early-sleep-family-app` 的写权限。服务器还需要安装 `git`、`curl` 和 `procps`（提供 `pgrep`）。运行时 PID 和回退版本会保存在仓库下被 Git 忽略的 `.deploy-runtime/` 目录中，业务数据目录不会被替换。

以后发布后端只需先构建并提交对应 Linux 包：

```bash
make test server-linux
git add dist/server/early-sleep-server-linux-amd64 dist/server/early-sleep-server-linux-arm64
git commit -m "build: update Linux server"
git push origin main
```

### 2. 安装安卓 App

将 `dist/android/early-sleep-family-release.apk` 发送到安卓手机并允许“安装未知来源应用”。当前产物为 `1.3.0`（versionCode 6）正式 Release 包，已使用项目专用 RSA 4096 位证书签名，并内置自托管 Web 热更新客户端。

如果手机上安装的是旧 debug 签名版本，需要先卸载旧 App 再安装 Release 包；Android 不允许不同签名直接覆盖安装。家庭数据保存在后端，重新输入相同服务器地址和手机号即可恢复身份与数据。

首次打开填写后端地址：

- 安卓模拟器访问电脑：`http://10.0.2.2:8080`
- 同一局域网真机：`http://电脑局域网 IP:8080`
- 两个人异地使用：建议把后端放到有 HTTPS 的服务器，或通过 Tailscale 等私网访问。

填写服务器地址和手机号后点“继续”：手机号已存在会直接恢复原身份；不存在才会显示“新建家庭/加入家庭”。也可以先点“测试”单独验证 `/ping`。

> 当前 APK 为方便局域网自用，允许明文 HTTP。不要把 8080 端口直接裸露到公网；公网部署应使用 Nginx/Caddy 配置 HTTPS。

## 本地开发

后端要求 Go 1.25：

```bash
cd server
GOWORK=off go run ./cmd/server
GOWORK=off go test ./...
```

移动端要求 Node.js 22+ 与 pnpm：

```bash
cd mobile
pnpm install
pnpm dev
```

构建网页资源并同步 Android：

```bash
pnpm build
pnpm cap:sync
```

构建正式签名 APK：

```bash
pnpm run android:release
```

正式签名依赖本机的 `mobile/android/signing/early-sleep-release.jks` 和 `mobile/android/keystore.properties`。两者已从版本控制中排除；必须安全备份并在后续版本中继续使用，丢失后将无法覆盖升级已安装的 Release App。不要把签名密码或 keystore 上传到公开仓库。

如果服务器有固定域名，可以复制 `mobile/.env.production.example` 为 `mobile/.env.production`，把 `VITE_API_BASE_URL` 改成实际地址再构建。APK 首次启动会预填该地址，同时仍允许用户修改。

Android 原生构建还需要 JDK 21、Android SDK 36 和对应 Build Tools。

## 热更新资源服务

Go 后端直接通过 `/updates/` 对外提供更新资源，不需要额外安装 Nginx。当前自动部署脚本会创建 `/data/early-sleep-family-app/updates` 并将它传给 `UPDATE_DIR`；使用 systemd 示例时则配置为 `/opt/early-sleep/updates`。目录结构如下：

```text
/data/early-sleep-family-app/updates/
├── manifest.json
├── web/
│   └── web-1.2.4.zip
└── android/
    └── early-sleep-1.3.0.apk
```

`manifest.json` 示例：

```json
{
  "webVersion": "1.2.4",
  "bundleUrl": "/updates/web/web-1.2.4.zip",
  "sha256": "替换为 web-1.2.4.zip 的 SHA-256",
  "minimumNativeVersionCode": 5,
  "androidVersionCode": 6,
  "androidVersionName": "1.3.0",
  "androidUrl": "/updates/android/early-sleep-1.3.0.apk",
  "androidSha256": "替换为 APK 的 SHA-256",
  "publishedAt": "2026-08-31T12:00:00Z"
}
```

手机访问的地址为 `http(s)://服务器地址/updates/manifest.json`。该文件响应使用 `Cache-Control: no-store`，确保每次检查都能看到最新版本；带版本号的 ZIP、APK、签名和校验文件则使用长期不可变缓存，并支持断点下载。服务允许单次响应最多持续 5 分钟，避免较慢网络下载 APK 时被普通 API 的短超时中断。

每次发布先上传带版本号的 ZIP 或 APK，确认可以下载后再原子替换 `manifest.json`。服务只允许读取 `.json`、`.zip`、`.apk`、`.sha256` 和 `.sig` 文件，不提供目录列表，也不会暴露隐藏文件。更新检查和下载不要求登录。

从 `1.3.0` 开始，Android App 启动时会从用户已经配置的后端读取更新清单。发现更高的 `webVersion` 后，会显示更新状态、校验 SHA-256 并下载资源；下载完成后由用户点击“立即重启并更新”，App 会原地重新加载并切换到新版本。用户选择“稍后”时，已下载的资源会保留并在下次启动时再次提示；新资源未能正常启动时由原生插件自动回退。

只发布 React、TypeScript 或 CSS 热更新时，提高 `mobile/package.json` 的版本号后运行：

```bash
source ~/.nvm/nvm.sh
nvm use 22.22.1
make package-web-update
```

该命令只生成新的 Web ZIP 并更新清单，保留现有 APK 信息。涉及 Android 权限、Java、Capacitor 插件或其他原生改动时，同时提高 `mobile/android/app/build.gradle` 的 `versionCode` 和 `versionName`，再运行完整的 `make release`。发布脚本会同时生成签名 APK、Web ZIP 和清单。

## 数据与备份

后端默认把文件写入运行目录下的 `data/`，启动日志会输出解析后的绝对路径。生产运行时应把 `DATA_DIR` 显式设为绝对路径并定期备份，例如 `DATA_DIR=/srv/early-sleep/data`，避免从不同工作目录启动时误用另一份数据。每次更新某个家庭文件前，后端还会生成同名 `.bak` 文件。

App 内的“设置 → 导出与恢复”用于手工保存可移植 JSON 备份。备份包含手机号、家庭邀请码和完整习惯记录，但不包含可直接登录的成员令牌摘要；请只存放在可信位置。恢复仅允许创建者操作，并且只接受当前家庭及相同成员组成的备份。

设备上的成员令牌只存在 Android WebView 的本地存储中。清除 App 数据、卸载或换手机后，重新配置同一服务器并输入原手机号即可恢复原成员；后端会签发新令牌并使旧令牌失效。

当前阶段手机号未经短信验证，适用于两个人使用的可信私人服务器。任何知道手机号且能访问服务器的人都可能恢复该身份，因此不要把该版本直接开放到公网。后续接入短信验证码时，保留现有手机号和成员数据，只需在签发令牌前增加验证码校验。

完整业务取舍见 [docs/设计与实现说明.md](docs/设计与实现说明.md)，接口见 [docs/API.md](docs/API.md)。
