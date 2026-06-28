const { macdForServer, sarForServer, technicalOpportunityScore } = require("../market/indicators");
const { roundLot } = require("../utils/number");

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCandles(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const open = finite(item.open, NaN);
    const close = finite(item.close, NaN);
    const high = finite(item.high, NaN);
    const low = finite(item.low, NaN);
    if (![open, close, high, low].every(Number.isFinite)) return null;
    return {
      day: item.day || item.date || item.time || "",
      open,
      close,
      high,
      low,
      volume: finite(item.volume)
    };
  }).filter(Boolean);
}

function compactChartRows(rows = [], limit = 160) {
  return normalizeCandles(rows)
    .map((row) => ({ ...row, day: normalizeDateText(row.day) || row.day }))
    .filter((row) => row.day)
    .slice(-limit);
}

function normalizeDateText(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatDateText(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chinaTradeDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function tradeDateFromTime(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : chinaTradeDate(text ? new Date(text) : new Date());
}

function subtractNaturalYear(date) {
  const next = new Date(date);
  const originalMonth = next.getMonth();
  next.setFullYear(next.getFullYear() - 1);
  if (next.getMonth() !== originalMonth) next.setDate(0);
  return next;
}

function previousYearRange(now = new Date()) {
  return {
    startDate: formatDateText(subtractNaturalYear(now)),
    endDate: formatDateText(now)
  };
}

function previousSixMonthRange(now = new Date()) {
  const start = new Date(now);
  const targetMonth = (start.getMonth() + 12 - 6) % 12;
  start.setMonth(start.getMonth() - 6);
  if (start.getMonth() !== targetMonth) start.setDate(0);
  return {
    startDate: formatDateText(start),
    endDate: formatDateText(now)
  };
}

function backtestTradingSlots() {
  const slots = [];
  const pushRange = (startHour, startMinute, endHour, endMinute) => {
    let minutes = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    while (minutes <= end) {
      slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
      minutes += 10;
    }
  };
  pushRange(9, 30, 11, 30);
  pushRange(13, 0, 15, 0);
  return slots;
}

const BACKTEST_TRADING_SLOTS = backtestTradingSlots();

function intradayProgress(slot = "15:00") {
  const [hour, minute] = String(slot).split(":").map((item) => Number(item));
  const value = hour * 60 + minute;
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;
  if (value <= morningEnd) return Math.max(0, Math.min(0.5, (value - morningStart) / (morningEnd - morningStart) * 0.5));
  return 0.5 + Math.max(0, Math.min(0.5, (value - afternoonStart) / (afternoonEnd - afternoonStart) * 0.5));
}

function intradayPrice(row = {}, progress = 1) {
  const open = finite(row.open, row.close);
  const high = finite(row.high, open);
  const low = finite(row.low, open);
  const close = finite(row.close, open);
  if (progress <= 0.28) return open + (high - open) * (progress / 0.28);
  if (progress <= 0.68) return high + (low - high) * ((progress - 0.28) / 0.4);
  return low + (close - low) * ((progress - 0.68) / 0.32);
}

function intradayCandle(row = {}, slot = "15:00") {
  const progress = intradayProgress(slot);
  const price = intradayPrice(row, progress);
  const open = finite(row.open, price);
  const high = Math.max(open, price, progress >= 0.28 ? finite(row.high, price) : price);
  const low = Math.min(open, price, progress >= 0.68 ? finite(row.low, price) : price);
  return {
    ...row,
    close: price,
    high,
    low,
    volume: finite(row.volume) * Math.max(0.04, progress)
  };
}

function movingAverage(values = [], period = 20) {
  return values.map((_, index) => {
    const rows = values.slice(Math.max(0, index - period + 1), index + 1);
    return rows.reduce((sum, value) => sum + value, 0) / Math.max(1, rows.length);
  });
}

function bollSnapshot(candles = [], period = 20) {
  const closes = candles.map((item) => finite(item.close)).filter(Number.isFinite);
  if (!closes.length) return null;
  const rows = closes.slice(-period);
  const mid = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const variance = rows.reduce((sum, value) => sum + (value - mid) ** 2, 0) / rows.length;
  const width = Math.sqrt(variance) * 2;
  return {
    upper: mid + width,
    mid,
    lower: mid - width
  };
}

function bullGateSnapshot(candles = []) {
  if (!candles.length) return null;
  const closes = candles.map((item) => finite(item.close));
  const highs = candles.map((item) => finite(item.high));
  const lows = candles.map((item) => finite(item.low));
  const ma20 = movingAverage(closes, 20).at(-1);
  const trRows = candles.map((item, index) => {
    const prevClose = index ? closes[index - 1] : item.close;
    return Math.max(item.high - item.low, Math.abs(item.high - prevClose), Math.abs(item.low - prevClose));
  }).slice(-14);
  const atr = trRows.reduce((sum, value) => sum + value, 0) / Math.max(1, trRows.length);
  const rail = finite(ma20) + atr * 0.28;
  const core = finite(ma20) - atr * 0.28;
  return {
    upper: rail,
    lower: core,
    recentHigh: Math.max(...highs.slice(-10)),
    recentLow: Math.min(...lows.slice(-10))
  };
}

function weighted(value, weight, fallback = 1) {
  return finite(value) * finite(weight, fallback);
}

function clamp(value, min, max, fallback) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function normalizeRuntimeStrategy(strategy = {}) {
  return {
    ...strategy,
    buyThreshold: clamp(strategy.buyThreshold, 58, 82, 66),
    sellThreshold: clamp(strategy.sellThreshold, 32, 55, 45),
    maxSinglePositionPct: clamp(strategy.maxSinglePositionPct, 0.08, 0.35, 0.22),
    minCashPct: clamp(strategy.minCashPct, 0.02, 0.25, 0.08),
    learningRate: clamp(strategy.learningRate, 0.02, 0.18, 0.08),
    macdWeight: clamp(strategy.macdWeight, 0.5, 1.8, 1.18),
    sarWeight: clamp(strategy.sarWeight, 0.5, 1.8, 1.12),
    bollWeight: clamp(strategy.bollWeight, 0.5, 1.8, 1.04),
    bullGateWeight: clamp(strategy.bullGateWeight, 0.5, 1.9, 1.22),
    volumeWeight: clamp(strategy.volumeWeight, 0.5, 1.8, 1.08),
    strongBuyBonus: clamp(strategy.strongBuyBonus, 4, 16, 9),
    riskExitPenalty: clamp(strategy.riskExitPenalty, 6, 20, 12),
    takeProfitPct: clamp(strategy.takeProfitPct, 5, 28, 12),
    stopLossPct: clamp(strategy.stopLossPct, -18, -3, -7)
  };
}

function buildVirtualSignal({ stock = {}, quote = {}, candles = [], position = null, strategy = {} } = {}) {
  strategy = normalizeRuntimeStrategy(strategy);
  const rows = normalizeCandles(candles);
  const close = finite(quote.price, rows.at(-1)?.close || 0);
  const prevClose = rows.at(-2)?.close || rows.at(-1)?.open || close;
  const changePct = prevClose ? ((close - prevClose) / prevClose) * 100 : finite(quote.pct);
  const technical = technicalOpportunityScore(rows);
  const macd = macdForServer(rows);
  const sar = sarForServer(rows);
  const boll = bollSnapshot(rows);
  const bullGate = bullGateSnapshot(rows);
  const closes = rows.map((item) => finite(item.close)).filter(Number.isFinite);
  const ma20 = closes.length >= 20 ? movingAverage(closes, 20).at(-1) : null;
  const recent10 = rows.slice(-10);
  const recentHigh = recent10.length ? Math.max(...recent10.map((item) => finite(item.high))) : null;
  const recentLow = recent10.length ? Math.min(...recent10.map((item) => finite(item.low))) : null;
  const recentCloseHigh = recent10.length ? Math.max(...recent10.map((item) => finite(item.close))) : null;
  const pullbackBuy = Number.isFinite(ma20) ? Math.max(ma20, close * 0.97) : close * 0.97;
  const breakoutBuy = Number.isFinite(recentCloseHigh) ? recentCloseHigh * 1.005 : close;
  const support = Number.isFinite(recentLow) ? Math.max(recentLow, close * 0.94) : close * 0.94;
  const isOverExtended = boll && close > boll.upper * 1.02;
  const atPullback = close <= pullbackBuy * 1.02;
  const atBreakout = Number.isFinite(recentCloseHigh) && close >= recentCloseHigh * 0.998;
  const priceReadyForBuy = !isOverExtended && (atPullback || atBreakout);
  const lastIndex = rows.length - 1;
  const dif = finite(macd.dif[lastIndex]);
  const dea = finite(macd.dea[lastIndex]);
  const hist = finite(macd.hist[lastIndex]);
  const prevDif = finite(macd.dif[lastIndex - 1]);
  const prevDea = finite(macd.dea[lastIndex - 1]);
  const prevHist = finite(macd.hist[lastIndex - 1]);
  const sarValue = finite(sar[lastIndex], close);
  const prevSarValue = finite(sar[lastIndex - 1], sarValue);
  const avgVolume = rows.slice(-6, -1).reduce((sum, item) => sum + finite(item.volume), 0) / Math.max(1, rows.slice(-6, -1).length);
  const volumeBoost = avgVolume ? finite(rows.at(-1)?.volume) / avgVolume : 1;
  let score = 50 + technical.score;
  const reasons = [...(technical.details || [])];
  const contributions = [];
  const macdWeight = finite(strategy.macdWeight, 1.18);
  const sarWeight = finite(strategy.sarWeight, 1.12);
  const bollWeight = finite(strategy.bollWeight, 1.04);
  const bullGateWeight = finite(strategy.bullGateWeight, 1.22);
  const volumeWeight = finite(strategy.volumeWeight, 1.08);
  const strongBuyBonus = finite(strategy.strongBuyBonus, 9);
  const riskExitPenalty = finite(strategy.riskExitPenalty, 12);
  const takeProfitPct = finite(strategy.takeProfitPct, 12);
  const stopLossPct = finite(strategy.stopLossPct, -7);

  const addScore = (label, raw, weight = 1, reason = "") => {
    const delta = weighted(raw, weight);
    score += delta;
    contributions.push({ label, raw, weight, delta });
    if (reason) reasons.push(reason);
  };

  if (dif > dea && hist > 0) {
    const crossedUp = prevDif <= prevDea;
    addScore(
      "MACD",
      crossedUp ? 11 : hist > prevHist ? 8 : 5,
      macdWeight,
      crossedUp ? "MACD 金叉刚出现，动能反转信号优先级提高。" : hist > prevHist ? "MACD 多头柱继续放大，适合激进试仓。" : "MACD 仍在多头区，保留进攻资格。"
    );
  } else {
    const crossedDown = prevDif >= prevDea;
    addScore("MACD", crossedDown ? -11 : -7, macdWeight, crossedDown ? "MACD 死叉刚出现，回测策略优先降风险。" : "MACD 未给出多头扩张信号，建仓需要降档。");
  }

  if (close > sarValue) {
    const sarTurnUp = prevClose <= prevSarValue;
    addScore("SAR", sarTurnUp ? 10 : close / sarValue < 1.1 ? 7 : 3, sarWeight, sarTurnUp ? "价格重新站上 SAR，趋势拐点转强。" : "SAR 在价格下方，趋势保护仍有效。");
  } else {
    addScore("SAR", -riskExitPenalty, sarWeight, "价格跌到 SAR 下方，虚拟账户优先防守。");
  }

  if (boll) {
    if (close > boll.mid && close < boll.upper * 1.015) {
      addScore("BOLL", 6, bollWeight, "价格站上 BOLL 中轨且未明显顶到上轨，追击风险可控。");
    } else if (close >= boll.upper * 1.015) {
      addScore("BOLL", -6, bollWeight, "价格冲出 BOLL 上轨，短线容易回落，降低买入强度。");
    } else if (close < boll.lower) {
      addScore("BOLL", -9, bollWeight, "价格跌破 BOLL 下轨，先等止跌。");
    } else if (close > boll.lower && prevClose <= boll.lower && hist >= prevHist) {
      addScore("BOLL", 5, bollWeight, "价格从 BOLL 下轨附近收回且 MACD 柱改善，按低吸修复处理。");
    }
  }

  if (bullGate) {
    if (close > bullGate.upper) {
      addScore("牛门线", 8, bullGateWeight, "价格站上牛门线上轨，主升试探信号更清楚。");
    } else if (close >= bullGate.lower) {
      addScore("牛门线", 2, bullGateWeight, "价格仍在牛门线通道内，可以观察低吸触发。");
    } else {
      addScore("牛门线", -riskExitPenalty, bullGateWeight, "价格跌破牛门线下轨，虚拟交易先降低仓位。");
    }
  }

  if (volumeBoost >= 1.35 && changePct > 0) {
    addScore("量能", 5, volumeWeight, "量能明显放大并伴随上涨，资金进攻意愿增强。");
  } else if (volumeBoost >= 1.35 && changePct < 0) {
    addScore("量能", -5, volumeWeight, "放量下跌，疑似资金撤退，控制风险。");
  }

  const resonanceCount = [
    dif > dea && hist >= prevHist,
    close > sarValue,
    boll ? close > boll.mid && close < boll.upper * 1.02 : false,
    bullGate ? close > bullGate.upper : false,
    volumeBoost >= 1.2 && changePct >= 0
  ].filter(Boolean).length;
  if (resonanceCount >= 4) {
    addScore("共振", strongBuyBonus, 1, "MACD/SAR/BOLL/牛门线/量能出现四项以上共振，按强进攻信号处理。");
  }

  const pnlPct = finite(position?.pnlPct);
  if (position?.qty && pnlPct > takeProfitPct && score < 74) {
    addScore("止盈", -4, 1, "已有较高浮盈但共振不足，倾向锁定部分收益。");
  }
  if (position?.qty && pnlPct <= stopLossPct) {
    addScore("止损", -riskExitPenalty, 1, "持仓浮亏触发策略止损线，优先保护虚拟资金池。");
  }

  const buyThreshold = finite(strategy.buyThreshold, 68);
  const sellThreshold = finite(strategy.sellThreshold, 43);
  const boundedScore = Math.max(0, Math.min(100, score));
  let action = "hold";
  let intensity = "observe";
  if (!position?.qty && boundedScore >= buyThreshold && priceReadyForBuy) {
    action = "buy";
    intensity = boundedScore >= buyThreshold + 9 && atPullback ? "strong" : "probe";
  } else if (!position?.qty && boundedScore >= buyThreshold) {
    action = "hold";
    intensity = "observe";
    if (isOverExtended) {
      reasons.push(`价格已冲出 BOLL 上轨 ${close.toFixed(2)} > ${(boll.upper * 1.02).toFixed(2)}，与股票追踪“等回踩”建议保持一致，暂缓买入。`);
    } else if (!atPullback && !atBreakout) {
      reasons.push(`机会分 ${boundedScore.toFixed(1)} 已达标，但当前价 ${close.toFixed(2)} 不在回踩区 ${pullbackBuy.toFixed(2)} 或突破区 ${breakoutBuy.toFixed(2)}，等价格到位再建仓。`);
    }
  } else if (position?.qty && boundedScore <= sellThreshold) {
    action = "sell";
    intensity = boundedScore <= sellThreshold - 8 ? "exit" : "reduce";
  } else if (position?.qty && pnlPct >= takeProfitPct && close >= finite(boll?.upper, Infinity)) {
    action = "sell";
    intensity = "reduce";
    reasons.push("触及高位波动带且已有利润，虚拟账户执行部分止盈。");
  } else if (position?.qty && pnlPct <= stopLossPct) {
    action = "sell";
    intensity = "exit";
    reasons.push("达到策略止损线，历史模拟执行离场。");
  } else if (position?.qty && boundedScore >= buyThreshold + 5 && close > finite(position.avgCost)) {
    action = "hold";
    intensity = "ride";
  }

  return {
    code: stock.code || quote.code || "",
    name: quote.name || stock.name || "",
    action,
    intensity,
    score: Math.round(boundedScore * 10) / 10,
    price: close,
    changePct,
    technicalLabel: `${technical.macdLabel || "MACD"} · ${technical.sarLabel || "SAR"}`,
    levels: {
      buyLine: atPullback ? pullbackBuy : breakoutBuy,
      pullbackBuy,
      breakoutBuy,
      support,
      riskLine: Math.min(finite(bullGate?.lower, close * 0.97), finite(sarValue, close * 0.97)),
      stopLine: Math.min(finite(boll?.lower, close * 0.94), close * 0.94),
      takeProfitLine: Math.max(finite(boll?.upper, close * 1.06), close * 1.05)
    },
    indicators: {
      macd: { dif, dea, hist },
      sar: sarValue,
      boll,
      bullGate,
      volumeBoost,
      resonanceCount,
      contributions
    },
    orderPlan: buildSignalOrderPlan({ action, intensity, score: boundedScore, close, position, strategy, levels: { pullbackBuy, breakoutBuy } }),
    reasons: reasons.slice(0, 8),
    summary: action === "hold" && !position?.qty && boundedScore >= buyThreshold
      ? `指标偏强但价格未到位，机会分 ${boundedScore.toFixed(1)}；等回踩 ${pullbackBuy.toFixed(2)} 或放量突破 ${breakoutBuy.toFixed(2)} 再建仓。`
      : summarizeSignal(action, intensity, boundedScore)
  };
}

function buildSignalOrderPlan({ action, intensity, score, close, position = null, strategy = {}, levels = {} }) {
  if (action === "buy") {
    const scale = intensity === "strong" ? 1 : 0.55;
    return {
      text: intensity === "strong" ? "按单票仓位上限积极建仓" : "先用半仓位试仓，确认后再加",
      budgetScale: scale,
      trigger: `机会分达到 ${finite(strategy.buyThreshold, 68).toFixed(0)}，当前 ${score.toFixed(1)}；成交参考价 ${close.toFixed(2)}`
    };
  }
  if (action === "sell") {
    const scale = intensity === "exit" ? 1 : 0.5;
    return {
      text: intensity === "exit" ? "清仓退出，等待重新站回趋势线" : "先卖出约一半，锁定利润或降低风险",
      sellScale: scale,
      trigger: `机会分跌破 ${finite(strategy.sellThreshold, 43).toFixed(0)} 或触发高位止盈；当前 ${score.toFixed(1)}`
    };
  }
  if (position?.qty) {
    return {
      text: "继续持有，不主动加仓",
      trigger: `持仓 ${position.qty} 股，等待突破或风控信号`
    };
  }
  if (levels.pullbackBuy && levels.breakoutBuy) {
    return {
      text: "价格未进入建仓区，保持观察",
      trigger: `回踩 ${finite(levels.pullbackBuy).toFixed(2)} 或突破 ${finite(levels.breakoutBuy).toFixed(2)} 时再触发买入；当前机会分 ${score.toFixed(1)}`
    };
  }
  return {
    text: "观察等待，不动用虚拟资金",
    trigger: `机会分 ${score.toFixed(1)} 尚未达到买入阈值 ${finite(strategy.buyThreshold, 68).toFixed(0)}`
  };
}

function summarizeSignal(action, intensity, score) {
  if (action === "buy") return intensity === "strong" ? `强买入信号，机会分 ${score.toFixed(1)}` : `试仓买入信号，机会分 ${score.toFixed(1)}`;
  if (action === "sell") return intensity === "exit" ? `离场信号，机会分 ${score.toFixed(1)}` : `减仓信号，机会分 ${score.toFixed(1)}`;
  if (intensity === "ride") return `持仓顺势，让利润继续奔跑，机会分 ${score.toFixed(1)}`;
  return `等待更清晰触发，机会分 ${score.toFixed(1)}`;
}

function createVirtualTradingService({
  readVirtualTradingStore,
  writeVirtualTradingStore,
  saveVirtualStockStrategies,
  addVirtualTradingStock,
  removeVirtualTradingStock,
  initVirtualTradingAccount,
  setVirtualTradingEnabled,
  resetVirtualTradingAccount,
  getQuote,
  getStockKline,
  marketOf,
  kimiStrategyAdvisor
}) {
  function snapshot() {
    const store = readVirtualTradingStore();
    const chartRowsByCode = new Map((store.lastBacktest?.stockCharts || [])
      .map((chart) => [String(chart.stock?.code || "").trim(), compactChartRows(chart.rows || [])]));
    const watchlist = (store.watchlist || []).map((stock) => {
      if (Array.isArray(stock.klines) && stock.klines.length >= 2) return stock;
      const fallbackRows = chartRowsByCode.get(String(stock.code || "").trim()) || [];
      return fallbackRows.length >= 2 ? { ...stock, klines: fallbackRows } : stock;
    });
    const cash = finite(store.account?.cash);
    const positionValue = store.positions.reduce((sum, item) => sum + finite(item.marketValue), 0);
    const equity = cash + positionValue;
    const initial = finite(store.account?.initialCapital);
    return {
      ...store,
      watchlist,
      summary: {
        initialized: Boolean(store.account),
        enabled: Boolean(store.account?.enabled),
        cash,
        positionValue,
        equity,
        pnl: equity - initial,
        pnlPct: initial ? ((equity - initial) / initial) * 100 : 0,
        watchCount: store.watchlist.length,
        positionCount: store.positions.length
      }
    };
  }

  async function addStock(stock = {}) {
    const store = addVirtualTradingStock(stock);
    let initialStockStrategy = null;
    let initialStockStrategyError = "";
    let initialBacktest = null;
    let initialBacktestError = "";
    try {
      initialStockStrategy = await generateAndSaveStockStrategyForAddedStock(store, stock);
    } catch (error) {
      initialStockStrategyError = error.message || "初始化交易策略生成失败";
    }
    if (initialStockStrategy) {
      try {
        const replay = await runBacktest({ useOptimization: true });
        initialBacktest = replay.backtest || null;
      } catch (error) {
        initialBacktestError = error.message || "按组合最优解回放失败";
      }
    }
    return {
      ...snapshot(),
      initialStockStrategy,
      initialStockStrategyError,
      initialBacktest,
      initialBacktestError
    };
  }

  async function generateAndSaveStockStrategyForAddedStock(store = {}, stock = {}) {
    const code = cleanStrategyCode(stock.code);
    const savedStock = (store.watchlist || []).find((item) => item.code === code) || stock;
    if (!code || !savedStock) return null;
    const market = Number.isFinite(Number(savedStock.market)) ? Number(savedStock.market) : marketOf(code);
    const range = previousYearRange();
    const data = await getStockKline(code, market, { count: 420 });
    const rows = normalizeCandles(data?.klines || [])
      .map((row) => ({ ...row, day: normalizeDateText(row.day) }))
      .filter((row) => row.day && row.day >= range.startDate && row.day <= range.endDate);
    if (!rows.length) return null;
    const klineByCode = new Map([[code, { stock: { ...savedStock, market }, rows }]]);
    const dates = rows.map((row) => row.day).sort();
    const capital = Math.max(1, finite(store.account?.initialCapital, 100000));
    const advice = buildStockStrategyAdvice({
      klineByCode,
      dates,
      capital,
      baseStrategy: store.strategy || {},
      currentStockStrategies: store.stockStrategies || []
    });
    if (!advice.length) return null;
    const enriched = advice.map((item) => ({
      ...item,
      source: "add-stock-history-replay",
      summary: `${item.name || code} 已基于最近一年策略优化生成交易策略。${item.basis?.candidateName ? ` 候选：${item.basis.candidateName}。` : ""}`
    }));
    const { saved } = saveVirtualStockStrategies(enriched, { source: "add-stock-history-replay" });
    const refreshed = readVirtualTradingStore();
    writeVirtualTradingStore({
      ...refreshed,
      watchlist: (refreshed.watchlist || []).map((item) => item.code === code ? {
        ...item,
        klines: compactChartRows(rows)
      } : item)
    });
    return saved[0] || null;
  }

  async function runCycle({ reason = "manual", force = false, now: cycleNow = null } = {}) {
    let store = readVirtualTradingStore();
    if (!store.account) return { ...snapshot(), cycle: { reason, skipped: true, message: "尚未初始化虚拟账户" } };
    if (!store.account.enabled && !force) return { ...snapshot(), cycle: { reason, skipped: true, message: "虚拟交易未开启" } };
    const nowDate = cycleNow ? new Date(cycleNow) : new Date();
    const now = typeof cycleNow === "string" ? cycleNow : nowDate.toISOString();
    const trades = [...store.trades];
    const signals = [];
    const watchlist = [];
    const positions = [...store.positions];
    let cash = finite(store.account.cash);
    const tradeDate = tradeDateFromTime(now);
    unlockSellablePositions(positions, tradeDate);
    const livePortfolioStrategy = resolveLivePortfolioStrategy(store);

    for (const stock of store.watchlist) {
      try {
        const market = Number.isFinite(Number(stock.market)) ? Number(stock.market) : marketOf(stock.code);
        const quote = await getQuote(stock.code, market);
        const kline = await getStockKline(stock.code, quote.market ?? market).catch(() => null);
        const candles = normalizeCandles(kline?.klines || []);
        let position = positions.find((item) => item.code === stock.code) || null;
        const signal = buildVirtualSignal({
          stock,
          quote,
          candles,
          position,
          strategy: resolveStockStrategy(livePortfolioStrategy, store.stockStrategies, stock.code)
        });
        const stockStrategy = resolveStockStrategy(livePortfolioStrategy, store.stockStrategies, stock.code);
        const trade = executeVirtualTrade({ signal, quote, stock, position, positions, account: store.account, cash, strategy: stockStrategy, now });
        cash = trade.cash;
        if (trade.trade) trades.push(trade.trade);
        position = positions.find((item) => item.code === stock.code) || null;
        if (position) {
          position.lastPrice = signal.price;
          position.marketValue = position.qty * signal.price;
          position.cost = position.qty * position.avgCost;
          position.pnl = position.marketValue - position.cost;
          position.pnlPct = position.cost ? (position.pnl / position.cost) * 100 : 0;
          position.updatedAt = now;
        }
        const nextStock = {
          ...stock,
          name: quote.name || stock.name,
          market: quote.market ?? stock.market,
          lastPrice: signal.price,
          lastPct: quote.pct ?? signal.changePct,
          lastUpdatedAt: now,
          klines: compactChartRows(candles.length ? candles : stock.klines),
          lastSignal: signal
        };
        watchlist.push(nextStock);
        signals.push({ ...signal, traded: Boolean(trade.trade), trade: trade.trade || null });
      } catch (error) {
        watchlist.push({
          ...stock,
          lastSignal: {
            action: "hold",
            score: null,
            summary: `行情获取失败：${error.message}`,
            reasons: ["等待下一轮10分钟刷新重试。"]
          }
        });
        signals.push({ code: stock.code, name: stock.name, action: "hold", error: error.message });
      }
    }

    const positionValue = positions.reduce((sum, item) => sum + finite(item.marketValue), 0);
    const equity = cash + positionValue;
    const initial = finite(store.account.initialCapital);
    const equityCurve = [...store.equityCurve, {
      time: now,
      equity,
      cash,
      positionValue,
      pnl: equity - initial,
      pnlPct: initial ? ((equity - initial) / initial) * 100 : 0
    }];
    const equityPoint = {
      time: now,
      equity,
      cash,
      positionValue,
      pnl: equity - initial,
      pnlPct: initial ? ((equity - initial) / initial) * 100 : 0
    };
    const nextStrategy = learnFromVirtualResult(livePortfolioStrategy, {
      pnlPct: equityPoint.pnlPct,
      trades: trades.slice(-30),
      positions,
      equityCurve
    });
    store = writeVirtualTradingStore({
      ...store,
      account: {
        ...store.account,
        cash,
        updatedAt: now
      },
      watchlist,
      positions,
      trades,
      equityCurve,
      strategy: nextStrategy
    });
    return { ...snapshot(), cycle: { reason, updatedAt: now, signals } };
  }

  async function runBacktest({ startDate, endDate, initialCapital, strategyOverride, useOptimization = false } = {}) {
    const store = readVirtualTradingStore();
    if (!store.account && !Number(initialCapital)) throw new Error("请先设置虚拟满仓金额，或为回测输入初始资金");
    if (!store.watchlist.length) throw new Error("请先从股票详情页加入虚拟交易股票");
    const defaults = previousSixMonthRange();
    const start = normalizeDateText(startDate) || defaults.startDate;
    const end = normalizeDateText(endDate) || defaults.endDate;
    if (start > end) throw new Error("回测开始日期不能晚于结束日期");
    const capital = Math.max(0, finite(initialCapital, finite(store.account?.initialCapital)));
    if (!capital) throw new Error("请输入有效的回测初始资金");
    const klineByCode = new Map();
    const dateSet = new Set();
    const notes = [];
    const fetchCount = Math.max(260, Math.min(900, estimateTradingDays(start, end) + 120));

    for (const stock of store.watchlist) {
      const market = Number.isFinite(Number(stock.market)) ? Number(stock.market) : marketOf(stock.code);
      try {
        const data = await getStockKline(stock.code, market, { count: fetchCount });
        const rows = normalizeCandles(data?.klines || [])
          .map((row) => ({ ...row, day: normalizeDateText(row.day) }))
          .filter((row) => row.day && row.day <= end);
        const testRows = rows.filter((row) => row.day >= start && row.day <= end);
        if (!testRows.length) {
          notes.push(`${stock.name || stock.code} 在所选区间没有K线数据。`);
          continue;
        }
        klineByCode.set(stock.code, { stock: { ...stock, market }, rows });
        testRows.forEach((row) => dateSet.add(row.day));
      } catch (error) {
        notes.push(`${stock.name || stock.code} 历史K线获取失败：${error.message}`);
      }
    }
    if (!klineByCode.size || !dateSet.size) throw new Error("所选区间没有可用于回测的真实K线数据");

    let strategy = resolveBacktestStrategy(store, { strategyOverride, useOptimization });
    const startingStrategy = { ...strategy };
    const dates = [...dateSet].sort();
    const appliedStockStrategies = mergeStockStrategies(
      useOptimization && store.lastBacktest?.stockStrategyAdvice?.length ? store.lastBacktest.stockStrategyAdvice : [],
      store.stockStrategies
    );
    const simulation = simulateBacktestStrategy({ klineByCode, dates, capital, strategy, stockStrategies: appliedStockStrategies, adaptive: true });
    strategy = simulation.strategy;

    const finalPoint = simulation.equityCurve.at(-1) || { equity: capital, cash: capital, positionValue: 0, pnl: 0, pnlPct: 0 };
    const stats = virtualPerformanceStats({ trades: simulation.trades, equityCurve: simulation.equityCurve, positions: simulation.positions });
    const candidateResult = pickBestBacktestCandidate({ klineByCode, dates, capital, baseStrategy: startingStrategy, baseline: { stats, pnlPct: finalPoint.pnlPct, pnl: finalPoint.pnl } });
    const stockStrategyAdvice = buildStockStrategyAdvice({ klineByCode, dates, capital, baseStrategy: startingStrategy, currentStockStrategies: store.stockStrategies });
    const portfolioStrategyAdvice = buildPortfolioStrategyAdvice({
      klineByCode,
      dates,
      capital,
      baseStrategy: startingStrategy,
      baseline: { stats, pnlPct: finalPoint.pnlPct, pnl: finalPoint.pnl, tradeCount: simulation.trades.length },
      stockStrategyAdvice
    });
    const compactTrades = simulation.trades.slice(-160).map(compactBacktestTrade);
    const stockCharts = buildBacktestStockCharts(klineByCode, simulation.trades, start, end, simulation.positions, finalPoint.pnl);
    const aiAssist = await buildKimiStrategyAssist({
      kimiStrategyAdvisor,
      candidateResult,
      stats,
      pnlPct: finalPoint.pnlPct,
      pnl: finalPoint.pnl,
      stockStrategyAdvice
    });
    const optimizationAdvice = buildBacktestOptimizationAdvice({
      strategy,
      stats,
      pnlPct: finalPoint.pnlPct,
      pnl: finalPoint.pnl,
      trades: compactTrades,
      positions: simulation.positions,
      candidateResult,
      aiAssist
    });
    const result = {
      id: `backtest_${Date.now().toString(36)}`,
      startDate: start,
      endDate: end,
      createdAt: new Date().toISOString(),
      initialCapital: capital,
      finalEquity: finalPoint.equity,
      cash: finalPoint.cash,
      positionValue: finalPoint.positionValue,
      pnl: finalPoint.pnl,
      pnlPct: finalPoint.pnlPct,
      stats,
      startingStrategy,
      strategy: { ...strategy, stats },
      optimizationAdvice,
      stockStrategyAdvice,
      portfolioStrategyAdvice,
      optimizationApplied: Boolean(useOptimization || strategyOverride),
      watchlist: store.watchlist,
      positions: simulation.positions,
      trades: compactTrades,
      equityCurve: simulation.equityCurve,
      stockCharts,
      notes,
      signals: simulation.signals.slice(-60).map(compactBacktestSignal)
    };
    writeVirtualTradingStore({
      ...store,
      lastBacktest: result
    });
    return { ...snapshot(), backtest: result };
  }

  function applyBacktestStockStrategies() {
    const store = readVirtualTradingStore();
    const advice = store.lastBacktest?.stockStrategyAdvice || [];
    if (!advice.length) throw new Error("暂无可保存的单股优化策略，请先运行策略优化");
    const { saved } = saveVirtualStockStrategies(advice, { source: "backtest" });
    if (store.lastBacktest?.strategy) {
      writeVirtualTradingStore({
        ...readVirtualTradingStore(),
        strategy: {
          ...normalizeRuntimeStrategy(store.lastBacktest.strategy),
          updatedAt: new Date().toISOString(),
          note: store.lastBacktest.portfolioStrategyAdvice?.summary || store.lastBacktest.strategy.note || "已应用策略优化的组合全局优化策略。"
        }
      });
    }
    return {
      ...snapshot(),
      appliedStockStrategies: saved
    };
  }

  function saveStockStrategy({ code, name, strategy, summary, basis } = {}) {
    const clean = cleanStrategyCode(code);
    if (!clean) throw new Error("缺少股票代码");
    const stock = readVirtualTradingStore().watchlist.find((item) => item.code === clean) || {};
    const { saved } = saveVirtualStockStrategies([{
      code: clean,
      name: name || stock.name || clean,
      strategy: normalizeRuntimeStrategy(strategy || {}),
      source: "manual-stock",
      summary: summary || `${name || stock.name || clean} 手工保存单股交易策略`,
      basis: basis || {},
      updatedAt: new Date().toISOString()
    }], { source: "manual-stock" });
    return {
      ...snapshot(),
      appliedStockStrategies: saved
    };
  }

  return {
    snapshot,
    addStock,
    removeStock: removeVirtualTradingStock,
    initAccount: initVirtualTradingAccount,
    setEnabled: setVirtualTradingEnabled,
    resetAccount: resetVirtualTradingAccount,
    runCycle,
    runBacktest,
    applyBacktestStockStrategies,
    saveStockStrategy
  };
}

function resolveBacktestStrategy(store = {}, { strategyOverride } = {}) {
  return normalizeRuntimeStrategy({
    ...(store.strategy || {}),
    ...(strategyOverride || {})
  });
}

function cleanStrategyCode(value = "") {
  return String(value || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
}

function mergeStockStrategies(...groups) {
  const byCode = new Map();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const code = cleanStrategyCode(item.code || item.stock?.code);
      if (code && item.strategy) byCode.set(code, { ...item, code });
    }
  }
  return [...byCode.values()];
}

function stockStrategyMap(stockStrategies = []) {
  const map = new Map();
  for (const item of Array.isArray(stockStrategies) ? stockStrategies : []) {
    const code = cleanStrategyCode(item.code || item.stock?.code);
    if (code && item.strategy) map.set(code, item.strategy);
  }
  return map;
}

function resolveStockStrategy(baseStrategy = {}, stockStrategies = [], code = "") {
  const saved = stockStrategyMap(stockStrategies).get(cleanStrategyCode(code));
  return normalizeRuntimeStrategy({
    ...(baseStrategy || {}),
    ...(saved || {})
  });
}

function resolveLivePortfolioStrategy(store = {}) {
  const optimized = store.lastBacktest?.optimizationApplied && store.lastBacktest?.strategy
    ? store.lastBacktest.strategy
    : null;
  return normalizeRuntimeStrategy({
    ...(store.strategy || {}),
    ...(optimized || {})
  });
}

function simulateBacktestStrategy({ klineByCode, dates = [], capital = 0, strategy = {}, stockStrategies = [], adaptive = true } = {}) {
  let runtimeStrategy = normalizeRuntimeStrategy(strategy);
  const perStock = stockStrategyMap(stockStrategies);
  let cash = capital;
  const account = { initialCapital: capital, cash, enabled: true };
  const positions = [];
  const trades = [];
  const equityCurve = [];
  const signals = [];

  for (const day of dates) {
    for (const slot of BACKTEST_TRADING_SLOTS) {
      const priceByCode = new Map();
      const now = `${day}T${slot}:00.000+08:00`;
      unlockSellablePositions(positions, day);
      for (const { stock, rows } of klineByCode.values()) {
        const index = rows.findIndex((row) => row.day === day);
        if (index < 0) continue;
        const row = intradayCandle(rows[index], slot);
        priceByCode.set(stock.code, row.close);
        const candles = [...rows.slice(0, index), row];
        const prevClose = rows[index - 1]?.close || rows[index]?.open || row.close;
        const pct = prevClose ? ((row.close - prevClose) / prevClose) * 100 : 0;
        const position = positions.find((item) => item.code === stock.code) || null;
        const tradeStrategy = resolveStockStrategy(runtimeStrategy, [{ code: stock.code, strategy: perStock.get(stock.code) }], stock.code);
        const signal = buildVirtualSignal({
          stock,
          quote: { code: stock.code, name: stock.name, price: row.close, pct, market: stock.market },
          candles,
          position,
          strategy: tradeStrategy
        });
        const trade = executeVirtualTrade({
          signal,
          quote: { price: row.close },
          stock,
          position,
          positions,
          account,
          cash,
          strategy: tradeStrategy,
          now
        });
        cash = trade.cash;
        if (trade.trade) trades.push({ ...trade.trade, backtest: true });
        const nextPosition = positions.find((item) => item.code === stock.code) || null;
        if (nextPosition) markPosition(nextPosition, signal.price, now);
        signals.push({ day, slot, ...signal, traded: Boolean(trade.trade) });
      }
      const positionValue = markBacktestPositions(positions, klineByCode, day, priceByCode, now);
      const equity = cash + positionValue;
      const pnl = equity - capital;
      equityCurve.push({
        time: now,
        equity,
        cash,
        positionValue,
        pnl,
        pnlPct: capital ? (pnl / capital) * 100 : 0
      });
      if (adaptive) {
        runtimeStrategy = normalizeRuntimeStrategy(learnFromVirtualResult(runtimeStrategy, {
          pnlPct: capital ? ((equity - capital) / capital) * 100 : 0,
          trades: trades.slice(-60),
          positions,
          equityCurve
        }));
      }
    }
  }
  return {
    strategy: runtimeStrategy,
    positions,
    trades,
    equityCurve,
    signals
  };
}

function strategyCandidateScore({ pnlPct = 0, maxDrawdownPct = 0, winRate = 0, closedTrades = 0 } = {}) {
  const tradePenalty = closedTrades ? 0 : 3;
  return finite(pnlPct) + finite(maxDrawdownPct) * 0.45 + finite(winRate) * 0.025 - tradePenalty;
}

function buildStrategyCandidates(baseStrategy = {}) {
  const base = normalizeRuntimeStrategy(baseStrategy);
  const variants = [
    ["趋势突破增强", { buyThreshold: base.buyThreshold - 2, macdWeight: base.macdWeight + 0.12, bullGateWeight: base.bullGateWeight + 0.16, volumeWeight: base.volumeWeight + 0.06, takeProfitPct: base.takeProfitPct + 2 }],
    ["MACD提前响应", { buyThreshold: base.buyThreshold - 3, sellThreshold: base.sellThreshold + 1, macdWeight: base.macdWeight + 0.2, strongBuyBonus: base.strongBuyBonus + 2 }],
    ["SAR强风控", { buyThreshold: base.buyThreshold + 2, sellThreshold: base.sellThreshold + 3, sarWeight: base.sarWeight + 0.18, riskExitPenalty: base.riskExitPenalty + 2, stopLossPct: base.stopLossPct + 1 }],
    ["BOLL低吸修复", { buyThreshold: base.buyThreshold - 1, bollWeight: base.bollWeight + 0.18, maxSinglePositionPct: base.maxSinglePositionPct - 0.02, minCashPct: base.minCashPct + 0.01 }],
    ["强共振重仓", { buyThreshold: base.buyThreshold - 2, maxSinglePositionPct: base.maxSinglePositionPct + 0.04, minCashPct: base.minCashPct - 0.02, strongBuyBonus: base.strongBuyBonus + 3, bullGateWeight: base.bullGateWeight + 0.1 }],
    ["防守回撤压制", { buyThreshold: base.buyThreshold + 4, sellThreshold: base.sellThreshold + 4, maxSinglePositionPct: base.maxSinglePositionPct - 0.04, minCashPct: base.minCashPct + 0.04, sarWeight: base.sarWeight + 0.16, stopLossPct: base.stopLossPct + 1.5 }]
  ];
  return [
    { name: "当前策略", strategy: base },
    ...variants.map(([name, patch]) => ({ name, strategy: normalizeRuntimeStrategy({ ...base, ...patch }) }))
  ];
}

function pickBestBacktestCandidate({ klineByCode, dates, capital, baseStrategy = {}, baseline = {} } = {}) {
  const candidates = buildStrategyCandidates(baseStrategy);
  const rows = candidates.map((candidate) => {
    const simulation = simulateBacktestStrategy({ klineByCode, dates, capital, strategy: candidate.strategy, adaptive: true });
    const finalPoint = simulation.equityCurve.at(-1) || { equity: capital, pnl: 0, pnlPct: 0 };
    const stats = virtualPerformanceStats({ trades: simulation.trades, equityCurve: simulation.equityCurve, positions: simulation.positions });
    return {
      name: candidate.name,
      strategy: candidate.strategy,
      pnl: finalPoint.pnl,
      pnlPct: finalPoint.pnlPct,
      stats,
      score: strategyCandidateScore({ pnlPct: finalPoint.pnlPct, maxDrawdownPct: stats.maxDrawdownPct, winRate: stats.winRate, closedTrades: stats.closedTrades })
    };
  });
  const baselineScore = strategyCandidateScore({ pnlPct: baseline.pnlPct, maxDrawdownPct: baseline.stats?.maxDrawdownPct, winRate: baseline.stats?.winRate, closedTrades: baseline.stats?.closedTrades });
  const best = rows.sort((a, b) => b.score - a.score)[0] || null;
  return {
    baselineScore,
    best,
    candidates: rows.slice(0, 4).map((item) => ({
      name: item.name,
      pnl: item.pnl,
      pnlPct: item.pnlPct,
      maxDrawdownPct: item.stats?.maxDrawdownPct,
      winRate: item.stats?.winRate,
      score: item.score
    }))
  };
}

function buildStockStrategyAdvice({ klineByCode, dates = [], capital = 0, baseStrategy = {}, currentStockStrategies = [] } = {}) {
  const rows = [];
  for (const [code, record] of klineByCode.entries()) {
    const stockDates = dates.filter((day) => (record.rows || []).some((row) => row.day === day));
    if (!stockDates.length) continue;
    const singleMap = new Map([[code, record]]);
    const currentStrategy = resolveStockStrategy(baseStrategy, currentStockStrategies, code);
    const baselineSimulation = simulateBacktestStrategy({ klineByCode: singleMap, dates: stockDates, capital, strategy: currentStrategy, adaptive: true });
    const finalPoint = baselineSimulation.equityCurve.at(-1) || { pnl: 0, pnlPct: 0 };
    const stats = virtualPerformanceStats({
      trades: baselineSimulation.trades,
      equityCurve: baselineSimulation.equityCurve,
      positions: baselineSimulation.positions
    });
    const candidate = pickBestBacktestCandidate({
      klineByCode: singleMap,
      dates: stockDates,
      capital,
      baseStrategy: currentStrategy,
      baseline: { stats, pnlPct: finalPoint.pnlPct, pnl: finalPoint.pnl }
    });
    const best = candidate.best || {
      name: "当前策略",
      strategy: currentStrategy,
      pnl: finalPoint.pnl,
      pnlPct: finalPoint.pnlPct,
      stats,
      score: strategyCandidateScore({ pnlPct: finalPoint.pnlPct, maxDrawdownPct: stats.maxDrawdownPct, winRate: stats.winRate, closedTrades: stats.closedTrades })
    };
    const improved = best.score > finite(candidate.baselineScore) + 0.25;
    const chosen = improved ? normalizeRuntimeStrategy(best.strategy) : normalizeRuntimeStrategy(baselineSimulation.strategy || currentStrategy);
    rows.push({
      code,
      name: record.stock?.name || code,
      strategy: chosen,
      source: "backtest-stock",
      summary: improved
        ? `${record.stock?.name || code} 适合采用“${best.name}”，单股回测收益 ${finite(best.pnlPct).toFixed(2)}%。`
        : `${record.stock?.name || code} 当前策略已接近最优，建议保存当前自适应策略。`,
      basis: {
        candidateName: best.name,
        pnl: best.pnl,
        pnlPct: best.pnlPct,
        baselinePnl: finalPoint.pnl,
        baselinePnlPct: finalPoint.pnlPct,
        maxDrawdownPct: best.stats?.maxDrawdownPct,
        winRate: best.stats?.winRate,
        score: best.score,
        baselineScore: candidate.baselineScore,
        tested: candidate.candidates
      },
      updatedAt: new Date().toISOString()
    });
  }
  return rows;
}

function buildPortfolioStrategyAdvice({ klineByCode, dates = [], capital = 0, baseStrategy = {}, baseline = {}, stockStrategyAdvice = [] } = {}) {
  if (!stockStrategyAdvice.length) {
    return {
      title: "等待单股策略",
      summary: "本次策略优化没有生成可组合的单股策略。",
      pnl: 0,
      pnlPct: 0,
      maxDrawdownPct: 0,
      winRate: 0,
      closedTrades: 0,
      tradeCount: 0,
      reasons: []
    };
  }
  const simulation = simulateBacktestStrategy({
    klineByCode,
    dates,
    capital,
    strategy: baseStrategy,
    stockStrategies: stockStrategyAdvice,
    adaptive: true
  });
  const finalPoint = simulation.equityCurve.at(-1) || { pnl: 0, pnlPct: 0 };
  const stats = virtualPerformanceStats({ trades: simulation.trades, equityCurve: simulation.equityCurve, positions: simulation.positions });
  const pnlDelta = finite(finalPoint.pnlPct) - finite(baseline.pnlPct);
  const drawdownText = finite(stats.maxDrawdownPct) > finite(baseline.stats?.maxDrawdownPct)
    ? "组合回撤较基线改善"
    : "组合回撤仍需控制";
  const bestStocks = [...stockStrategyAdvice]
    .sort((a, b) => finite(b.basis?.score) - finite(a.basis?.score))
    .slice(0, 3)
    .map((item) => `${item.name || item.code}(${finite(item.basis?.pnlPct).toFixed(2)}%)`);
  return {
    title: pnlDelta >= 0 ? "单股策略组合优先" : "单股策略组合需谨慎",
    summary: `使用每只股票的独立最优策略进行组合回放，组合收益 ${finite(finalPoint.pnlPct).toFixed(2)}%，较当前回放${pnlDelta >= 0 ? "提升" : "回落"} ${Math.abs(pnlDelta).toFixed(2)} 个百分点。`,
    pnl: finalPoint.pnl,
    pnlPct: finalPoint.pnlPct,
    maxDrawdownPct: stats.maxDrawdownPct,
    winRate: stats.winRate,
    closedTrades: stats.closedTrades,
    tradeCount: simulation.trades.length,
    reasons: [
      `组合使用 ${stockStrategyAdvice.length} 只股票的独立交易策略，后续模拟交易会按股票代码分别读取。`,
      bestStocks.length ? `贡献优先关注：${bestStocks.join("、")}。` : "",
      drawdownText,
      pnlDelta >= 0 ? "建议保存单股策略后再做下一轮策略优化验证。" : "建议逐只调高买入阈值或降低单票上限后再优化。"
    ].filter(Boolean)
  };
}

async function buildKimiStrategyAssist({ kimiStrategyAdvisor, candidateResult, stats = {}, pnlPct = 0, pnl = 0, stockStrategyAdvice = [] } = {}) {
  if (typeof kimiStrategyAdvisor !== "function") {
    return { used: false, summary: "", suggestions: [], error: "" };
  }
  try {
    const data = await kimiStrategyAdvisor({
      baseline: {
        pnl,
        pnlPct,
        winRate: stats.winRate,
        maxDrawdownPct: stats.maxDrawdownPct,
        closedTrades: stats.closedTrades
      },
      bestCandidate: candidateResult?.best ? {
        name: candidateResult.best.name,
        pnl: candidateResult.best.pnl,
        pnlPct: candidateResult.best.pnlPct,
        score: candidateResult.best.score,
        maxDrawdownPct: candidateResult.best.stats?.maxDrawdownPct,
        winRate: candidateResult.best.stats?.winRate
      } : null,
      candidates: candidateResult?.candidates || [],
      stockStrategies: (stockStrategyAdvice || []).slice(0, 8).map((item) => ({
        code: item.code,
        name: item.name,
        summary: item.summary,
        pnlPct: item.basis?.pnlPct,
        maxDrawdownPct: item.basis?.maxDrawdownPct,
        winRate: item.basis?.winRate
      }))
    });
    if (!data) return { used: false, summary: "", suggestions: [], error: "未配置模型 AK" };
    return {
      used: true,
      summary: String(data?.summary || "").trim(),
      suggestions: Array.isArray(data?.suggestions) ? data.suggestions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6) : [],
      riskNote: String(data?.riskNote || "").trim(),
      preferredCandidate: String(data?.preferredCandidate || "").trim(),
      error: ""
    };
  } catch (error) {
    return { used: false, summary: "", suggestions: [], error: error.message };
  }
}

function strategyDiffChanges(current = {}, proposed = {}) {
  const labels = {
    buyThreshold: "买入阈值",
    sellThreshold: "卖出阈值",
    maxSinglePositionPct: "单票上限",
    minCashPct: "现金保护",
    macdWeight: "MACD权重",
    sarWeight: "SAR权重",
    bollWeight: "BOLL权重",
    bullGateWeight: "牛门线权重",
    volumeWeight: "量能权重",
    strongBuyBonus: "强共振加分",
    riskExitPenalty: "破位扣分",
    takeProfitPct: "止盈线",
    stopLossPct: "止损线"
  };
  return Object.entries(labels)
    .filter(([key]) => Math.abs(finite(current[key]) - finite(proposed[key])) > 0.001)
    .map(([key, label]) => `${label} ${fmtStrategyValue(current[key])} -> ${fmtStrategyValue(proposed[key])}`)
    .slice(0, 8);
}

function fmtStrategyValue(value) {
  const n = finite(value);
  return Math.abs(n) < 1 ? `${(n * 100).toFixed(1)}%` : n.toFixed(2).replace(/\.00$/, "");
}

function buildBacktestOptimizationAdvice({ strategy = {}, stats = {}, pnlPct = 0, pnl = 0, trades = [], positions = [], candidateResult = null, aiAssist = null } = {}) {
  const proposed = { ...strategy };
  const changes = [];
  const suggestions = [];
  const winRate = finite(stats.winRate);
  const drawdown = finite(stats.maxDrawdownPct);
  const closedTrades = finite(stats.closedTrades);
  const hasOpenRisk = (positions || []).some((item) => finite(item.pnlPct) < -4);
  const candidateBasis = candidateResult?.best ? {
    name: candidateResult.best.name,
    pnl: candidateResult.best.pnl,
    pnlPct: candidateResult.best.pnlPct,
    score: candidateResult.best.score,
    baselineScore: candidateResult.baselineScore,
    maxDrawdownPct: candidateResult.best.stats?.maxDrawdownPct,
    winRate: candidateResult.best.stats?.winRate,
    tested: candidateResult.candidates
  } : null;

  if (candidateResult?.best && candidateResult.best.score > finite(candidateResult.baselineScore) + 0.25) {
    const boundedBest = normalizeRuntimeStrategy(candidateResult.best.strategy);
    const diff = strategyDiffChanges(strategy, boundedBest);
    return {
      summary: `候选策略“${candidateResult.best.name}”综合分更优，回测收益 ${finite(candidateResult.best.pnlPct).toFixed(2)}%，建议采纳后重新模拟。${aiAssist?.summary ? ` Kimi辅助：${aiAssist.summary}` : ""}`,
      changes: [...(diff.length ? diff : [`采用候选策略：${candidateResult.best.name}`]), ...(aiAssist?.suggestions || []).map((item) => `Kimi：${item}`)].slice(0, 8),
      proposedStrategy: {
        ...boundedBest,
        updatedAt: new Date().toISOString(),
        note: `来自策略优化候选回测：${candidateResult.best.name}，收益/回撤综合分更优。`
      },
      basis: {
        pnl,
        pnlPct,
        winRate,
        maxDrawdownPct: drawdown,
        closedTrades,
        tradeCount: trades.length,
        aiAssist,
        candidate: candidateBasis
      }
    };
  }

  if (pnlPct > 5 && drawdown > -6 && (closedTrades < 3 || winRate >= 50)) {
    proposed.buyThreshold = Math.max(60, finite(proposed.buyThreshold, 68) - 2);
    proposed.maxSinglePositionPct = Math.min(0.34, finite(proposed.maxSinglePositionPct, 0.22) + 0.025);
    proposed.minCashPct = Math.max(0.04, finite(proposed.minCashPct, 0.08) - 0.01);
    proposed.macdWeight = Math.min(1.55, finite(proposed.macdWeight, 1.18) + 0.05);
    proposed.bullGateWeight = Math.min(1.65, finite(proposed.bullGateWeight, 1.22) + 0.06);
    proposed.strongBuyBonus = Math.min(14, finite(proposed.strongBuyBonus, 9) + 1);
    proposed.takeProfitPct = Math.min(18, finite(proposed.takeProfitPct, 12) + 1);
    changes.push("降低买入阈值2分", "提高单票仓位上限2.5个百分点", "降低现金保护1个百分点", "提高MACD/牛门线进攻权重", "延后止盈1个百分点");
    suggestions.push("收益和回撤都健康，可以让策略更积极，优先捕捉强趋势延续。");
  } else if (pnlPct < 0 || drawdown <= -6 || (closedTrades >= 3 && winRate < 45) || hasOpenRisk) {
    proposed.buyThreshold = Math.min(82, finite(proposed.buyThreshold, 68) + 3);
    proposed.sellThreshold = Math.min(54, finite(proposed.sellThreshold, 43) + 2);
    proposed.maxSinglePositionPct = Math.max(0.1, finite(proposed.maxSinglePositionPct, 0.22) - 0.025);
    proposed.minCashPct = Math.min(0.2, finite(proposed.minCashPct, 0.08) + 0.015);
    proposed.sarWeight = Math.min(1.55, finite(proposed.sarWeight, 1.12) + 0.08);
    proposed.riskExitPenalty = Math.min(18, finite(proposed.riskExitPenalty, 12) + 1.2);
    proposed.stopLossPct = Math.max(-5, finite(proposed.stopLossPct, -7) + 0.8);
    proposed.bollWeight = Math.min(1.35, finite(proposed.bollWeight, 1.04) + 0.04);
    changes.push("提高买入阈值3分", "提高卖出触发2分", "降低单票仓位上限2.5个百分点", "提高现金保护1.5个百分点", "强化SAR/止损风控", "提高BOLL位置约束");
    suggestions.push("收益或回撤不理想，下一轮应减少试错成本，并让风险信号更早触发。");
  } else {
    proposed.sellThreshold = Math.max(38, finite(proposed.sellThreshold, 43) - 1);
    proposed.maxSinglePositionPct = Math.min(0.3, finite(proposed.maxSinglePositionPct, 0.22) + 0.01);
    proposed.volumeWeight = Math.min(1.3, finite(proposed.volumeWeight, 1.08) + 0.03);
    proposed.bullGateWeight = Math.min(1.45, finite(proposed.bullGateWeight, 1.22) + 0.03);
    changes.push("卖出阈值下调1分", "单票仓位上限提高1个百分点", "小幅提高量能/牛门线确认权重");
    suggestions.push("当前结果偏中性，可以小幅延长盈利持仓，观察趋势收益是否改善。");
  }

  const boundedProposed = normalizeRuntimeStrategy(proposed);
  boundedProposed.updatedAt = new Date().toISOString();
  boundedProposed.note = `来自策略优化的建议：${suggestions[0] || "保持策略稳定，继续观察样本。"}`;
  return {
    summary: aiAssist?.summary ? `${suggestions[0] || "保持当前策略，等待更多样本。"} Kimi辅助：${aiAssist.summary}` : (suggestions[0] || "保持当前策略，等待更多样本。"),
    changes: [...changes, ...(aiAssist?.suggestions || []).map((item) => `Kimi：${item}`)].slice(0, 8),
    proposedStrategy: boundedProposed,
    basis: {
      pnl,
      pnlPct,
      winRate,
      maxDrawdownPct: drawdown,
      closedTrades,
      tradeCount: trades.length,
      aiAssist,
      candidate: candidateBasis
    }
  };
}

function compactBacktestTrade(trade = {}) {
  return {
    id: trade.id,
    time: trade.time,
    side: trade.side,
    code: trade.code,
    name: trade.name,
    qty: trade.qty,
    price: trade.price,
    amount: trade.amount,
    realizedPnl: trade.realizedPnl,
    realizedPnlPct: trade.realizedPnlPct,
    score: trade.score,
    reason: trade.reason,
    signal: compactBacktestSignal(trade.signal || {})
  };
}

function compactBacktestSignal(signal = {}) {
  return {
    day: signal.day,
    code: signal.code,
    name: signal.name,
    action: signal.action,
    intensity: signal.intensity,
    score: signal.score,
    price: signal.price,
    technicalLabel: signal.technicalLabel,
    summary: signal.summary,
    orderPlan: signal.orderPlan,
    levels: signal.levels,
    reasons: Array.isArray(signal.reasons) ? signal.reasons.slice(0, 4) : []
  };
}

function buildBacktestStockCharts(klineByCode, trades = [], startDate, endDate, positions = [], totalPnl = 0) {
  const charts = [];
  for (const [code, record] of klineByCode.entries()) {
    const rows = (record.rows || [])
      .filter((row) => row.day >= startDate && row.day <= endDate)
      .map((row) => ({
        day: row.day,
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume
      }));
    const stockTrades = trades.filter((trade) => trade.code === code);
    const realizedPnl = stockTrades
      .filter((trade) => trade.side === "sell" && Number.isFinite(Number(trade.realizedPnl)))
      .reduce((sum, trade) => sum + finite(trade.realizedPnl), 0);
    const openPnl = (positions || [])
      .filter((position) => position.code === code)
      .reduce((sum, position) => sum + finite(position.pnl), 0);
    const contribution = realizedPnl + openPnl;
    const contributionPct = finite(totalPnl) ? (contribution / finite(totalPnl)) * 100 : 0;
    charts.push({
      stock: record.stock,
      rows,
      trades: stockTrades.slice(-200).map(compactBacktestTrade),
      contribution: {
        amount: contribution,
        pct: contributionPct,
        realizedPnl,
        openPnl
      }
    });
  }
  return charts;
}

function estimateTradingDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00+08:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 260;
  return Math.ceil((end - start) / 86_400_000 / 7 * 5) + 10;
}

function markPosition(position, price, time) {
  position.lastPrice = price;
  position.marketValue = position.qty * price;
  position.cost = position.qty * position.avgCost;
  position.pnl = position.marketValue - position.cost;
  position.pnlPct = position.cost ? (position.pnl / position.cost) * 100 : 0;
  position.updatedAt = time;
  return position;
}

function unlockSellablePositions(positions = [], tradeDate = "") {
  for (const position of positions) {
    if (!position?.qty) continue;
    if (!position.lastBuyDate || position.lastBuyDate !== tradeDate) {
      position.availableQty = position.qty;
    } else {
      position.availableQty = Math.max(0, Math.min(position.qty, finite(position.availableQty)));
    }
  }
  return positions;
}

function markBacktestPositions(positions, klineByCode, day, priceByCode = new Map(), time = `${day}T15:00:00.000+08:00`) {
  let total = 0;
  for (const position of positions) {
    const record = klineByCode.get(position.code);
    const latest = record?.rows?.filter((row) => row.day <= day).at(-1);
    const price = priceByCode.get(position.code) || latest?.close;
    if (price) markPosition(position, price, time);
    total += finite(position.marketValue);
  }
  return total;
}

function executeVirtualTrade({ signal, quote = {}, stock, position, positions, account, cash, strategy, now }) {
  const price = finite(signal.price);
  if (!price || !account) return { cash, trade: null };
  const tradeDate = tradeDateFromTime(now);
  const changePct = Number.isFinite(Number(quote.pct)) ? Number(quote.pct) : finite(signal.changePct);
  const nearLimitUp = changePct >= 9.8;
  const nearLimitDown = changePct <= -9.8;
  const initial = finite(account.initialCapital);
  const maxPosition = initial * finite(strategy.maxSinglePositionPct, 0.22);
  const minCash = initial * finite(strategy.minCashPct, 0.08);

  if (signal.action === "buy") {
    if (nearLimitUp) return { cash, trade: null };
    const currentValue = finite(position?.marketValue);
    const room = Math.max(0, maxPosition - currentValue);
    const aggressiveScale = finite(signal.orderPlan?.budgetScale, signal.intensity === "strong" ? 1 : 0.55);
    const budget = Math.min(room, Math.max(0, cash - minCash), maxPosition * aggressiveScale);
    const qty = roundLot(Math.floor(budget / price));
    if (qty < 100) return { cash, trade: null };
    const amount = qty * price;
    const existingIndex = positions.findIndex((item) => item.code === stock.code);
    if (existingIndex >= 0) {
      const old = positions[existingIndex];
      const nextQty = old.qty + qty;
      positions[existingIndex] = {
        ...old,
        qty: nextQty,
        availableQty: Math.max(0, Math.min(old.qty, finite(old.availableQty, old.qty))),
        avgCost: (old.avgCost * old.qty + amount) / nextQty,
        lastBuyDate: tradeDate,
        updatedAt: now
      };
    } else {
      positions.push({
        code: stock.code,
        name: signal.name || stock.name,
        market: stock.market,
        qty,
        availableQty: 0,
        avgCost: price,
        cost: amount,
        lastPrice: price,
        marketValue: amount,
        pnl: 0,
        pnlPct: 0,
        openedAt: now,
        lastBuyDate: tradeDate,
        updatedAt: now
      });
    }
    return {
      cash: cash - amount,
      trade: createTrade({ side: "buy", stock, signal, qty, price, amount, now })
    };
  }

  if (signal.action === "sell" && position?.qty) {
    if (nearLimitDown) return { cash, trade: null };
    const sellRatio = finite(signal.orderPlan?.sellScale, signal.intensity === "exit" ? 1 : 0.5);
    const sellableQty = Math.max(0, Math.min(position.qty, finite(position.availableQty, position.qty)));
    const qty = Math.min(sellableQty, roundLot(Math.floor(position.qty * sellRatio)));
    if (qty < 100) return { cash, trade: null };
    const amount = qty * price;
    const costBasis = finite(position.avgCost) * qty;
    const realizedPnl = amount - costBasis;
    const realizedPnlPct = costBasis ? (realizedPnl / costBasis) * 100 : 0;
    const index = positions.findIndex((item) => item.code === stock.code);
    if (qty >= position.qty) {
      positions.splice(index, 1);
    } else {
      positions[index] = {
        ...position,
        qty: position.qty - qty,
        availableQty: Math.max(0, sellableQty - qty),
        lastSellDate: tradeDate,
        updatedAt: now
      };
    }
    return {
      cash: cash + amount,
      trade: createTrade({ side: "sell", stock, signal, qty, price, amount, now, realizedPnl, realizedPnlPct })
    };
  }

  return { cash, trade: null };
}

function createTrade({ side, stock, signal, qty, price, amount, now, realizedPnl = null, realizedPnlPct = null }) {
  return {
    id: `${now}_${stock.code}_${side}_${Math.random().toString(36).slice(2, 7)}`,
    time: now,
    side,
    code: stock.code,
    name: signal.name || stock.name || stock.code,
    qty,
    price,
    amount,
    realizedPnl,
    realizedPnlPct,
    score: signal.score,
    reason: signal.reasons?.[0] || signal.summary,
    signal
  };
}

function learnFromVirtualResult(strategy = {}, result = {}) {
  const next = { ...strategy };
  const pnlPct = finite(result.pnlPct);
  const stats = virtualPerformanceStats(result);
  const riskPressure = stats.maxDrawdownPct <= -7 || pnlPct <= -3;
  const strongFeedback = pnlPct >= 5 || (stats.closedTrades >= 3 && stats.winRate >= 62 && stats.realizedPnl > 0);
  const hasPositions = (result.positions || []).length > 0;
  const lr = finite(next.learningRate, 0.08);
  if (strongFeedback && !riskPressure) {
    next.buyThreshold = Math.max(61, finite(next.buyThreshold, 68) - lr * 3.2);
    next.sellThreshold = Math.max(36, finite(next.sellThreshold, 43) - lr * 1.6);
    next.maxSinglePositionPct = Math.min(0.34, finite(next.maxSinglePositionPct, 0.22) + lr * 0.018);
    next.minCashPct = Math.max(0.04, finite(next.minCashPct, 0.08) - lr * 0.006);
    next.macdWeight = Math.min(1.55, finite(next.macdWeight, 1.18) + lr * 0.08);
    next.bullGateWeight = Math.min(1.65, finite(next.bullGateWeight, 1.22) + lr * 0.1);
    next.takeProfitPct = Math.min(18, finite(next.takeProfitPct, 12) + lr * 1.2);
    next.note = `虚拟收益与胜率反馈偏强，策略下调买入门槛并提高单票试仓上限；当前胜率 ${stats.winRate.toFixed(0)}%，最大回撤 ${stats.maxDrawdownPct.toFixed(1)}%。`;
  } else if (riskPressure || stats.winRate < 38 && stats.closedTrades >= 3) {
    next.buyThreshold = Math.min(80, finite(next.buyThreshold, 68) + lr * 4.2);
    next.sellThreshold = Math.min(52, finite(next.sellThreshold, 43) + lr * 2.4);
    next.maxSinglePositionPct = Math.max(0.1, finite(next.maxSinglePositionPct, 0.22) - lr * 0.024);
    next.minCashPct = Math.min(0.18, finite(next.minCashPct, 0.08) + lr * 0.012);
    next.sarWeight = Math.min(1.55, finite(next.sarWeight, 1.12) + lr * 0.12);
    next.bollWeight = Math.min(1.35, finite(next.bollWeight, 1.04) + lr * 0.06);
    next.riskExitPenalty = Math.min(18, finite(next.riskExitPenalty, 12) + lr * 1.8);
    next.stopLossPct = Math.max(-5, finite(next.stopLossPct, -7) + lr * 1.1);
    next.note = `虚拟账户回撤或胜率不佳，策略提高买入门槛并降低单票仓位；当前胜率 ${stats.winRate.toFixed(0)}%，最大回撤 ${stats.maxDrawdownPct.toFixed(1)}%。`;
  } else if (hasPositions && pnlPct > 0) {
    next.sellThreshold = Math.max(38, finite(next.sellThreshold, 43) - lr);
    next.volumeWeight = Math.min(1.3, finite(next.volumeWeight, 1.08) + lr * 0.04);
    next.note = `持仓已有浮盈但样本不足，策略保持进攻节奏，暂不大幅调参；当前收益 ${pnlPct.toFixed(1)}%。`;
  } else {
    next.note = `收益处于观察区，策略保持当前节奏；当前胜率 ${stats.winRate.toFixed(0)}%，最大回撤 ${stats.maxDrawdownPct.toFixed(1)}%。`;
  }
  next.stats = stats;
  next.updatedAt = new Date().toISOString();
  return normalizeRuntimeStrategy(next);
}

function virtualPerformanceStats(result = {}) {
  const trades = Array.isArray(result.trades) ? result.trades : [];
  const closed = trades.filter((item) => item.side === "sell" && Number.isFinite(Number(item.realizedPnl)));
  const wins = closed.filter((item) => Number(item.realizedPnl) > 0);
  const realizedPnl = closed.reduce((sum, item) => sum + finite(item.realizedPnl), 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const equityCurve = Array.isArray(result.equityCurve) ? result.equityCurve : [];
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    const equity = finite(point.equity, NaN);
    if (!Number.isFinite(equity)) continue;
    peak = Math.max(peak, equity);
    if (peak > 0) {
      const drawdown = ((equity - peak) / peak) * 100;
      maxDrawdownPct = Math.min(maxDrawdownPct, drawdown);
    }
  }
  return {
    closedTrades: closed.length,
    wins: wins.length,
    winRate,
    realizedPnl,
    maxDrawdownPct,
    openPositions: Array.isArray(result.positions) ? result.positions.length : 0
  };
}

module.exports = {
  bollSnapshot,
  buildVirtualSignal,
  bullGateSnapshot,
  createVirtualTradingService,
  executeVirtualTrade,
  learnFromVirtualResult,
  resolveLivePortfolioStrategy,
  virtualPerformanceStats,
  normalizeCandles
};
