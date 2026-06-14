const { RECOMMEND_REFRESH_MS } = require("../config");
const { moneyText, toFixedText } = require("../utils/number");
const { technicalOpportunityScore } = require("../market/indicators");

function createRecommendationService({ getSectors, getStocks, getStockKline, stockAdviceForServer }) {
  const recommendationCache = {
    status: "idle",
    data: [],
    refreshedAt: "",
    nextRefreshAt: "",
    error: ""
  };

  function recommendationScore(stock) {
    const sectorScore = Number(stock.sectorScore || 0);
    const stockScore = Number(stock.score || 0);
    const flow = Number(stock.mainFlow);
    const flowPct = Number(stock.mainFlowPct);
    const inSpeed = Number(stock.mainInSpeed);
    const outSpeed = Number(stock.mainOutSpeed);
    const pct = Number(stock.pct);
    const flowScore = Number.isFinite(flow) ? Math.max(-18, Math.min(30, flow / 100_000_000 * 5)) : 0;
    const flowPctScore = Number.isFinite(flowPct) ? Math.max(-12, Math.min(18, flowPct * 1.25)) : 0;
    const speedScore = Number.isFinite(inSpeed) ? Math.max(0, Math.min(16, inSpeed * 1.4)) : 0;
    const outPenalty = Number.isFinite(outSpeed) ? Math.max(0, Math.min(18, outSpeed * 1.6)) : 0;
    const positionPenalty = pct > 6 ? (pct - 6) * 4 : pct < -2.5 ? Math.abs(pct + 2.5) * 4 : 0;
    return sectorScore * 0.32 + stockScore * 0.38 + flowScore + flowPctScore + speedScore - outPenalty - positionPenalty;
  }

  function isOperableCandidate(stock) {
    const pct = Number(stock.pct);
    const flow = Number(stock.mainFlow);
    const flowPct = Number(stock.mainFlowPct);
    const inSpeed = Number(stock.mainInSpeed);
    const outSpeed = Number(stock.mainOutSpeed);
    if (!Number.isFinite(Number(stock.price)) || !Number.isFinite(pct)) return false;
    if (pct < -3 || pct > 8.5) return false;
    if (Number(stock.score || 0) < 42) return false;
    const flowOk = Number.isFinite(flow) ? flow > 0 : true;
    const ratioOk = Number.isFinite(flowPct) ? flowPct > 0 : true;
    const speedOk = !Number.isFinite(inSpeed) || !Number.isFinite(outSpeed) || inSpeed >= outSpeed * 0.65;
    return flowOk && ratioOk && speedOk;
  }

  function buildServerRecommendationReason(stock, advice) {
    const flow = stock.mainFlow === null || stock.mainFlow === undefined ? "暂无主力净额" : `主力净额 ${moneyText(stock.mainFlow)}`;
    const flowPct = stock.mainFlowPct === null || stock.mainFlowPct === undefined ? "" : `，主力占比 ${toFixedText(stock.mainFlowPct)}%`;
    const speed = stock.mainInSpeed === null || stock.mainInSpeed === undefined ? "" : `，流入速度 ${toFixedText(stock.mainInSpeed)}%`;
    return `${stock.sectorName} 板块雷达分 ${toFixedText(stock.sectorScore, 1)}，${flow}${flowPct}${speed}；个股进攻分 ${toFixedText(stock.score, 1)}，当前涨跌幅 ${toFixedText(stock.pct)}%，属于可跟踪但不宜盲目追高的位置。`;
  }

  function buildServerRecommendationAnalysis(stock, advice) {
    const levels = advice.levels || {};
    return [
      `方向：${stock.sectorName} 板块主力方向靠前，个股资金同步性 ${Number(stock.mainFlow || 0) > 0 ? "偏强" : "一般"}。`,
      `买点：优先等回踩 ${toFixedText(levels.pullbackBuy)} 附近不破，或放量突破 ${toFixedText(levels.breakoutBuy)} 后分批，不建议单笔满仓追入。`,
      `风控：计划止损 ${toFixedText(levels.stopLoss)}，若主力净流入转负或跌破该位置，本次建仓逻辑失效。`,
      `目标：第一目标 ${toFixedText(levels.firstTarget)}，到位先锁定部分利润，再看板块持续性。`
    ];
  }

  async function refreshRecommendations({ force = false } = {}) {
    if (recommendationCache.status === "running") return recommendationCache;
    const fresh = recommendationCache.refreshedAt && Date.now() - Date.parse(recommendationCache.refreshedAt) < RECOMMEND_REFRESH_MS;
    if (!force && fresh && recommendationCache.data.length) return recommendationCache;
    recommendationCache.status = "running";
    recommendationCache.error = "";
    try {
      const sectors = await getSectors(5);
      const sectorStocksPairs = await Promise.all(sectors.map(async (sector) => {
        try {
          const stocks = await getStocks(sector.id, 5);
          return stocks
            .slice(0, 50)
            .map((stock) => ({
              ...stock,
              sectorId: sector.id,
              sectorName: sector.name,
              sectorScore: sector.attackScore,
              sectorMainNet: sector.mainNet,
              sectorMainNetPct: sector.mainNetPct
            }));
        } catch {
          return [];
        }
      }));
      const ranked = sectorStocksPairs.flat()
        .filter(isOperableCandidate)
        .map((stock) => ({ ...stock, recScore: recommendationScore(stock) }))
        .sort((a, b) => Number(b.recScore || 0) - Number(a.recScore || 0));
      const unique = [];
      const seen = new Set();
      for (const stock of ranked) {
        if (seen.has(stock.code)) continue;
        seen.add(stock.code);
        unique.push(stock);
        if (unique.length >= 60) break;
      }
      const withAdvice = await Promise.all(unique.map(async (stock) => {
        let candles = [];
        try {
          candles = (await getStockKline(stock.code, stock.market)).klines;
        } catch {
          candles = [];
        }
        const advised = { ...stock, candles };
        const advice = stockAdviceForServer(advised);
        const actionBoost = advice.action === "持有或小幅加仓" ? 8 : advice.action === "观察减仓" ? -7 : advice.action === "冲高减仓" ? -15 : 0;
        const technical = technicalOpportunityScore(candles);
        const buyOpportunityScore = Number(stock.recScore || 0) + actionBoost + technical.score;
        return {
          ...stock,
          candles: [],
          advice,
          technicalScore: technical.score,
          technicalSignals: {
            macd: technical.macdLabel,
            sar: technical.sarLabel,
            details: technical.details
          },
          recScore: buyOpportunityScore,
          buyOpportunityScore,
          reason: buildServerRecommendationReason(stock, advice),
          analysis: buildServerRecommendationAnalysis(stock, advice).concat([
            `技术：${technical.macdLabel}，${technical.sarLabel}，对买入机会分贡献 ${technical.score >= 0 ? "+" : ""}${toFixedText(technical.score, 1)} 分。`
          ])
        };
      }));
      const data = withAdvice
        .filter((stock) => !["冲高减仓", "观察减仓", "等待数据"].includes(stock.advice.action))
        .sort((a, b) => Number(b.recScore || 0) - Number(a.recScore || 0))
        .slice(0, 20);
      const now = new Date();
      recommendationCache.data = data;
      recommendationCache.refreshedAt = now.toISOString();
      recommendationCache.nextRefreshAt = new Date(now.getTime() + RECOMMEND_REFRESH_MS).toISOString();
      recommendationCache.status = "ready";
      return recommendationCache;
    } catch (error) {
      recommendationCache.status = "error";
      recommendationCache.error = error.message;
      recommendationCache.nextRefreshAt = new Date(Date.now() + 60_000).toISOString();
      return recommendationCache;
    }
  }

  return {
    recommendationCache,
    recommendationScore,
    isOperableCandidate,
    buildServerRecommendationReason,
    buildServerRecommendationAnalysis,
    refreshRecommendations
  };
}

module.exports = {
  createRecommendationService
};
