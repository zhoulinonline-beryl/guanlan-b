function trendScore(klines, fallbackPct, mainNet = 0, turnover = 0, window = 5) {
  const rows = klines.slice(-Math.max(2, window + 1));
  const first = rows[0]?.close;
  const last = rows.at(-1)?.close;
  const trendPct = first ? ((last - first) / first) * 100 : Number(fallbackPct || 0);
  const recentVol = rows.slice(-window).reduce((sum, item) => sum + item.volume, 0) / Math.max(1, Math.min(window, rows.length));
  const baseRows = klines.slice(-30, -window);
  const baseVol = baseRows.reduce((sum, item) => sum + item.volume, 0) / Math.max(1, baseRows.length);
  const volRatio = baseVol ? recentVol / baseVol : 1;
  const flowPart = Math.max(-10, Math.min(22, Number(mainNet || 0) / 100_000_000 * 4));
  const score = 48 + trendPct * 5.8 + Math.min(18, Math.max(-6, (volRatio - 1) * 24)) + flowPart + Math.min(8, Number(turnover || 0) * 0.45);
  return Math.max(5, Math.min(99, score));
}

function emaValues(values, span) {
  const alpha = 2 / (span + 1);
  const result = [];
  values.forEach((value, index) => {
    result.push(index === 0 ? value : value * alpha + result[index - 1] * (1 - alpha));
  });
  return result;
}

function macdForServer(candles = []) {
  const closes = candles.map((item) => Number(item.close)).filter(Number.isFinite);
  if (!closes.length) return { dif: [], dea: [], hist: [] };
  const fast = emaValues(closes, 12);
  const slow = emaValues(closes, 26);
  const dif = fast.map((value, index) => value - slow[index]);
  const dea = emaValues(dif, 9);
  const hist = dif.map((value, index) => (value - dea[index]) * 2);
  return { dif, dea, hist };
}

function sarForServer(candles = [], step = 0.02, max = 0.2) {
  if (!candles.length) return [];
  let uptrend = true;
  let af = step;
  let ep = Number(candles[0].high);
  let value = Number(candles[0].low);
  return candles.map((item, index) => {
    const high = Number(item.high);
    const low = Number(item.low);
    if (index === 0 || !Number.isFinite(high) || !Number.isFinite(low)) return value;
    value = value + af * (ep - value);
    if (uptrend) {
      if (low < value) {
        uptrend = false;
        value = ep;
        ep = low;
        af = step;
      } else if (high > ep) {
        ep = high;
        af = Math.min(max, af + step);
      }
    } else if (high > value) {
      uptrend = true;
      value = ep;
      ep = high;
      af = step;
    } else if (low < ep) {
      ep = low;
      af = Math.min(max, af + step);
    }
    return value;
  });
}

function technicalOpportunityScore(candles = []) {
  if (!candles.length || candles.length < 35) {
    return { score: -4, macdLabel: "MACD数据不足", sarLabel: "SAR数据不足", details: ["K线长度不足，MACD/SAR 不参与加分。"] };
  }
  const macd = macdForServer(candles);
  const sar = sarForServer(candles);
  const i = candles.length - 1;
  const last = candles[i];
  const prev = candles[i - 1];
  const dif = Number(macd.dif[i]);
  const dea = Number(macd.dea[i]);
  const hist = Number(macd.hist[i]);
  const prevDif = Number(macd.dif[i - 1]);
  const prevDea = Number(macd.dea[i - 1]);
  const prevHist = Number(macd.hist[i - 1]);
  const sarValue = Number(sar[i]);
  const prevSar = Number(sar[i - 1]);
  const close = Number(last.close);
  let score = 0;
  const details = [];

  const macdBull = dif > dea && hist > 0;
  const macdExpanding = Number.isFinite(hist) && Number.isFinite(prevHist) && hist > prevHist;
  const macdGoldenCross = prevDif <= prevDea && dif > dea;
  const macdWeak = dif < dea && hist < 0;
  if (macdBull) {
    score += macdExpanding ? 8 : 5;
    details.push(macdExpanding ? "MACD 多头且柱体扩张，加分较高。" : "MACD 位于多头区，加分。");
  } else if (macdWeak) {
    score -= 7;
    details.push("MACD 空头区，扣分。");
  } else {
    score -= 1;
    details.push("MACD 尚未形成明确多头共振。");
  }
  if (macdGoldenCross) {
    score += 4;
    details.push("MACD 最近金叉，额外加分。");
  }

  const sarBull = close > sarValue;
  const sarFlipUp = Number(prev.close) <= prevSar && close > sarValue;
  const sarDistance = sarValue ? ((close - sarValue) / sarValue) * 100 : 0;
  if (sarBull) {
    score += sarFlipUp ? 7 : 5;
    if (sarDistance > 12) score -= 3;
    details.push(sarFlipUp ? "SAR 刚翻多，趋势确认加分。" : "SAR 位于价格下方，趋势保护加分。");
  } else {
    score -= 8;
    details.push("SAR 位于价格上方，趋势压制扣分。");
  }

  const klineConfirm = close >= Number(last.open) && close >= Number(prev.close);
  if (klineConfirm && macdBull && sarBull) {
    score += 3;
    details.push("K线、MACD、SAR 同向，技术共振额外加分。");
  }

  const bounded = Math.max(-16, Math.min(22, score));
  return {
    score: bounded,
    macdLabel: macdBull ? (macdExpanding ? "MACD多头扩张" : "MACD多头") : macdWeak ? "MACD空头" : "MACD待确认",
    sarLabel: sarBull ? (sarFlipUp ? "SAR翻多" : "SAR多头保护") : "SAR趋势压制",
    details
  };
}

module.exports = {
  trendScore,
  emaValues,
  macdForServer,
  sarForServer,
  technicalOpportunityScore
};
