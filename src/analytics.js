export function ema(values, span) {
  const alpha = 2 / (span + 1);
  const result = [];
  values.forEach((value, index) => {
    result.push(index === 0 ? value : value * alpha + result[index - 1] * (1 - alpha));
  });
  return result;
}

export function macd(candles) {
  const closes = candles.map((item) => item.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const dif = fast.map((value, index) => value - slow[index]);
  const dea = ema(dif, 9);
  const hist = dif.map((value, index) => (value - dea[index]) * 2);
  return { dif, dea, hist };
}

export function boll(candles, period = 20) {
  const closes = candles.map((item) => item.close);
  return closes.map((close, index) => {
    const start = Math.max(0, index - period + 1);
    const window = closes.slice(start, index + 1);
    const mid = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - mid) ** 2, 0) / window.length;
    const sd = Math.sqrt(variance);
    return { mid, upper: mid + 2 * sd, lower: mid - 2 * sd, close };
  });
}

export function ma(candles, period) {
  return candles.map((_, index) => {
    const start = Math.max(0, index - period + 1);
    const window = candles.slice(start, index + 1);
    return window.reduce((sum, item) => sum + item.close, 0) / window.length;
  });
}

export function sar(candles, step = 0.02, max = 0.2) {
  let uptrend = true;
  let af = step;
  let ep = candles[0].high;
  let value = candles[0].low;
  return candles.map((item, index) => {
    if (index === 0) return value;
    value = value + af * (ep - value);
    if (uptrend) {
      if (item.low < value) {
        uptrend = false;
        value = ep;
        ep = item.low;
        af = step;
      } else if (item.high > ep) {
        ep = item.high;
        af = Math.min(max, af + step);
      }
    } else if (item.high > value) {
      uptrend = true;
      value = ep;
      ep = item.high;
      af = step;
    } else if (item.low < ep) {
      ep = item.low;
      af = Math.min(max, af + step);
    }
    return value;
  });
}

export function sectorReasons(sector) {
  const stocks = sector.stocks || [];
  const avgStockScore = stocks.length ? stocks.reduce((sum, stock) => sum + stock.score, 0) / stocks.length : 0;
  const hotCount = stocks.filter((stock) => stock.pct > 1.2 && stock.mainFlow > 5).length;
  const top = stocks[0];
  const breadth = `${sector.upCount || 0} 涨 / ${sector.downCount || 0} 跌`;
  const hasMainNet = sector.mainNet !== null && sector.mainNet !== undefined && Number.isFinite(Number(sector.mainNet));
  return [
    `近 3-5 日板块指数强度靠前，当前雷达分 ${sector.attackScore.toFixed(1)}，成交额约 ${(sector.amount / 100000000).toFixed(1)} 亿。`,
    hasMainNet ? `板块涨跌家数为 ${breadth}，主力净额约 ${(sector.mainNet / 100000000).toFixed(2)} 亿，可用于判断是否由局部异动扩散为板块进攻。` : `板块涨跌家数为 ${breadth}；当前兜底行情源未提供主力净额，雷达改用成交额、涨跌广度和近 3-5 日趋势做代理。`,
    stocks.length ? `Top10 中 ${hotCount} 只个股同时出现上涨与主力净流入，平均进攻分 ${avgStockScore.toFixed(1)}，${top.name} 暂居队首。` : "成分股 Top10 尚未加载，进入推荐页后会补充个股梯队与主力强度。",
    "后续重点观察板块是否持续放量、龙头是否高位横住、后排是否补涨；三者同时出现时，方向可信度更高。"
  ];
}

export function stockAdvice(stock) {
  const candles = stock.candles;
  if (!candles?.length) {
    return {
      action: "等待数据",
      risk: "行情 K 线未加载完成",
      plan: "等待 K 线数据返回后再生成具体操作计划。",
      position: "等待",
      levels: {},
      latest: {},
      summary: `${stock.name} 暂无足够 K 线数据，无法给出技术建议。`,
      checks: [
        { name: "K 线", value: "暂无" },
        { name: "MACD", value: "暂无" },
        { name: "SAR", value: "暂无" },
        { name: "BOLL", value: "暂无" }
      ],
      macd: { dif: [], dea: [], hist: [] },
      boll: [],
      sar: []
    };
  }
  const last = candles.at(-1);
  const prev = candles.at(-2);
  const macdData = macd(candles);
  const bollData = boll(candles);
  const sarData = sar(candles);
  const ma5 = ma(candles, 5);
  const ma10 = ma(candles, 10);
  const ma20 = ma(candles, 20);
  const i = candles.length - 1;
  const macdBull = macdData.dif[i] > macdData.dea[i] && macdData.hist[i] > macdData.hist[i - 1];
  const sarBull = last.close > sarData[i];
  const b = bollData[i];
  const bollState = last.close > b.upper ? "突破上轨" : last.close < b.lower ? "跌破下轨" : last.close > b.mid ? "中轨上方" : "中轨下方";
  const klineBull = last.close > last.open && last.close > prev.close;
  const score = [macdBull, sarBull, klineBull, last.close >= b.mid].filter(Boolean).length;
  const scoreLabel = `${score}/4 项技术条件共振`;
  const recent = candles.slice(-10);
  const last5 = candles.slice(-5);
  const support = Math.min(sarData[i], ma10[i], b.mid);
  const hardStop = Math.min(...recent.map((item) => item.low));
  const resistance = Math.max(...recent.map((item) => item.high), b.upper);
  const pullbackBuy = Math.max(support, last.close * 0.97);
  const breakoutBuy = resistance * 1.005;
  const stopLoss = Math.max(hardStop, last.close * 0.94);
  const firstTarget = Math.max(resistance, last.close * 1.045);
  const secondTarget = Math.max(firstTarget * 1.035, last.close * 1.08);
  const position = score >= 3 ? "3-5成" : score === 2 ? "1-2成" : "空仓或底仓";
  const volume5 = last5.reduce((sum, item) => sum + Number(item.volume || 0), 0) / Math.max(1, last5.length);
  const volume20Rows = candles.slice(-20);
  const volume20 = volume20Rows.reduce((sum, item) => sum + Number(item.volume || 0), 0) / Math.max(1, volume20Rows.length);
  const volumeState = volume20 ? volume5 / volume20 : 1;
  const closeVsMa20 = ma20[i] ? ((last.close - ma20[i]) / ma20[i]) * 100 : 0;
  const riskReward = (firstTarget - last.close) / Math.max(0.01, last.close - stopLoss);
  let action = "观察";
  let risk = "等回踩确认，避免追高";
  let plan = `等待价格回到 ${pullbackBuy.toFixed(2)} 附近企稳，或放量突破 ${breakoutBuy.toFixed(2)} 后再跟踪。`;
  if (score >= 3 && last.close <= b.upper * 1.01) {
    action = "偏多试仓";
    risk = `跌破 ${stopLoss.toFixed(2)} 或 SAR 翻空止损`;
    plan = `回踩 ${pullbackBuy.toFixed(2)}-${last.close.toFixed(2)} 区间不破可分批试仓，初始仓位 ${position}。`;
  } else if (score >= 3) {
    action = "强势持有";
    risk = `跌回 BOLL 上轨内且 MACD 柱缩短时减仓`;
    plan = `已持仓以 ${b.upper.toFixed(2)} 为强弱线，冲击 ${firstTarget.toFixed(2)} 先止盈一半。`;
  } else if (score <= 1) {
    action = "降低仓位";
    risk = `跌破 ${stopLoss.toFixed(2)} 后避免补仓`;
    plan = `技术共振不足，等 MACD 重回金叉且站上 ${ma20[i].toFixed(2)} 再评估。`;
  }
  const why = [
    `K 线：${klineBull ? "最新收盘强于前一日且收阳，短线承接尚可" : "最新 K 线未形成明确向上确认，追价胜率一般"}。`,
    `MACD：${macdBull ? "DIF 位于 DEA 上方且柱体扩张，动能正在改善" : "DIF/DEA 或柱体尚未共振，动能确认不足"}。`,
    `SAR：${sarBull ? `SAR ${sarData[i].toFixed(2)} 位于价格下方，可作为趋势保护参考` : `SAR ${sarData[i].toFixed(2)} 压在价格上方，趋势仍有压力`}。`,
    `BOLL：当前处于${bollState}，上轨 ${b.upper.toFixed(2)}、中轨 ${b.mid.toFixed(2)}、下轨 ${b.lower.toFixed(2)}。`
  ];
  const playbook = [
    `建仓：优先等 ${pullbackBuy.toFixed(2)} 附近回踩不破，或放量站上 ${breakoutBuy.toFixed(2)} 后再分批。`,
    `加仓：只有在收盘继续站上 MA5/MA10 且 MACD 柱不明显缩短时，才考虑把仓位从底仓提高到 ${position}。`,
    `止盈：接近 ${firstTarget.toFixed(2)} 先锁定一部分利润，若继续放量再看 ${secondTarget.toFixed(2)}。`,
    `风控：跌破 ${stopLoss.toFixed(2)}、SAR 翻空或放量长阴，说明本轮计划失效。`
  ];
  const diagnostics = [
    `技术共振：${scoreLabel}。`,
    `量能：近 5 日均量约为 20 日均量的 ${volumeState.toFixed(2)} 倍，${volumeState >= 1.15 ? "量能支持度较好" : volumeState <= 0.85 ? "量能偏弱，需等待放量" : "量能中性"}。`,
    `位置：收盘相对 MA20 ${closeVsMa20 >= 0 ? "高" : "低"} ${Math.abs(closeVsMa20).toFixed(2)}%，${Math.abs(closeVsMa20) > 8 ? "短线位置偏极端，避免一次性重仓" : "位置尚未明显失控"}。`,
    `赔率：以目标一和止损估算，风险收益比约 ${riskReward.toFixed(2)}。`
  ];
  return {
    action,
    risk,
    plan,
    position,
    explanation: {
      score,
      scoreLabel,
      why,
      playbook,
      diagnostics,
      invalidation: `若收盘跌破 ${stopLoss.toFixed(2)}，或 MACD 柱连续缩短并跌回 BOLL 中轨 ${b.mid.toFixed(2)} 下方，本次建议降级。`
    },
    levels: {
      pullbackBuy,
      breakoutBuy,
      stopLoss,
      firstTarget,
      secondTarget,
      support,
      resistance
    },
    latest: {
      close: last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      volume: last.volume,
      ma5: ma5[i],
      ma10: ma10[i],
      ma20: ma20[i],
      dif: macdData.dif[i],
      dea: macdData.dea[i],
      macdHist: macdData.hist[i],
      sar: sarData[i],
      bollUpper: b.upper,
      bollMid: b.mid,
      bollLower: b.lower
    },
    summary: `${stock.name} 当前 K 线${klineBull ? "收阳并抬高" : "动能一般"}，MACD ${macdBull ? "金叉扩张" : "未形成强共振"}，SAR ${sarBull ? "位于价格下方" : "压在价格上方"}，BOLL 处于${bollState}。`,
    checks: [
      { name: "K 线", value: klineBull ? "短线转强" : "等待确认" },
      { name: "MACD", value: macdBull ? "多头扩张" : "动能不足" },
      { name: "SAR", value: sarBull ? "趋势保护" : "趋势压制" },
      { name: "BOLL", value: bollState }
    ],
    macd: macdData,
    boll: bollData,
    sar: sarData
  };
}
