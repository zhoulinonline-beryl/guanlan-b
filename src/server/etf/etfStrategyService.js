const { trendScore, technicalOpportunityScore } = require("../market/indicators");
const { toNumber, toFixedText, moneyText } = require("../utils/number");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function stdDev(values = []) {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return 0;
  const avg = nums.reduce((sum, v) => sum + v, 0) / nums.length;
  const variance = nums.reduce((sum, v) => sum + (v - avg) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function computeEtfMetrics(klines = []) {
  const rows = Array.isArray(klines) ? klines : [];
  if (!rows.length) {
    return {
      return3m: null,
      return2w: null,
      volatility3m: null,
      turnoverAvg: null,
      volumeRatio: null,
      trendScoreValue: null,
      technical: null
    };
  }

  const last = rows.at(-1);
  const close3m = rows.length >= 60 ? rows[rows.length - 60].close : rows[0].close;
  const close2w = rows.length >= 10 ? rows[rows.length - 10].close : rows[0].close;

  const return3m = close3m ? ((last.close - close3m) / close3m) * 100 : null;
  const return2w = close2w ? ((last.close - close2w) / close2w) * 100 : null;

  const last60 = rows.slice(-60);
  const dailyReturns = last60.slice(1).map((item, index) => {
    const prev = last60[index];
    return prev.close ? (item.close - prev.close) / prev.close : 0;
  });
  const volatility3m = dailyReturns.length ? stdDev(dailyReturns) * 100 : null;

  const last10 = rows.slice(-10);
  const turnoverAvg = last10.length
    ? last10.reduce((sum, item) => sum + (toNumber(item.turnover, 0) || 0), 0) / last10.length
    : null;

  const vol5 = rows.slice(-5).reduce((sum, item) => sum + (toNumber(item.volume, 0) || 0), 0);
  const vol20 = rows.slice(-20).reduce((sum, item) => sum + (toNumber(item.volume, 0) || 0), 0);
  const volumeRatio = vol20 ? vol5 / (vol20 / 4) : null; // 5日日均 vs 20日日均

  const trendScoreValue = trendScore(rows, last.pct || 0, 0, turnoverAvg || 0, 5);
  const technical = technicalOpportunityScore(rows);

  return {
    return3m,
    return2w,
    volatility3m,
    turnoverAvg,
    volumeRatio,
    trendScoreValue,
    technical
  };
}

function mediumEtfScore(metrics, sector) {
  if (!metrics) return null;
  const r3m = toNumber(metrics.return3m, null);
  const vol = toNumber(metrics.volatility3m, null);
  const turnover = toNumber(metrics.turnoverAvg, 0);
  const technicalScore = toNumber(metrics.technical?.score, 0);
  const trend = toNumber(metrics.trendScoreValue, 0);
  const sectorScore = toNumber(sector?.sectorScore, 0);
  const sectorMainNet = toNumber(sector?.sectorMainNet, 0);

  if (r3m === null || vol === null) return null;

  const sectorMainNetScore = clamp(sectorMainNet / 1e8 * 4, -12, 18);
  const score = r3m * 2.0
    + trend * 0.30
    + technicalScore * 0.6
    + sectorScore * 0.35
    + sectorMainNetScore
    + turnover * 0.5
    - vol * 1.2;
  return clamp(score, -999, 999);
}

function shortEtfScore(metrics, sector) {
  if (!metrics) return null;
  const r2w = toNumber(metrics.return2w, null);
  const turnover = toNumber(metrics.turnoverAvg, 0);
  const technicalScore = toNumber(metrics.technical?.score, 0);
  const volumeRatio = toNumber(metrics.volumeRatio, 1);
  const sectorScore = toNumber(sector?.sectorScore, 0);
  const sectorMainNet = toNumber(sector?.sectorMainNet, 0);

  if (r2w === null) return null;

  const sectorMainNetScore = clamp(sectorMainNet / 1e8 * 4, -12, 18);
  const score = r2w * 3.0
    + technicalScore * 1.0
    + (volumeRatio - 1) * 12
    + sectorScore * 0.40
    + sectorMainNetScore * 0.6
    + turnover * 0.6;
  return clamp(score, -999, 999);
}

function isMediumCandidate(metrics) {
  const rowsCount = metrics?.rowsCount || 0;
  const r3m = toNumber(metrics?.return3m, null);
  const technicalScore = toNumber(metrics?.technical?.score, 0);
  if (rowsCount < 30) return false;
  if (r3m !== null && r3m < -25 && technicalScore < -5) return false;
  return true;
}

function isShortCandidate(metrics) {
  const rowsCount = metrics?.rowsCount || 0;
  const technical = metrics?.technical;
  if (rowsCount < 5) return false;
  if (technical) {
    const macdWeak = String(technical.macdLabel || "").includes("空头");
    const sarWeak = String(technical.sarLabel || "").includes("压制");
    if (macdWeak && sarWeak) return false;
  }
  return true;
}

function buildMediumReason(etf, metrics, sector) {
  const lines = [];
  const r3m = toNumber(metrics.return3m, null);
  const vol = toNumber(metrics.volatility3m, null);
  const trend = toNumber(metrics.trendScoreValue, 0);
  const sectorScore = toNumber(sector.sectorScore, 0);
  const sectorMainNet = toNumber(sector.sectorMainNet, 0);

  lines.push(`近 3 个月收益 ${r3m === null ? "--" : `${toFixedText(r3m, 2)}%`}，趋势雷达分 ${toFixedText(trend, 1)}。`);
  lines.push(`近 3 个月波动率 ${vol === null ? "--" : `${toFixedText(vol, 2)}%`}。`);
  if (sector.sectorName) {
    lines.push(`所属板块「${sector.sectorName}」雷达分 ${toFixedText(sectorScore, 1)}，主力净流入 ${moneyText(sectorMainNet)}。`);
  }
  lines.push(`技术面：${metrics.technical?.macdLabel || "--"}，${metrics.technical?.sarLabel || "--"}。`);
  lines.push("中期持仓逻辑：趋势向好、板块景气度较高、波动可控的 ETF 品种。");
  return lines;
}

function buildShortReason(etf, metrics, sector) {
  const lines = [];
  const r2w = toNumber(metrics.return2w, null);
  const volumeRatio = toNumber(metrics.volumeRatio, 1);
  const turnover = toNumber(metrics.turnoverAvg, 0);
  const sectorScore = toNumber(sector.sectorScore, 0);
  const sectorMainNet = toNumber(sector.sectorMainNet, 0);

  lines.push(`近 2 周收益 ${r2w === null ? "--" : `${toFixedText(r2w, 2)}%`}。`);
  lines.push(`量能比 ${toFixedText(volumeRatio, 2)}，近 10 日平均换手 ${toFixedText(turnover, 2)}%。`);
  if (sector.sectorName) {
    lines.push(`所属板块「${sector.sectorName}」雷达分 ${toFixedText(sectorScore, 1)}，主力净流入 ${moneyText(sectorMainNet)}。`);
  }
  lines.push(`技术面：${metrics.technical?.macdLabel || "--"}，${metrics.technical?.sarLabel || "--"}。`);
  lines.push("短期持仓逻辑：近期动量较强、技术共振、板块情绪偏暖的 ETF 品种。");
  return lines;
}

function createEtfStrategyService({ getEtfList, getStockKline, mapEtfToSector } = {}) {
  async function analyzeEtf(etf) {
    const result = {
      ...etf,
      sectorName: "",
      sectorScore: 0,
      sectorMainNet: 0,
      sectorId: "",
      return3m: null,
      return2w: null,
      volatility3m: null,
      turnoverAvg: null,
      volumeRatio: null,
      trendScoreValue: null,
      technical: null,
      mediumScore: null,
      shortScore: null,
      mediumReason: [],
      shortReason: []
    };

    try {
      const [klineData, sector] = await Promise.all([
        getStockKline(etf.code, etf.market, { count: 120 }),
        mapEtfToSector(etf.name)
      ]);
      const klines = klineData?.klines || [];
      const metrics = computeEtfMetrics(klines);
      metrics.rowsCount = klines.length;

      Object.assign(result, {
        ...metrics,
        ...sector,
        mediumScore: isMediumCandidate(metrics) ? mediumEtfScore(metrics, sector) : null,
        shortScore: isShortCandidate(metrics) ? shortEtfScore(metrics, sector) : null,
        mediumReason: buildMediumReason(etf, metrics, sector),
        shortReason: buildShortReason(etf, metrics, sector)
      });
    } catch (error) {
      result.error = error.message;
    }

    return result;
  }

  async function refreshStrategy({ force = false } = {}) {
    const etfs = await getEtfList(force);
    if (!etfs.length) {
      return { status: "empty", mediumTop5: [], shortTop5: [], etfs: [] };
    }

    const analyzed = await Promise.all(etfs.map(analyzeEtf));

    const mediumCandidates = analyzed
      .filter((item) => Number.isFinite(item.mediumScore))
      .sort((a, b) => b.mediumScore - a.mediumScore)
      .slice(0, 5);

    const shortCandidates = analyzed
      .filter((item) => Number.isFinite(item.shortScore))
      .sort((a, b) => b.shortScore - a.shortScore)
      .slice(0, 5);

    return {
      status: "ready",
      refreshedAt: new Date().toISOString(),
      etfs,
      mediumTop5: mediumCandidates,
      shortTop5: shortCandidates
    };
  }

  return {
    refreshStrategy,
    analyzeEtf,
    computeEtfMetrics,
    mediumEtfScore,
    shortEtfScore
  };
}

module.exports = {
  createEtfStrategyService,
  computeEtfMetrics,
  mediumEtfScore,
  shortEtfScore,
  isMediumCandidate,
  isShortCandidate,
  buildMediumReason,
  buildShortReason
};
