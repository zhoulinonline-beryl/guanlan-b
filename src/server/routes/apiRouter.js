const { readJsonBody, sendJson, okJson, errorJson } = require("../utils/http");

function createApiRouter(deps) {
  const {
    HOST,
    PORT,
    publicSettings,
    readAppSettings,
    writeAppSettings,
    clearRuntimeCache,
    loadPersistentCache,
    advisorChat,
    makeRequestId,
    redactLogText,
    readHoldingsStore,
    writeHoldingsStore,
    adminLogin,
    changeAdminPassword,
    extractAdminToken,
    publicAdminStatus,
    verifyAdminToken,
    analyzeHoldings,
    parseHoldingsImageWithKimi,
    enrichParsedHoldings,
    parsePortfolioHoldings,
    hasAiKey,
    analyzePortfolio,
    getStockNews,
    refreshRecommendations,
    getSectorNewsBatch,
    getQuote,
    marketOf,
    updateMarketSnapshot,
    snapshotFallback,
    getSectors,
    getIndices,
    getIndexKline,
    getStocks,
    getStockKline,
    getStockProfile,
    addTrackedStock,
    appendTrackingSample,
    readTrackingStore,
    removeTrackedStock,
    updateTrackingKlines,
    refreshTrackedStocks
  } = deps;

  function holdingsAuthStatus(req) {
    const store = readHoldingsStore();
    const hasHoldings = Boolean(store.holdings.length);
    const token = extractAdminToken(req);
    const authenticated = token ? verifyAdminToken(token) : false;
    return { store, hasHoldings, authenticated };
  }

  function requireHoldingsAccess(req) {
    const status = holdingsAuthStatus(req);
    if (status.hasHoldings && !publicAdminStatus().hasAdminPassword) {
      const error = new Error("管理员密码尚未初始化，请先在设置中创建管理员密码");
      error.statusCode = 401;
      error.code = "ADMIN_SETUP_REQUIRED";
      throw error;
    }
    if (status.hasHoldings && !status.authenticated) {
      const error = new Error("需要输入管理员密码后查看历史持股");
      error.statusCode = 401;
      error.code = "ADMIN_AUTH_REQUIRED";
      throw error;
    }
    return status;
  }

  function latestAdvisorUserText(messages = []) {
    return (Array.isArray(messages) ? messages : [])
      .filter((item) => item?.role === "user")
      .slice(-4)
      .map((item) => String(item.content || ""))
      .join("\n");
  }

  function isAdvisorHoldingsQuestion(messages = []) {
    const text = latestAdvisorUserText(messages);
    return Boolean(text.trim() && /我的|持仓|持股|仓位|成本|浮盈|浮亏|被套|解套|做T|做t|卖不卖|要不要卖|要不要加|加仓|减仓|补仓|清仓|调仓|组合|账户|股票池/.test(text));
  }

  const routes = [
    ["GET", "/api/admin/status", async ({ req }) => {
      const status = holdingsAuthStatus(req);
      return {
        data: {
          ...publicAdminStatus(),
          hasHoldings: status.hasHoldings,
          holdingsUpdatedAt: status.store.updatedAt,
          authenticated: status.authenticated || !status.hasHoldings
        }
      };
    }],
    ["POST", "/api/admin/login", async ({ req }) => {
      const body = await readJsonBody(req);
      const session = adminLogin(body.password || "");
      return { data: { ...session, ...publicAdminStatus() } };
    }],
    ["POST", "/api/admin/password", async ({ req }) => {
      const body = await readJsonBody(req);
      const status = changeAdminPassword(body.oldPassword || "", body.newPassword || "");
      return { data: status };
    }],
    ["GET", "/api/settings", async () => ({ data: publicSettings() })],
    ["POST", "/api/settings", async ({ req }) => {
      const body = await readJsonBody(req);
      const current = readAppSettings();
      const settings = writeAppSettings({
        aiProvider: body.aiProvider,
        apiUrl: body.apiUrl,
        ocrApiUrl: body.ocrApiUrl,
        textModel: body.textModel,
        visionModel: body.visionModel,
        kimiApiUrl: body.kimiApiUrl,
        kimiModel: body.kimiModel,
        kimiVisionModel: body.kimiVisionModel,
        advisorModel: body.advisorModel,
        advisorRole: body.advisorRole,
        advisorStyle: body.advisorStyle,
        modelQpm: body.modelQpm,
        marketDataSource: body.marketDataSource,
        apiKey: String(body.apiKey || body.kimiApiKey || "").trim() ? (body.apiKey || body.kimiApiKey) : "__KEEP__",
        useCache: body.useCache
      });
      if (current.useCache && !settings.useCache) {
        clearRuntimeCache();
      } else if (!current.useCache && settings.useCache) {
        loadPersistentCache();
      }
      return { data: publicSettings(settings) };
    }],
    ["POST", "/api/advisor-chat", async ({ req, res }) => {
      const body = await readJsonBody(req);
      try {
        const holdingsAuth = holdingsAuthStatus(req);
        if (holdingsAuth.hasHoldings && !holdingsAuth.authenticated && isAdvisorHoldingsQuestion(body.messages || [])) {
          return {
            data: {
              role: "assistant",
              content: "没有管理员授权，暂时不能读取我的持股数据。请先完成管理员密码验证。",
              holdingsAuthRequired: true,
              holdingsContextUsed: false,
              holdingsContextCount: 0
            }
          };
        }
        const data = await advisorChat(body.messages || [], body.contexts || body.context || [], {
          holdingsAuthorized: holdingsAuth.authenticated || !holdingsAuth.hasHoldings,
          deepThinking: Boolean(body.deepThinking)
        });
        return { data };
      } catch (error) {
        const log = error.advisorLog || {
          requestId: makeRequestId("advisor"),
          stage: "api-handler",
          message: error.message,
          stack: redactLogText(error.stack || "")
        };
        console.error("[advisor-chat-failed]", JSON.stringify(log));
        sendJson(res, 200, { ok: false, error: error.message, log, updatedAt: new Date().toISOString() });
        return { handled: true };
      }
    }],
    ["GET", "/api/holdings", async ({ req, url }) => {
      const { store } = requireHoldingsAccess(req);
      const withNews = url.searchParams.get("news") === "1";
      const data = await analyzeHoldings(store.holdings, { parser: store.holdings.length ? (withNews ? "saved+ai" : "saved+fast") : "saved", withNews });
      return { data: { ...data, savedAt: store.updatedAt } };
    }],
    ["POST", "/api/holdings/import-image", async ({ req }) => {
      requireHoldingsAccess(req);
      const body = await readJsonBody(req);
      const parsed = await parseHoldingsImageWithKimi(body.imageData || "");
      const enriched = await enrichParsedHoldings(parsed);
      const store = writeHoldingsStore(enriched);
      const data = await analyzeHoldings(store.holdings, { parser: "ai-ocr", withNews: false });
      return { data: { ...data, savedAt: store.updatedAt } };
    }],
    ["POST", "/api/holdings/import-text", async ({ req }) => {
      requireHoldingsAccess(req);
      const body = await readJsonBody(req);
      const parsed = await parsePortfolioHoldings(body.text || "");
      const store = writeHoldingsStore(parsed);
      const data = await analyzeHoldings(store.holdings, { parser: hasAiKey() ? "ai+rules" : "rules", withNews: false });
      return { data: { ...data, savedAt: store.updatedAt } };
    }],
    ["DELETE", "/api/holdings", async ({ req }) => {
      requireHoldingsAccess(req);
      const store = writeHoldingsStore([]);
      return { data: { rows: [], summary: null, parser: "saved", savedAt: store.updatedAt } };
    }],
    ["POST", "/api/portfolio/analyze", async ({ req }) => {
      const body = await readJsonBody(req);
      const data = await analyzePortfolio(body.text || "");
      return { data };
    }],
    ["GET", "/api/news", async ({ url }) => {
      const code = url.searchParams.get("code");
      const name = url.searchParams.get("name");
      if (!code) throw new Error("缺少 code 参数");
      const data = await getStockNews(code, name, 10);
      return { data };
    }],
    ["GET", "/api/profile", async ({ url }) => {
      const code = url.searchParams.get("code");
      const name = url.searchParams.get("name");
      if (!code) throw new Error("缺少 code 参数");
      const data = await getStockProfile(code, Number(url.searchParams.get("market") || marketOf(code)), name);
      return { data };
    }],
    ["GET", "/api/tracking", async () => ({ data: readTrackingStore() })],
    ["POST", "/api/tracking", async ({ req }) => {
      const body = await readJsonBody(req);
      const code = String(body.code || "").trim();
      if (!code) throw new Error("缺少 code 参数");
      const market = Number.isFinite(Number(body.market)) ? Number(body.market) : marketOf(code);
      addTrackedStock({
        code,
        name: body.name,
        market
      });
      try {
        const quote = await getQuote(code, market);
        appendTrackingSample(code, quote);
        const quoteMarket = Number.isFinite(Number(quote.market)) ? Number(quote.market) : market;
        const kline = await getStockKline(code, quoteMarket).catch(() => null);
        if (kline?.klines?.length) updateTrackingKlines(code, kline.klines.slice(-7));
      } catch {
        // 添加追踪不因首条行情采样失败而失败，后台刷新会继续补。
      }
      return { data: readTrackingStore() };
    }],
    ["DELETE", "/api/tracking", async ({ url }) => {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("缺少 code 参数");
      return { data: removeTrackedStock(code) };
    }],
    ["POST", "/api/tracking/refresh", async () => {
      await refreshTrackedStocks({ reason: "manual" });
      return { data: readTrackingStore() };
    }],
    ["GET", "/api/recommendations", async ({ url }) => {
      const force = url.searchParams.get("force") === "1";
      const cache = await refreshRecommendations({ force });
      return {
        data: cache.data,
        extra: {
          status: cache.status,
          error: cache.error,
          refreshedAt: cache.refreshedAt,
          nextRefreshAt: cache.nextRefreshAt,
          updatedAt: cache.refreshedAt || new Date().toISOString()
        }
      };
    }],
    ["GET", "/api/sector-news", async ({ url }) => {
      const names = (url.searchParams.get("names") || "")
        .split(",")
        .map((item) => decodeURIComponent(item).trim())
        .filter(Boolean);
      if (!names.length) throw new Error("缺少 names 参数");
      const data = await getSectorNewsBatch(names);
      return { data };
    }],
    ["GET", "/api/quote", async ({ url }) => {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("缺少 code 参数");
      let data;
      try {
        data = await getQuote(code, Number(url.searchParams.get("market") || marketOf(code)));
        updateMarketSnapshot("quote", code, data);
      } catch (error) {
        data = snapshotFallback("quote", code);
        if (!data) throw error;
        data = { ...data, snapshotFallback: true };
      }
      return { data };
    }],
    ["GET", "/api/sectors", async ({ url }) => {
      let data;
      try {
        data = await getSectors(Number(url.searchParams.get("window") || 5));
        updateMarketSnapshot("sectors", "", data);
      } catch (error) {
        data = snapshotFallback("sectors");
        if (!data) throw error;
        data = data.map((item) => ({ ...item, snapshotFallback: true }));
      }
      return { data };
    }],
    ["GET", "/api/indices", async () => {
      let data;
      try {
        data = await getIndices();
        updateMarketSnapshot("indices", "", data);
      } catch (error) {
        data = snapshotFallback("indices");
        if (!data) throw error;
        data = data.map((item) => ({ ...item, snapshotFallback: true }));
      }
      return { data };
    }],
    ["GET", "/api/index-kline", async ({ url }) => {
      const symbol = url.searchParams.get("symbol");
      if (!symbol) throw new Error("缺少 symbol 参数");
      const data = await getIndexKline(symbol);
      return { data };
    }],
    ["GET", "/api/stocks", async ({ url }) => {
      const board = url.searchParams.get("board");
      if (!board) throw new Error("缺少 board 参数");
      let data;
      try {
        data = await getStocks(board, Number(url.searchParams.get("window") || 5));
        updateMarketSnapshot("stocks", board, data);
      } catch (error) {
        data = snapshotFallback("stocks", board);
        if (!data) throw error;
        data = data.map((item) => ({ ...item, snapshotFallback: true }));
      }
      return { data };
    }],
    ["GET", "/api/kline", async ({ url }) => {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("缺少 code 参数");
      let data;
      try {
        data = await getStockKline(code, Number(url.searchParams.get("market") || marketOf(code)));
        updateMarketSnapshot("kline", code, data);
      } catch (error) {
        data = snapshotFallback("kline", code);
        if (!data) throw error;
        data = { ...data, snapshotFallback: true };
      }
      return { data };
    }]
  ].map(([method, pathname, handler]) => ({ method, pathname, handler }));

  return async function handleApi(req, res) {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const route = routes.find((item) => item.method === req.method && item.pathname === url.pathname);
    if (!route) {
      sendJson(res, 404, { ok: false, error: "API 不存在" });
      return;
    }
    try {
      const result = await route.handler({ req, res, url });
      if (result?.handled) return;
      okJson(res, result?.data, result?.extra || {});
    } catch (error) {
      errorJson(res, error.statusCode || 502, error, error.code ? { code: error.code } : {});
    }
  };
}

module.exports = {
  createApiRouter
};
