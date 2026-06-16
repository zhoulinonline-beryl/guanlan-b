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
    getStockProfile
  } = deps;

  const routes = [
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
        const data = await advisorChat(body.messages || [], body.contexts || body.context || []);
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
    ["GET", "/api/holdings", async ({ url }) => {
      const store = readHoldingsStore();
      const withNews = url.searchParams.get("news") === "1";
      const data = await analyzeHoldings(store.holdings, { parser: store.holdings.length ? (withNews ? "saved+ai" : "saved+fast") : "saved", withNews });
      return { data: { ...data, savedAt: store.updatedAt } };
    }],
    ["POST", "/api/holdings/import-image", async ({ req }) => {
      const body = await readJsonBody(req);
      const parsed = await parseHoldingsImageWithKimi(body.imageData || "");
      const enriched = await enrichParsedHoldings(parsed);
      const store = writeHoldingsStore(enriched);
      const data = await analyzeHoldings(store.holdings, { parser: "ai-ocr", withNews: false });
      return { data: { ...data, savedAt: store.updatedAt } };
    }],
    ["POST", "/api/holdings/import-text", async ({ req }) => {
      const body = await readJsonBody(req);
      const parsed = await parsePortfolioHoldings(body.text || "");
      const store = writeHoldingsStore(parsed);
      const data = await analyzeHoldings(store.holdings, { parser: hasAiKey() ? "ai+rules" : "rules", withNews: false });
      return { data: { ...data, savedAt: store.updatedAt } };
    }],
    ["DELETE", "/api/holdings", async () => {
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
      errorJson(res, 502, error);
    }
  };
}

module.exports = {
  createApiRouter
};
