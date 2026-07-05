const crypto = require("crypto");
const {
  calculateConcentration,
  buildIndustryDistribution,
  attachPercentiles,
  attachChanges,
  buildTrendSummary,
  buildPossibilities
} = require("./concentration");
const {
  listRecords,
  getRecord,
  putRecord,
  loadMemoryCache,
  isMemoryCacheExpired,
  memoryCacheStats
} = require("./concentrationHistoryStore");
const { chinaMarketNow } = require("../utils/time");

function createConcentrationService({ getAllAshares, getIndices, hasAiKey, kimiJson }) {
  const runtimeCache = {
    current: null,
    updatedAt: 0,
    loading: false,
    source: "",
    isRealtime: true,
    sampleCount: 0
  };

  function shanghaiDate(now = new Date()) {
    return chinaMarketNow(now).date;
  }

  function runtimeCacheExpired() {
    if (!runtimeCache.updatedAt) return true;
    return isMemoryCacheExpired();
  }

  async function performCompute() {
    const startedAt = Date.now();
    let stocks = [];
    let source = "unknown";
    let isRealtime = true;
    try {
      stocks = await getAllAshares();
      source = stocks[0]?.source || "eastmoney";
    } catch (error) {
      console.error("[concentration-calc-failed] 获取全A行情失败:", error.message);
      isRealtime = false;
      source = "snapshot-fallback";
    }

    const calculated = calculateConcentration(stocks);
    const history = listRecords(120);
    const today = shanghaiDate();
    const dimensions = attachChanges(
      attachPercentiles(calculated, history),
      history,
      today
    );
    const industryDistribution = buildIndustryDistribution(stocks, calculated.topStocks);

    const indices = await getIndices().catch(() => []);
    const trendSummary = buildTrendSummary(dimensions, history);
    const possibilities = buildPossibilities(dimensions, history, indices);

    const record = {
      date: today,
      scope: "沪深A股",
      sampleCount: calculated.sampleCount,
      dataSource: source,
      totalAmount: calculated.totalAmount,
      dimensions: {
        top25: { ratio: dimensions.top25.ratio, amount: dimensions.top25.amount },
        top1pct: { ratio: dimensions.top1pct.ratio, amount: dimensions.top1pct.amount },
        top5pct: { ratio: dimensions.top5pct.ratio, amount: dimensions.top5pct.amount }
      },
      industryDistribution: industryDistribution.map((item) => ({
        industry: item.industry,
        amount: item.amount,
        ratio: item.ratio
      })),
      checksum: computeChecksum(stocks),
      cachedAt: new Date().toISOString()
    };

    const result = {
      updatedAt: new Date().toISOString(),
      marketScope: "沪深A股",
      sampleCount: calculated.sampleCount,
      dataSource: source,
      isRealtime,
      dimensions,
      topStocks: calculated.topStocks,
      industryDistribution,
      trendSummary,
      possibilities,
      historyRecord: record,
      elapsedMs: Date.now() - startedAt
    };

    runtimeCache.current = result;
    runtimeCache.updatedAt = Date.now();
    runtimeCache.loading = false;
    runtimeCache.source = source;
    runtimeCache.isRealtime = isRealtime;
    runtimeCache.sampleCount = calculated.sampleCount;

    console.log(`[concentration] 计算完成: 样本 ${calculated.sampleCount}, 耗时 ${Date.now() - startedAt}ms, 来源 ${source}`);
    return result;
  }

  function backgroundRefresh() {
    if (runtimeCache.loading) return;
    runtimeCache.loading = true;
    performCompute()
      .catch((error) => {
        console.error("[concentration-background-refresh-failed]", error.message);
      })
      .finally(() => {
        runtimeCache.loading = false;
      });
  }

  async function computeCurrent({ force = false } = {}) {
    if (!force && runtimeCache.current && !runtimeCacheExpired()) {
      return { ...runtimeCache.current, isRealtime: runtimeCache.isRealtime };
    }
    if (runtimeCache.loading) {
      while (runtimeCache.loading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (runtimeCache.current) return { ...runtimeCache.current, isRealtime: runtimeCache.isRealtime };
    }

    // 缓存过期但非强制刷新：先返回旧缓存，后台静默刷新，避免请求超时。
    if (!force && runtimeCache.current) {
      backgroundRefresh();
      return { ...runtimeCache.current, isRealtime: false };
    }

    runtimeCache.loading = true;
    try {
      return await performCompute();
    } finally {
      runtimeCache.loading = false;
    }
  }

  function computeChecksum(stocks = []) {
    const text = stocks
      .slice(0, 100)
      .map((stock) => `${stock.code}:${stock.amount}`)
      .join("|");
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  async function archiveToday({ force = false } = {}) {
    const today = shanghaiDate();
    const existing = getRecord(today);
    if (existing && !force) return existing;

    const computed = await computeCurrent({ force: true });
    const record = {
      ...computed.historyRecord,
      cachedAt: new Date().toISOString()
    };
    putRecord(record);
    console.log(`[concentration-archive] 已归档 ${today}, 样本 ${record.sampleCount}`);
    return record;
  }

  async function getHistory(window = 60) {
    const records = listRecords(Number(window) || 60);
    return {
      window: Number(window) || 60,
      records: records.map((record) => ({
        date: record.date,
        dimensions: record.dimensions || {}
      })),
      stats: memoryCacheStats()
    };
  }

  async function getConcentration({ force = false, window = 120 } = {}) {
    const [current, history] = await Promise.all([
      computeCurrent({ force }),
      getHistory(window)
    ]);
    return {
      ...current,
      history: history.records
    };
  }

  async function analyzePossibilities(context = {}) {
    const dimensions = context.dimensions || {};
    const contextHistory = context.history || [];
    const fullHistory = listRecords(500);
    const history = fullHistory.length >= contextHistory.length ? fullHistory : contextHistory;
    let indices = context.indices || [];
    try {
      indices = await getIndices().catch(() => []);
    } catch {
      indices = [];
    }
    const rulesPossibilities = buildPossibilities(dimensions, history, indices);
    const trendSummary = buildTrendSummary(dimensions, history);

    if (!hasAiKey || !hasAiKey()) {
      return {
        possibilities: rulesPossibilities,
        trendSummary,
        source: "rules",
        note: "AI 分析暂不可用，已使用规则模板"
      };
    }
    try {
      const prompt = [
        "基于以下超头部成交集中度数据，输出 3～5 条行情走势变化可能性判断，每条一句话。",
        "数据：",
        JSON.stringify({
          dimensions,
          historyWindow: history.length,
          industryTop3: (context.industryDistribution || []).slice(0, 3).map((item) => item.industry),
          existingPossibilities: rulesPossibilities
        }).slice(0, 4000)
      ].join("\n");
      const result = await kimiJson({
        system: "你是 A 股宏观择时分析助手。只输出 JSON，不要 Markdown。JSON 结构：{\"possibilities\":[\"判断1\",\"判断2\"]}。每条判断简洁、有信息量，不承诺收益。",
        prompt,
        cacheKey: `concentration-analyze:${context.updatedAt || Date.now()}`,
        ttl: 10 * 60 * 1000
      });
      const possibilities = Array.isArray(result?.possibilities) ? result.possibilities.slice(0, 5) : rulesPossibilities;
      return { possibilities, trendSummary, source: "ai", note: "" };
    } catch (error) {
      console.error("[concentration-ai-failed]", error.message);
      return {
        possibilities: rulesPossibilities,
        trendSummary,
        source: "rules",
        note: "AI 分析暂不可用，已使用规则模板"
      };
    }
  }

  function clearRuntimeCache() {
    runtimeCache.current = null;
    runtimeCache.updatedAt = 0;
    runtimeCache.loading = false;
  }

  loadMemoryCache();

  return {
    computeCurrent,
    archiveToday,
    getHistory,
    getConcentration,
    analyzePossibilities,
    clearRuntimeCache,
    runtimeCache: () => ({ ...runtimeCache })
  };
}

module.exports = {
  createConcentrationService
};
