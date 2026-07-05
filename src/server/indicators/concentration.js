const { marketOf } = require("../market/symbols");

function isAshareCode(code = "") {
  const c = String(code || "").replace(/\D/g, "");
  if (!c || c.length !== 6) return false;
  return /^(60|00|30|68|8|4)/.test(c);
}

function isValidStock(stock = {}) {
  const code = String(stock.code || "").replace(/\D/g, "");
  if (!isAshareCode(code)) return false;
  if (!String(stock.name || "").trim()) return false;
  const amount = Number(stock.amount);
  return Number.isFinite(amount) && amount > 0;
}

function normalizeStock(stock = {}) {
  const code = String(stock.code || "").replace(/\D/g, "");
  return {
    code,
    name: String(stock.name || "").trim(),
    market: Number.isFinite(Number(stock.market)) ? Number(stock.market) : marketOf(code),
    price: Number(stock.price),
    pct: Number(stock.pct),
    change: Number(stock.change),
    amount: Number(stock.amount),
    volume: Number(stock.volume),
    turnover: Number(stock.turnover),
    industry: String(stock.industry || "").trim() || "未分类"
  };
}

function prepareStocks(stocks = []) {
  return (Array.isArray(stocks) ? stocks : [])
    .filter(isValidStock)
    .map(normalizeStock)
    .sort((a, b) => b.amount - a.amount);
}

function topKCount(total, ratio) {
  return Math.max(1, Math.min(total, Math.ceil(total * ratio)));
}

function calculateConcentration(stocks = []) {
  const prepared = prepareStocks(stocks);
  const total = prepared.length;
  if (!total) {
    return {
      sampleCount: 0,
      totalAmount: 0,
      top25: { ratio: 0, amount: 0, count: 0 },
      top1pct: { ratio: 0, amount: 0, count: 0 },
      top5pct: { ratio: 0, amount: 0, count: 0 },
      topStocks: []
    };
  }

  const totalAmount = prepared.reduce((sum, stock) => sum + stock.amount, 0);
  const k25 = Math.min(total, 25);
  const k1 = topKCount(total, 0.01);
  const k5 = topKCount(total, 0.05);

  const sliceAmount = (count) => prepared.slice(0, count).reduce((sum, stock) => sum + stock.amount, 0);

  const top25Amount = sliceAmount(k25);
  const top1Amount = sliceAmount(k1);
  const top5Amount = sliceAmount(k5);

  const topStocks = prepared.slice(0, 25).map((stock, index) => ({
    rank: index + 1,
    code: stock.code,
    name: stock.name,
    market: stock.market,
    price: stock.price,
    pct: stock.pct,
    change: stock.change,
    amount: stock.amount,
    marketRatio: totalAmount ? (stock.amount / totalAmount) * 100 : 0,
    industry: stock.industry
  }));

  return {
    sampleCount: total,
    totalAmount,
    top25: { ratio: totalAmount ? (top25Amount / totalAmount) * 100 : 0, amount: top25Amount, count: k25 },
    top1pct: { ratio: totalAmount ? (top1Amount / totalAmount) * 100 : 0, amount: top1Amount, count: k1 },
    top5pct: { ratio: totalAmount ? (top5Amount / totalAmount) * 100 : 0, amount: top5Amount, count: k5 },
    topStocks
  };
}

function buildIndustryDistribution(stocks = [], topStocks = []) {
  const targets = Array.isArray(topStocks) && topStocks.length ? topStocks : stocks.slice(0, 25);
  const total = targets.reduce((sum, stock) => sum + Number(stock.amount || 0), 0);
  if (!total) return [];

  const byIndustry = new Map();
  for (const stock of targets) {
    const industry = String(stock.industry || "未分类").trim() || "未分类";
    const existing = byIndustry.get(industry) || { amount: 0, stocks: [] };
    existing.amount += Number(stock.amount || 0);
    existing.stocks.push(stock.name || stock.code || "");
    byIndustry.set(industry, existing);
  }

  return [...byIndustry.entries()]
    .map(([industry, item]) => ({
      industry,
      amount: item.amount,
      ratio: (item.amount / total) * 100,
      topStocks: item.stocks.slice(0, 3)
    }))
    .sort((a, b) => b.amount - a.amount);
}

function percentileRank(values = [], current) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const count = sorted.filter((value) => value <= current).length;
  return Math.round((count / sorted.length) * 100);
}

function levelFromPercentile(p) {
  if (!Number.isFinite(p)) return { level: "数据不足", color: "gray" };
  if (p >= 90) return { level: "极端集中", color: "extreme" };
  if (p >= 75) return { level: "高位集中", color: "high" };
  if (p >= 25) return { level: "正常区间", color: "normal" };
  if (p >= 10) return { level: "低位分散", color: "low" };
  return { level: "极度分散", color: "lowest" };
}

function attachPercentiles(current, history = []) {
  const dimensions = ["top25", "top1pct", "top5pct"];
  const result = {};
  for (const key of dimensions) {
    const values = history.map((item) => item.dimensions?.[key]?.ratio).filter(Number.isFinite);
    const ratio = current[key]?.ratio ?? 0;
    const percentile = values.length ? percentileRank(values, ratio) : null;
    result[key] = {
      ...current[key],
      percentile,
      ...levelFromPercentile(percentile)
    };
  }
  return result;
}

function attachChanges(current, history = [], today = "") {
  const dimensions = ["top25", "top1pct", "top5pct"];
  const todayStr = String(today || "");
  const previous = todayStr
    ? history.filter((item) => item.date && String(item.date) < todayStr)
    : history;
  const result = {};
  for (const key of dimensions) {
    const prevRatio = previous.at(-1)?.dimensions?.[key]?.ratio;
    const ratio = current[key]?.ratio ?? 0;
    const hasPrev = Number.isFinite(prevRatio);
    result[key] = {
      ...current[key],
      change: hasPrev ? Number((ratio - prevRatio).toFixed(6)) : null,
      prevRatio: hasPrev ? prevRatio : null
    };
  }
  return result;
}

function trendDirection(values = []) {
  if (values.length < 2) return "平稳";
  const latest = values.at(-1);
  const prev = values.at(-2);
  if (!Number.isFinite(latest) || !Number.isFinite(prev)) return "平稳";
  const diff = latest - prev;
  if (Math.abs(diff) < 0.05) return "平稳";
  return diff > 0 ? "上升" : "下降";
}

function movingAverage(values = [], window = 5) {
  if (!values.length) return null;
  const slice = values.slice(-window).filter(Number.isFinite);
  if (!slice.length) return null;
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function buildTrendSummary(dimensions, history = []) {
  const dimensionsKeys = ["top25", "top1pct", "top5pct"];
  const lines = [];
  for (const key of dimensionsKeys) {
    const values = history.map((item) => item.dimensions?.[key]?.ratio).filter(Number.isFinite);
    const current = dimensions?.[key] || {};
    const ma5 = movingAverage(values, 5);
    const ma20 = movingAverage(values, 20);
    const direction5 = trendDirection(values.slice(-5));
    const direction20 = trendDirection(values.slice(-20));
    const label = key === "top25" ? "Top25" : key === "top1pct" ? "Top1%" : "Top5%";
    const ratio = Number.isFinite(current.ratio) ? current.ratio.toFixed(2) : "--";
    const level = current.level || "数据不足";
    lines.push(`${label}集中度 ${ratio}%，处于${level}（历史分位 ${current.percentile ?? "--"}%）；近5日${direction5}，近20日${direction20}。`);
  }
  return lines.join("\n");
}

function buildPossibilities(dimensions, history = [], indices = []) {
  const possibilities = [];
  const top5 = dimensions?.top5pct || {};
  const top1 = dimensions?.top1pct || {};
  const top25 = dimensions?.top25 || {};

  const top5History = history.map((item) => item.dimensions?.top5pct?.ratio).filter(Number.isFinite);
  const recent5 = top5History.slice(-5);
  const rising5 = recent5.length >= 2 && recent5.every((value, index) => index === 0 || value >= recent5[index - 1]);
  const fallingFast = top5History.length >= 2 && (top5History.at(-1) - top5History.at(-2)) < -0.5;

  const indexPct = Array.isArray(indices) && indices.length ? indices[0]?.pct : null;
  const indexName = Array.isArray(indices) && indices.length ? indices[0]?.name : "大盘";

  if (top5.percentile >= 90) {
    if (rising5) {
      possibilities.push("头部抱团处于极端状态且仍在强化，历史经验显示后续 5～10 个交易日出现风格扩散或抱团松动的概率较高。");
    } else {
      possibilities.push("头部抱团处于极端状态，短线核心龙头仍占主导，但需警惕获利盘松动导致中后排掉队。");
    }
    if (top1.percentile >= 90 && top25.percentile >= 90) {
      possibilities.push("Top25、Top1%、Top5% 集中度同步处于历史极端，大小盘分化显著，宜聚焦主线并控制仓位。");
    }
    possibilities.push("若后续成交额不能持续放大，高位抱团品种容易出现冲高回落，注意节奏而非追高。");
  } else if (top5.percentile >= 75) {
    possibilities.push("头部集中度处于高位，资金抱团特征明显，建议围绕主线龙头滚动操作。");
  }

  if (fallingFast && Number(indexPct) > 0.8) {
    possibilities.push("集中度从高位快速回落且大盘放量上涨，资金可能从头部向中盘扩散，普涨行情概率上升。");
  }

  if (top5.percentile <= 25 && Number(indexPct) > -0.5 && Number(indexPct) < 0.5) {
    possibilities.push("集中度低位横盘且市场波动较小，缺乏明确主线，轮动速度快，宜降低仓位或等待方向选择。");
  }

  if (top1.percentile >= 85 && top5.percentile < 75) {
    possibilities.push("极头部（Top1%）显著强于广义头部（Top5%），说明资金集中在极少数龙头，中后排跟涨意愿一般。");
  }

  if (top25.percentile >= 75 && top5.percentile < 70) {
    possibilities.push("Top25 集中度偏高但 Top5% 未同步，市场可能由少数大盘股领涨，结构性行情特征明显。");
  }

  if (!possibilities.length) {
    if (top5.percentile < 25) {
      possibilities.push("当前集中度处于低位，资金抱团特征不明显，板块轮动较快，可继续观察量能与主线确立。");
    } else {
      possibilities.push("当前集中度处于正常区间，资金抱团特征不明显，可继续观察板块轮动与量能变化。");
    }
    possibilities.push(`结合${indexName}走势，若后续成交量持续放大，头部集中度可能进一步向行业主线集中。`);
  }

  return possibilities.slice(0, 5);
}

module.exports = {
  isAshareCode,
  isValidStock,
  normalizeStock,
  prepareStocks,
  topKCount,
  calculateConcentration,
  buildIndustryDistribution,
  percentileRank,
  levelFromPercentile,
  attachPercentiles,
  attachChanges,
  trendDirection,
  movingAverage,
  buildTrendSummary,
  buildPossibilities
};
