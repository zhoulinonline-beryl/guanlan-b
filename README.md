# 观澜

> A Stock Radar，一个面向 A 股短线观察的本地化股票雷达系统。

观澜会聚合 A 股大盘指数、板块主力资金、板块 Top10/Bottom10、个股 K 线与技术指标、新闻政策、持仓截图识别和大模型讨论能力，用于辅助判断主力可能进攻方向、候选建仓标的和持仓操作节奏。

> 风险提示：本项目仅用于行情观察与交易分析辅助，不构成投资建议，不承诺收益。真实交易请自行判断并控制风险。

## 核心功能

- **全景雷达**
  - 展示 A 股大盘主要指数。
  - 展示板块行情，并按主力资金方向排序。
  - 支持按主力占比、主力流入速度、主力离场速度排序。
  - 自动刷新只在 A 股交易日开盘时段生效。

- **板块 Top10 / Bottom10**
  - 点击首页板块后弹出该板块股票雷达。
  - 展示主力净额 Top10、Bottom10。
  - 头部展示当前最有机会买入 Top5。
  - 支持按主力占比、流入速度、离场速度排序。

- **股票详情**
  - 展示报价、成交额、换手、市值、主力资金等信息。
  - 集成 K 线、MACD、SAR、BOLL。
  - 给出操作建议、关键价位、止损、目标位和建议解释。
  - 展示相关政策/新闻 Top3 与引用来源。
  - 支持一键加入“个股讨论”，把当前股票行情、K 线、指标、建议和新闻作为上下文传给观澜理财师。

- **股票推荐**
  - 后台每 15 分钟在交易时段扫描一次全板块候选。
  - 展示 Top20 最适合建仓股票，推荐主力方向明显、技术面允许建仓的候选。
  - 买入机会分结合板块强度、主力净额、主力占比、流入/离场速度、MACD、SAR 等因素。

- **我的持股**
  - 支持上传持股截图。
  - 使用已配置的视觉模型识别股票名称、成本价、持有数量。
  - 基于当前最新价、成本价和持有数量分析盈亏、仓位、做 T 档位和风险。
  - 如果本地已经保存过历史持股，进入页面前需要输入管理员密码解锁。

- **个股讨论**
  - 支持使用 Kimi 国内版、Kimi 国际版、DeepSeek、MiniMax、GLM 作为观澜理财师。
  - 可讨论股票、板块、持仓、做 T、新闻政策和建仓计划。
  - 自动调用应用内行情、板块、推荐池、持仓、K 线、新闻等上下文。
  - 当模型反问时，支持多选快捷回复。
  - 调用失败时返回完整失败日志，便于排查 AK、网络、模型或接口问题。

- **设置**
  - 支持配置模型供应商、API 地址、文本模型、视觉模型、观澜理财师模型。
  - 支持配置观澜理财师角色与回复风格。
  - 支持修改管理员密码；修改前必须验证原管理员密码。
  - 支持手动切换行情数据源：自动兜底、腾讯、东方财富、新浪/搜狐。
  - 支持持久化缓存策略，历史行情、新闻政策和分析结果可优先从缓存读取。

## 数据与模型

主要数据来源：

- 腾讯行情接口：个股实时行情。
- 东方财富接口：板块资金、指数、K 线等。
- Kimi 国内版/Moonshot CN、Kimi 国际版/Moonshot AI、DeepSeek、MiniMax、GLM：新闻政策总结、持仓文本解析、个股讨论。
- OCR：Kimi 使用 `kimi-k2.6` 视觉能力；DeepSeek 预留 `deepseek-ocr`；MiniMax 使用 `MiniMax-VL-01`；GLM 使用专用 `glm-ocr` layout parsing 接口。

默认模型：

- 默认供应商：`kimi-cn`
- 文本/联网分析模型：`kimi-k2.6`
- 视觉识别模型：`kimi-k2.6`
- 观澜理财师：`kimi-k2.6`

其它供应商默认模型：

- DeepSeek：`deepseek-v4-flash`，OCR 预设 `deepseek-ocr`
- MiniMax：`MiniMax-M3`，OCR 预设 `MiniMax-VL-01`
- GLM：`glm-5.1`，OCR 预设 `glm-ocr`

Kimi API 版本：

- `kimi-cn`：国内版，默认地址 `https://api.moonshot.cn/v1/chat/completions`
- `kimi-intl`：国际版，默认地址 `https://api.moonshot.ai/v1/chat/completions`
- 设置页和安装脚本都允许手工修改 API 地址。

## 项目结构

```text
.
├── assets/
│   └── guanlan-icon.png
├── data/
│   └── settings.example.json
├── src/
│   ├── analytics.js
│   ├── app.js
│   └── data.js
├── deploy-aliyun-ecs.sh
├── install-macos.sh
├── index.html
├── server.js
└── styles.css
```

运行时会自动生成 `data/settings.json`、`data/cache.json`、`data/holdings.json`、`data/admin.json`。这些文件可能包含 AK、缓存、持仓信息和管理员密码哈希，不建议提交到 GitLab。

首次启动时会额外生成 `data/market-snapshot.json`，用于保存最新大盘、板块和部分股票数据；当某个实时行情源暂时不可用时，接口会尝试使用这份快照兜底，避免首页首次启动空白。

## 本地运行

要求：

- Node.js 18 或更高版本，推荐 Node.js 20 LTS。
- macOS、Linux 或阿里云 ECS。

启动：

```bash
node server.js
```

默认地址：

```text
http://127.0.0.1:5173
```

## macOS 一键安装

在项目根目录执行：

```bash
chmod +x install-macos.sh
./install-macos.sh
```

安装脚本会引导你输入：

- 模型供应商：通过 1-5 编号选择 `kimi-cn` / `kimi-intl` / `deepseek` / `minimax` / `glm`，脚本会回显已选择的供应商
- 对应供应商 AK（安装时为明文输入，会直接显示在终端，便于确认粘贴完整；请避免在共享屏幕或公共终端中输入）
- 对应供应商 API 地址、文本模型、视觉模型、理财师模型
- 行情数据源：`auto` / `tencent` / `eastmoney` / `sina`
- 是否启用缓存
- 是否创建 macOS LaunchAgent 开机自启

安装完成后可访问：

```text
http://127.0.0.1:5173
```

常用命令：

```bash
# 启动
launchctl load ~/Library/LaunchAgents/com.guanlan.stockradar.plist

# 停止
launchctl unload ~/Library/LaunchAgents/com.guanlan.stockradar.plist

# 查看日志
tail -f ~/Library/Logs/guanlan/guanlan.out.log
tail -f ~/Library/Logs/guanlan/guanlan.err.log

# 手动运行
cd ~/Applications/guanlan-stock-radar
node server.js
```

## 阿里云 ECS 部署

项目内置 ECS 部署脚本，逻辑与 macOS 安装脚本保持一致，会引导你设置管理员密码、选择模型供应商、输入对应 AK、选择行情源和缓存策略，然后自动安装 Node.js、Nginx，创建 systemd 服务并配置反向代理。

```bash
sudo bash deploy-aliyun-ecs.sh
```

### ECS 购买建议

个人或小团队使用：

- 实例规格：2 vCPU / 4 GB 内存起步。
- 系统盘：ESSD 40 GB 起步。
- 带宽：按固定带宽 3-5 Mbps 起步，或按流量计费。
- 系统：Ubuntu 22.04 LTS、Ubuntu 24.04 LTS 或 Alibaba Cloud Linux 3。
- 地域：尽量选择离主要使用者近的地域；如使用大陆地域和域名访问，需要 ICP 备案。

更稳妥的生产配置：

- 实例规格：2 vCPU / 8 GB 内存。
- 系统盘：ESSD 80 GB。
- 带宽：5 Mbps 或更高。
- 适合：多人同时使用、频繁 OCR、新闻/模型调用较多。

### 安全组建议

至少开放：

- `22`：SSH，建议只允许你的固定 IP。
- `80`：HTTP 访问。
- `443`：HTTPS 访问，后续配置证书时使用。

不要开放：

- `5173`：Node 服务只监听 `127.0.0.1`，由 Nginx 反向代理即可。
- 数据库端口：当前应用不需要外部数据库。

### 部署步骤

1. 登录 ECS。

```bash
ssh root@你的服务器公网IP
```

2. 上传或拉取代码到服务器。

```bash
git clone https://gitlab.com/kawa-group/GuanlanRadar.git /root/GuanlanRadar
cd /root/GuanlanRadar
```

如果使用压缩包上传，也可以解压后进入项目根目录。

3. 执行部署脚本。

```bash
sudo bash deploy-aliyun-ecs.sh
```

脚本会引导你输入：

- 管理员密码：用于保护历史持股数据，必须设置，至少 6 位；未设置则安装/部署会终止
- 模型供应商：通过 1-5 编号选择 `kimi-cn` / `kimi-intl` / `deepseek` / `minimax` / `glm`，脚本会回显已选择的供应商
- 对应供应商 AK（明文输入，便于确认粘贴完整）
- API 地址、OCR 地址、文本模型、OCR 模型、理财师模型
- 行情数据源：`auto` / `tencent` / `eastmoney` / `sina`
- 是否启用缓存

部署脚本会把管理员密码哈希写入 `data/admin.json`。后续在设置页修改管理员密码后，重新执行 ECS 部署脚本会保留服务器上的 `data/` 目录，避免覆盖已持久化的新密码、持仓、缓存和设置。

4. 访问服务。

如果未绑定域名：

```text
http://服务器公网IP/
```

如果已设置 `DOMAIN`：

```bash
DOMAIN=radar.example.com sudo bash deploy-aliyun-ecs.sh
```

访问：

```text
http://radar.example.com/
```

### ECS 常用运维命令

```bash
# 查看服务状态
systemctl status guanlan-stock-radar

# 查看应用日志
journalctl -u guanlan-stock-radar -f

# 重启应用
systemctl restart guanlan-stock-radar

# 检查 Nginx
nginx -t
systemctl reload nginx

# 查看部署目录
cd /opt/guanlan-stock-radar
```

### HTTPS 建议

正式使用建议配置 HTTPS。可以在阿里云申请免费证书，或使用 `certbot` 配置 Let's Encrypt。配置 HTTPS 前请确认：

- 域名已解析到 ECS 公网 IP。
- 大陆地域域名已完成 ICP 备案。
- 安全组已开放 `443`。

如使用大陆地域和域名访问，请先完成 ICP 备案。

## GitLab 发布建议

推荐仓库设置：

```text
guanlan-stock-radar
```

建议不要提交以下敏感或本地状态文件：

```text
.env
.env.local
data/settings.json
data/cache.json
data/holdings.json
data/admin.json
node_modules/
```

如果需要提供示例配置，可以提交：

```text
data/settings.example.json
```

## 环境变量

服务会读取 `.env.local` 或 `.env`。

常见配置：

```bash
PORT=5173
AI_PROVIDER=kimi-cn
AI_API_KEY=sk-xxx
AI_API_URL=https://api.moonshot.cn/v1/chat/completions
AI_OCR_API_URL=
AI_TEXT_MODEL=kimi-k2.6
AI_VISION_MODEL=kimi-k2.6
ADVISOR_MODEL=kimi-k2.6
NODE_ENV=production
```

说明：`install-macos.sh` 和 `deploy-aliyun-ecs.sh` 会强制设置管理员密码，并写入 `data/admin.json` 的哈希值；也会先通过编号选择模型供应商，再明文输入对应 AK，便于确认供应商和密钥没有填错。脚本会把 AK 写入 `.env.local` 和 `data/settings.json`，并设置为仅当前用户可读写。ECS 脚本同步应用文件时会排除服务器端 `data/` 目录，保护设置页里已经修改过的管理员密码和持久化数据。

## 缓存策略

设置页和安装脚本都支持选择是否启用缓存。

启用缓存后：

- 历史行情、新闻政策、AI 分析结果会写入 `data/cache.json`。
- 重复查询会优先读取缓存，减少等待和模型调用成本。

关闭缓存后：

- 应用尽量实时请求数据源。
- 适合调试、验证数据新鲜度或排查新闻来源。

## 行情数据源

设置页可以手动选择优先数据源：

- `auto`：自动兜底，推荐日常使用。
- `tencent`：个股报价和 K 线优先腾讯行情。
- `eastmoney`：板块资金、成分股和 K 线优先东方财富。
- `sina`：报价和 K 线优先新浪，板块优先搜狐。

无论选择哪一种，接口失败后仍会继续尝试其它数据源。若所有实时源都失败，会尝试读取 `data/market-snapshot.json` 中的启动快照。

## 自动刷新规则

自动刷新只在 A 股交易日开盘时段生效：

- 9:15-11:30
- 13:00-15:00

周末和 2026 年上交所公告休市日不会触发自动刷新。手动点击刷新不受限制。

## 故障排查

### 个股讨论调用失败

前端会显示“完整调用失败日志”，包含：

- requestId
- stage
- model
- apiUrl
- hasApiKey
- messageCount
- contextCount
- attempts
- lastError

服务端也会打印：

```text
[advisor-chat-failed] {...}
```

常见原因：

- 当前模型供应商 AK 未配置或失效。
- API 地址和 AK 平台不匹配。
- 本机网络无法访问对应模型供应商。
- 模型名不支持当前 API 地址。
- 请求上下文过大导致接口拒绝。

### 行情为空或板块不刷新

- 确认当前是否为 A 股交易时段。
- 手动点击刷新可绕过自动刷新时段限制。
- 检查终端日志和浏览器控制台。

## License

内部自用项目。发布到 GitLab 前请根据团队要求补充许可证信息。
