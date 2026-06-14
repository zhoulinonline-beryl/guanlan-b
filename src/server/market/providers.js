const { marketDataSource } = require("../storage/settingsStore");
const { marketOf, symbolOf, eastmoneySecidFromSymbol } = require("./symbols");

function createMarketProviders({ fetchJson, fetchGbkText, eastmoneyUrl, parseKlines }) {
  async function getKlines(secid, count = 80) {
    const url = eastmoneyUrl("push2his.eastmoney.com", "/api/qt/stock/kline/get", {
      secid,
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      klt: "101",
      fqt: "1",
      end: "20500101",
      lmt: String(count)
    });
    const json = await fetchJson(url);
    return parseKlines(json?.data?.klines || []);
  }

  async function getSinaKlines(symbol, count = 120) {
    const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&datalen=${count}`;
    const json = await fetchJson(url);
    return json.map((item) => ({
      day: item.day,
      open: Number(item.open),
      close: Number(item.close),
      high: Number(item.high),
      low: Number(item.low),
      volume: Number(item.volume),
      amount: 0,
      amplitude: 0,
      pct: 0,
      change: 0,
      turnover: 0
    })).filter((item) => Number.isFinite(item.close));
  }

  async function getTencentKlines(symbol, count = 14) {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${count},qfq`;
    const json = await fetchJson(url);
    const rows = json?.data?.[symbol]?.day || json?.data?.[symbol]?.qfqday || [];
    return rows.map((item, index) => {
      const [day, open, close, high, low, volume] = item;
      const prevClose = index > 0 ? Number(rows[index - 1][2]) : Number(open);
      const change = Number(close) - prevClose;
      const pct = prevClose ? (change / prevClose) * 100 : 0;
      return {
        day,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        amount: Number(volume),
        amplitude: prevClose ? ((Number(high) - Number(low)) / prevClose) * 100 : 0,
        pct,
        change,
        turnover: 0
      };
    }).filter((item) => Number.isFinite(item.close));
  }

  async function getTencentQuotes(symbols) {
    const url = `https://qt.gtimg.cn/q=${symbols.join(",")}`;
    const text = await fetchGbkText(url);
    const map = new Map();
    text.split(";").forEach((line) => {
      const match = line.match(/v_([a-z]{2}\d+)="([^"]*)"/);
      if (!match) return;
      const parts = match[2].split("~");
      map.set(match[1], {
        symbol: match[1],
        name: parts[1],
        code: parts[2],
        price: Number(parts[3]),
        prevClose: Number(parts[4]),
        open: Number(parts[5]),
        volume: Number(parts[6]),
        change: Number(parts[31]),
        pct: Number(parts[32]),
        high: Number(parts[33]),
        low: Number(parts[34]),
        amount: Number(parts[37]) * 10000,
        turnover: Number(parts[38]),
        marketCap: Number(parts[45]),
        source: "tencent"
      });
    });
    return map;
  }

  async function getSinaQuotes(symbols) {
    const url = `https://hq.sinajs.cn/list=${symbols.join(",")}`;
    const text = await fetchGbkText(url);
    const map = new Map();
    text.split(";").forEach((line) => {
      const match = line.match(/var hq_str_([a-z]{2}\d+)="([^"]*)"/);
      if (!match) return;
      const symbol = match[1];
      const parts = match[2].split(",");
      const code = symbol.slice(2);
      const open = Number(parts[1]);
      const prevClose = Number(parts[2]);
      const price = Number(parts[3]);
      const high = Number(parts[4]);
      const low = Number(parts[5]);
      const volume = Number(parts[8]);
      const amount = Number(parts[9]);
      const change = price - prevClose;
      const pct = prevClose ? change / prevClose * 100 : 0;
      if (!Number.isFinite(price) || !parts[0]) return;
      map.set(symbol, {
        symbol,
        name: parts[0],
        code,
        price,
        prevClose,
        open,
        volume,
        change,
        pct,
        high,
        low,
        amount,
        turnover: null,
        marketCap: null,
        source: "sina"
      });
    });
    return map;
  }

  async function getEastmoneyQuotes(symbols) {
    const secids = symbols.map(eastmoneySecidFromSymbol).join(",");
    const url = eastmoneyUrl("push2.eastmoney.com", "/api/qt/ulist.np/get", {
      fltt: "2",
      invt: "2",
      fields: "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f15,f16,f17,f18,f20,f21,f23",
      secids
    });
    const json = await fetchJson(url);
    const rows = json?.data?.diff || [];
    const map = new Map();
    rows.forEach((row) => {
      const code = String(row.f12 || "");
      const market = Number.isFinite(Number(row.f13)) ? Number(row.f13) : marketOf(code);
      const symbol = symbolOf(code, market);
      const price = Number(row.f2);
      if (!Number.isFinite(price)) return;
      map.set(symbol, {
        symbol,
        name: row.f14,
        code,
        market,
        price,
        prevClose: Number(row.f18),
        open: Number(row.f17),
        volume: Number(row.f5),
        change: Number(row.f4),
        pct: Number(row.f3),
        high: Number(row.f15),
        low: Number(row.f16),
        amount: Number(row.f6),
        turnover: Number(row.f8),
        totalMarketCap: Number(row.f20),
        floatMarketCap: Number(row.f21),
        pb: Number(row.f23),
        source: "eastmoney"
      });
    });
    return map;
  }

  function quoteProviderOrder(preferred = marketDataSource()) {
    if (preferred === "tencent") return ["tencent", "eastmoney", "sina"];
    if (preferred === "eastmoney") return ["eastmoney", "tencent", "sina"];
    if (preferred === "sina") return ["sina", "tencent", "eastmoney"];
    return ["tencent", "eastmoney", "sina"];
  }

  async function getQuotesBySource(symbols = [], preferred = marketDataSource()) {
    const unique = [...new Set(symbols.filter(Boolean))];
    let lastError = null;
    for (const source of quoteProviderOrder(preferred)) {
      try {
        const quotes = source === "eastmoney"
          ? await getEastmoneyQuotes(unique)
          : source === "sina"
            ? await getSinaQuotes(unique)
            : await getTencentQuotes(unique);
        if (quotes.size) return { quotes, source };
        lastError = new Error(`${source} 行情源返回为空`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("所有个股行情源均不可用");
  }

  return {
    getKlines,
    getSinaKlines,
    getTencentKlines,
    getTencentQuotes,
    getSinaQuotes,
    getEastmoneyQuotes,
    quoteProviderOrder,
    getQuotesBySource
  };
}

module.exports = {
  createMarketProviders
};
