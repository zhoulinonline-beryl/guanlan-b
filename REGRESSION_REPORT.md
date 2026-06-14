# 观澜回归测试报告

测试时间：2026-06-14 18:21-18:25（Asia/Shanghai）

测试对象：服务端重构后的观澜应用

测试地址：`http://127.0.0.1:5193`

测试结论：通过。核心行情、板块、个股、推荐池、持仓分析、观澜理财师、静态资源、错误兜底和响应式渲染均完成验证，未发现阻断性问题。

## 测试范围

- 服务启动与市场快照预热
- 服务端与前端 JavaScript 语法检查
- 首页静态资源加载
- A 股大盘指数、板块行情、个股报价、K 线
- 板块 Top/Bottom 股票列表数据
- 股票推荐池读取与强制刷新
- 个股新闻、板块新闻政策接口
- 我的持股读取、文本导入、组合分析
- 观澜理财师 Kimi 对话与持仓上下文注入
- API 错误路径：缺参、未知接口
- 桌面和手机视口页面渲染、横向溢出、控制台错误

## 执行命令

```bash
/Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check server.js
find src/server -type f -name '*.js' -print0 | xargs -0 -n1 /Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check
/Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check src/app.js
/Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check src/data.js
/Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check src/analytics.js
PORT=5193 /Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
BASE_URL=http://127.0.0.1:5193 /Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/regression-smoke.js
RUN_EXTENDED=1 BASE_URL=http://127.0.0.1:5193 /Users/kawa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/regression-smoke.js
```

## 结果摘要

| 项目 | 结果 | 关键结果 |
| --- | --- | --- |
| 服务端语法检查 | 通过 | `server.js` 与 `src/server/**/*.js` 均通过 |
| 前端语法检查 | 通过 | `src/app.js`、`src/data.js`、`src/analytics.js` 均通过 |
| 服务启动 | 通过 | 服务启动于 `127.0.0.1:5193`，市场快照存在 |
| 核心冒烟 | 通过 | 8 项全部通过 |
| 扩展冒烟 | 通过 | 12 项全部通过 |
| 补充 API 验证 | 通过 | 8 项全部通过 |
| 浏览器渲染验证 | 通过 | 桌面/手机均无控制台错误、无横向溢出 |
| 数据恢复 | 通过 | 写入类测试后已恢复原设置与原持仓 |

## 核心冒烟明细

| 检查项 | 结果 | 耗时 | 说明 |
| --- | --- | ---: | --- |
| settings | 通过 | 20ms | `marketDataSource=auto`，`useCache=true` |
| indices | 通过 | 215ms | 返回 8 个指数，首项上证指数，来源腾讯 |
| sectors | 通过 | 590ms | 返回 193 个板块，来源东方财富 |
| quote | 通过 | 61ms | 贵州茅台报价成功，来源腾讯 |
| kline | 通过 | 252ms | 返回 120 条 K 线，来源腾讯 |
| stocks | 通过 | 164ms | `BK0478` 返回 80 只股票 |
| recommendations | 通过 | 2080ms | 推荐池 `ready`，20 条 |
| holdings | 通过 | 1433ms | 原持仓 4 条，解析器 `saved+kimi` |

## 扩展冒烟明细

| 检查项 | 结果 | 耗时 | 说明 |
| --- | --- | ---: | --- |
| index-kline | 通过 | 375ms | 上证指数 14 条趋势数据，来源腾讯 |
| stock-news | 通过 | 22427ms | 接口成功返回数组，本轮强相关新闻为 0 条 |
| sector-news | 通过 | 495ms | 有色金属 0 条，电力设备 2 条 |
| advisor-chat | 通过 | 2709ms | 模型 `kimi-k2.5`，已注入持仓上下文 |

## 补充验证明细

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| static-index | 通过 | 首页返回 200，包含应用入口 |
| static-assets | 通过 | CSS、前端 JS、图标均返回 200 |
| settings-save-keep-key | 通过 | 设置保存成功，AK 不在公开响应中返回 |
| portfolio-analyze-post | 通过 | 文本组合分析返回 2 条持仓 |
| holdings-import-text-write | 通过 | 持仓文本导入写入成功，随后已恢复原文件 |
| recommendations-force-refresh | 通过 | 强制刷新后推荐池 `ready`，20 条 |
| quote-missing-code-error | 通过 | 缺少 `code` 返回 502 与明确错误 |
| unknown-api-404 | 通过 | 未知 API 返回 404 |

## 浏览器渲染验证

桌面默认视口：

- 页面标题：`观澜`
- 关键内容：`观澜`、`全景雷达`、`A 股大盘`、`个股讨论`、`设置`
- 卡片/数据元素：17 个
- 横向溢出：无
- 控制台错误：无

手机视口 `390x844`：

- 页面标题：`观澜`
- 关键内容：`全景雷达`、`A 股大盘`、`个股讨论`、`设置`
- 卡片/数据元素：17 个
- 横向溢出：无
- 控制台错误：无
- 说明：手机视口下侧边栏品牌文字不在可见正文样本中，但页面标题和核心导航正常，属于响应式布局行为。

## 数据保护

写入类接口验证前已备份：

- `data/settings.json`
- `data/holdings.json`

验证后已恢复并确认：

- 设置仍为 `marketDataSource=auto`、`useCache=true`
- 持仓仍为 4 条
- 持仓更新时间仍为 `2026-06-13T13:21:57.239Z`

## 非阻塞观察

1. 个股新闻接口本轮耗时较长，约 22 秒，且贵州茅台最近强相关新闻返回 0 条。接口本身已容错，不影响股票详情页加载，但后续可考虑增加更稳定的新闻源或更短超时策略。
2. `assets/guanlan-icon.png` 当前约 1.6MB。功能可用，但作为首页静态资源偏大，后续可压缩一份用于 Web 展示，保留高清图作为源文件。

## 建议

- 将 `scripts/regression-smoke.js` 保留为每次部署前的基础回归脚本。
- 后续可以增加一个 `scripts/regression-full.js`，把本次补充验证固化为可重复执行的完整回归。
- 新闻接口建议继续做多源聚合和缓存命中率优化，降低外部源慢响应对体验的影响。
