const { toFixedText } = require("../utils/number");
const { CN_MARKET_CLOSED_DATES_2026 } = require("../config");

const DEFAULT_CONFIG = {
  minKlines: 40,
  maxStocks: 6000,
  minAmount: 30_000_000,
  klineCount: 80,
  concurrency: 20,
  scoreThreshold: 60,
  strongThreshold: 70,
  triggerThreshold: 85,
  noConfirmScoreThreshold: 45,
  noConfirmStrongThreshold: 55,
  noConfirmTriggerThreshold: 60
};

function parseMarketDate(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 4, 0, 0));
}

function formatDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isTradingDay(dateText) {
  const weekday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short"
  }).format(new Date(`${dateText}T12:00:00+08:00`));
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !CN_MARKET_CLOSED_DATES_2026.has(dateText);
}

function previousTradingDay(fromDate = new Date()) {
  const date = typeof fromDate === "string" ? parseMarketDate(fromDate) : new Date(fromDate);
  for (let i = 0; i < 30; i += 1) {
    date.setDate(date.getDate() - 1);
    const text = formatDate(date);
    if (isTradingDay(text)) return text;
  }
  return formatDate(date);
}

function latestTradingDay(fromDate = new Date()) {
  const date = typeof fromDate === "string" ? parseMarketDate(fromDate) : new Date(fromDate);
  const text = formatDate(date);
  if (isTradingDay(text)) return text;
  return previousTradingDay(date);
}

function findPinAndConfirm(klines, targetDate) {
  const pinIndex = klines.findIndex((item) => item.day === targetDate);
  if (pinIndex < 0 || pinIndex >= klines.length) return null;
  return {
    pin: klines[pinIndex],
    confirm: pinIndex + 1 < klines.length ? klines[pinIndex + 1] : null,
    history: klines.slice(0, pinIndex)
  };
}

function createGoldenPinService({ getAllAshares, getStockKline, config = {} } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cacheByDate = new Map();
  const running = new Set();

  function ma(candles, window) {
    if (candles.length < window) return null;
    const sum = candles.slice(-window).reduce((s, item) => s + Number(item.close), 0);
    return sum / window;
  }

  function computePatternScore(pin) {
    const open = Number(pin.open);
    const close = Number(pin.close);
    const high = Number(pin.high);
    const low = Number(pin.low);
    if (![open, close, high, low].every(Number.isFinite)) return { score: 0, details: {} };

    const body = Math.abs(close - open);
    const lowerShadow = Math.min(open, close) - low;
    const upperShadow = high - Math.max(open, close);
    const range = high - low;
    if (range <= 0 || body <= 0) return { score: 0, details: {} };

    // 金针探底只取收涨 K 线，实体占振幅比例大于 10%，且上影线占振幅比例小于 10%，
    // 过滤死线形态（一字跌停、长阴线、冲高回落等）。
    if (close < open) return { score: 0, details: {} };
    if (body / range <= 0.1) return { score: 0, details: {} };
    if (upperShadow / range >= 0.1) return { score: 0, details: {} };

    const d1 = lowerShadow / body >= 2 ? 10 : 0;
    const d2 = lowerShadow / range >= 0.7 ? 10 : 0;
    const d3 = ((high - close) / range) <= 0.3 ? 8 : 0;
    const d4 = (body / range) < (1 / 3) ? 7 : 0;
    const d5 = upperShadow > 0 && lowerShadow / upperShadow >= 3 ? 5 : 0;

    return {
      score: d1 + d2 + d3 + d4 + d5,
      details: {
        lowerShadowBodyRatio: lowerShadow / body,
        lowerShadowRangeRatio: lowerShadow / range,
        closeToHighRatio: (high - close) / range,
        bodyRangeRatio: body / range,
        lowerUpperRatio: upperShadow > 0 ? lowerShadow / upperShadow : Infinity
      }
    };
  }

  function computePositionScore(pin, history) {
    const close = Number(pin.close);
    if (!Number.isFinite(close) || history.length < 20) return { score: 0, details: {} };

    const closes = history.map((item) => Number(item.close)).filter(Number.isFinite);
    if (closes.length < 20) return { score: 0, details: {} };

    const minClose = Math.min(...closes);
    const maxClose = Math.max(...closes);
    const span = maxClose - minClose;
    const percentile = span > 0 ? (close - minClose) / span : 0;
    const lowScore = Math.min(10, Math.max(0, (1 - percentile) * 10));

    const ma30 = ma(history, 30);
    let belowMaScore = 0;
    if (Number.isFinite(ma30) && ma30 > 0) {
      const distance = (ma30 - close) / ma30;
      belowMaScore = distance > 0 ? Math.min(10, Math.max(0, distance * 100 * 1.5)) : 0;
    }

    const high20 = Math.max(...history.slice(-20).map((item) => Number(item.close)).filter(Number.isFinite));
    let declineScore = 0;
    if (Number.isFinite(high20) && high20 > 0) {
      const decline = (high20 - close) / high20;
      declineScore = Math.min(10, Math.max(0, decline * 100 * 1.2));
    }

    return {
      score: lowScore + belowMaScore + declineScore,
      details: {
        lowScore: Number(toFixedText(lowScore, 2)),
        belowMaScore: Number(toFixedText(belowMaScore, 2)),
        declineScore: Number(toFixedText(declineScore, 2)),
        ma30: Number(toFixedText(ma30, 3)),
        recentLow: Number(toFixedText(minClose, 3)),
        recentHigh: Number(toFixedText(maxClose, 3)),
        high20: Number(toFixedText(high20, 3))
      }
    };
  }

  function computeConfirmScore(pin, confirm, history) {
    if (!pin || !confirm || history.length < 20) return { score: 0, details: {} };

    const volumes = history.map((item) => Number(item.volume)).filter(Number.isFinite);
    const avgVolume = volumes.length ? volumes.reduce((s, v) => s + v, 0) / volumes.length : 0;
    const pinVolume = Number(pin.volume);
    let volumeScore = 0;
    if (avgVolume > 0 && Number.isFinite(pinVolume)) {
      const ratio = pinVolume / avgVolume;
      volumeScore = ratio >= 1.5 ? 10 : Math.min(10, Math.max(0, (ratio - 1) * 20));
    }

    const pinLow = Number(pin.low);
    const confirmLow = Number(confirm.low);
    const tipHoldScore = Number.isFinite(pinLow) && Number.isFinite(confirmLow) && confirmLow >= pinLow * 0.995 ? 10 : 0;

    const confirmOpen = Number(confirm.open);
    const confirmClose = Number(confirm.close);
    const yangScore = Number.isFinite(confirmOpen) && Number.isFinite(confirmClose) && confirmClose >= confirmOpen ? 10 : 0;

    return {
      score: volumeScore + tipHoldScore + yangScore,
      details: {
        volumeRatio: avgVolume > 0 ? Number(toFixedText(pinVolume / avgVolume, 2)) : null,
        tipHold: Boolean(tipHoldScore),
        nextDayYang: Boolean(yangScore)
      }
    };
  }

  function evaluateStock(stock, klines, targetDate) {
    if (!klines || klines.length < cfg.minKlines) return null;
    const found = findPinAndConfirm(klines, targetDate);
    if (!found) return null;
    const { pin, confirm, history } = found;

    const hasConfirm = confirm !== null;
    const pattern = computePatternScore(pin);
    const position = computePositionScore(pin, history);
    const confirmScore = hasConfirm ? computeConfirmScore(pin, confirm, history) : { score: 0, details: {} };

    const scoreThreshold = hasConfirm ? cfg.scoreThreshold : cfg.noConfirmScoreThreshold;
    const strongThreshold = hasConfirm ? cfg.strongThreshold : cfg.noConfirmStrongThreshold;
    const triggerThreshold = hasConfirm ? cfg.triggerThreshold : cfg.noConfirmTriggerThreshold;

    const total = Math.min(100, Math.max(0, pattern.score + position.score + confirmScore.score));
    if (total < scoreThreshold) return null;

    const ma5 = ma(history, 5);
    const ma10 = ma(history, 10);
    const ma20 = ma(history, 20);
    const ma30 = position.details.ma30;
    const recentLow = position.details.recentLow;
    const atSupport = Number.isFinite(recentLow) && recentLow > 0 && pin.close <= recentLow * 1.03;
    const maResonance = Number.isFinite(ma5) && Number.isFinite(ma10) && ma5 > ma10;
    const canTrigger = total >= triggerThreshold && atSupport && maResonance;

    return {
      code: stock.code,
      name: stock.name,
      market: stock.market,
      price: Number(stock.price),
      pct: Number(stock.pct),
      amount: Number(stock.amount),
      turnover: Number(stock.turnover),
      industry: stock.industry || "",
      score: Number(toFixedText(total, 1)),
      signal: canTrigger ? "trigger" : total >= strongThreshold ? "strong" : "watch",
      patternScore: Number(toFixedText(pattern.score, 1)),
      positionScore: Number(toFixedText(position.score, 1)),
      confirmScore: Number(toFixedText(confirmScore.score, 1)),
      pinDay: pin.day,
      confirmDay: hasConfirm ? confirm.day : "",
      pinOpen: Number(pin.open),
      pinClose: Number(pin.close),
      pinHigh: Number(pin.high),
      pinLow: Number(pin.low),
      confirmClose: hasConfirm ? Number(confirm.close) : null,
      confirmOpen: hasConfirm ? Number(confirm.open) : null,
      confirmLow: hasConfirm ? Number(confirm.low) : null,
      patternDetails: pattern.details,
      positionDetails: position.details,
      confirmDetails: confirmScore.details,
      ma5: Number(toFixedText(ma5, 3)),
      ma10: Number(toFixedText(ma10, 3)),
      ma20: Number(toFixedText(ma20, 3)),
      ma30,
      atSupport,
      maResonance,
      hasConfirm,
      reason: buildReason(total, pattern.score, position.score, confirmScore.score, canTrigger, hasConfirm)
    };
  }

  function buildReason(total, pattern, position, confirm, canTrigger, hasConfirm) {
    const parts = [];
    if (canTrigger) parts.push("金针探底触发入场条件");
    else if (total >= (hasConfirm ? cfg.strongThreshold : cfg.noConfirmStrongThreshold)) parts.push("金针探底强信号，建议纳入观察池");
    else parts.push("金针探底形态初现，继续观察");
    if (hasConfirm) {
      parts.push(`形态分 ${toFixedText(pattern, 1)} / 位置分 ${toFixedText(position, 1)} / 确认分 ${toFixedText(confirm, 1)}`);
    } else {
      parts.push(`形态分 ${toFixedText(pattern, 1)} / 位置分 ${toFixedText(position, 1)}（最近交易日无次日确认数据，不引入确认分）`);
    }
    return parts.join("；");
  }

  async function fetchKlineWithTimeout(stock) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("kline timeout")), 8_000);
    });
    try {
      return await Promise.race([
        getStockKline(stock.code, stock.market, { count: cfg.klineCount }),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function withConcurrency(items, concurrency, handler) {
    const results = [];
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const i = index++;
        try {
          results[i] = await handler(items[i], i);
        } catch (error) {
          results[i] = { error: error.message };
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  function emptyCache() {
    return {
      status: "idle",
      data: [],
      refreshedAt: "",
      nextRefreshAt: "",
      error: "",
      scannedCount: 0,
      qualifiedCount: 0,
      date: ""
    };
  }

  async function refreshGoldenPins({ force = false, date = "" } = {}) {
    const targetDate = date || latestTradingDay();
    const existing = cacheByDate.get(targetDate) || emptyCache();
    if (running.has(targetDate)) return existing;
    if (!force && existing.refreshedAt && existing.status !== "error") return existing;

    running.add(targetDate);
    const cache = { ...emptyCache(), date: targetDate };
    cacheByDate.set(targetDate, cache);
    cache.status = "running";
    cache.error = "";
    const startedAt = Date.now();
    try {
      const all = await getAllAshares();
      const liquid = all
        .filter((stock) => Number(stock.amount) >= cfg.minAmount)
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, cfg.maxStocks);

      cache.scannedCount = liquid.length;
      const evaluated = [];
      let processed = 0;
      const logProgress = () => {
        processed += 1;
        if (processed % 500 === 0 || processed === liquid.length) {
          console.log(`[golden-pins] ${targetDate} 进度: ${processed}/${liquid.length}, 已入选 ${evaluated.length} 只, 耗时 ${Date.now() - startedAt}ms`);
        }
      };

      const results = await withConcurrency(liquid, cfg.concurrency, async (stock) => {
        try {
          const klineData = await fetchKlineWithTimeout(stock);
          const result = evaluateStock(stock, klineData?.klines, targetDate);
          logProgress();
          return result;
        } catch {
          logProgress();
          return null;
        }
      });

      for (const result of results) {
        if (result && !result.error) evaluated.push(result);
      }

      evaluated.sort((a, b) => b.score - a.score);
      cache.data = evaluated;
      cache.qualifiedCount = evaluated.length;
      cache.refreshedAt = new Date().toISOString();
      cache.status = "ready";
      console.log(`[golden-pins] ${targetDate} 完成: 扫描 ${liquid.length} 只, 入选 ${evaluated.length} 只, 耗时 ${Date.now() - startedAt}ms`);
      return cache;
    } catch (error) {
      cache.status = "error";
      cache.error = error.message;
      console.error(`[golden-pins] ${targetDate} 失败: ${error.message}`);
      return cache;
    } finally {
      running.delete(targetDate);
    }
  }

  function getCache(date = "") {
    const targetDate = date || latestTradingDay();
    return cacheByDate.get(targetDate) || emptyCache();
  }

  return {
    refreshGoldenPins,
    getCache,
    evaluateStock,
    computePatternScore,
    computePositionScore,
    computeConfirmScore,
    previousTradingDay,
    latestTradingDay
  };
}

module.exports = {
  createGoldenPinService,
  DEFAULT_CONFIG,
  previousTradingDay,
  latestTradingDay
};
