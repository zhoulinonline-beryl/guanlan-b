const { marketDataSource } = require("../storage/settingsStore");

const DEFAULT_TTLS = {
  quote: { trading: 30_000, idle: 5 * 60_000 },
  indices: { trading: 30_000, idle: 5 * 60_000 },
  kline: { trading: 5 * 60_000, idle: 30 * 60_000 },
  indexKline: { trading: 5 * 60_000, idle: 30 * 60_000 },
  sectors: { trading: 60_000, idle: 30 * 60_000 },
  stocks: { trading: 60_000, idle: 30 * 60_000 },
  allAshares: { trading: 5 * 60_000, idle: 60 * 60_000 }
};

const MAX_ENTRIES = 5000;

function createMarketDataCache({
  isAshareTradingAutoRefreshTime = () => false,
  getMarketDataSource = marketDataSource,
  ttls = DEFAULT_TTLS
} = {}) {
  const cache = new Map();

  function resolveTtl(type) {
    const config = ttls[type] || { trading: 60_000, idle: 30 * 60_000 };
    return isAshareTradingAutoRefreshTime() ? config.trading : config.idle;
  }

  function buildKey(prefix, parts = []) {
    const source = getMarketDataSource();
    return [prefix, source, ...parts.map(String)].join(":");
  }

  function evictIfNeeded() {
    if (cache.size <= MAX_ENTRIES) return;
    const over = cache.size - MAX_ENTRIES;
    const keys = [...cache.keys()].slice(0, over);
    for (const key of keys) cache.delete(key);
  }

  async function get(key, ttl, fetcher, { force = false } = {}) {
    if (!force) {
      const entry = cache.get(key);
      if (entry && Date.now() - entry.time < ttl) {
        return entry.value;
      }
    }
    const value = await fetcher();
    cache.set(key, { time: Date.now(), value });
    evictIfNeeded();
    return value;
  }

  function clear() {
    cache.clear();
  }

  function clearByPattern(pattern) {
    for (const key of cache.keys()) {
      if (key.includes(pattern)) cache.delete(key);
    }
  }

  function stats() {
    return {
      size: cache.size,
      keys: [...cache.keys()]
    };
  }

  async function getQuote(code, market, fetcher, options) {
    const key = buildKey("quote", [code, market]);
    return get(key, resolveTtl("quote"), fetcher, options);
  }

  async function getQuotes(symbols, fetcher, options) {
    const key = buildKey("quotes", [symbols.sort().join(",")]);
    return get(key, resolveTtl("quote"), fetcher, options);
  }

  async function getIndices(fetcher, options) {
    const key = buildKey("indices", []);
    return get(key, resolveTtl("indices"), fetcher, options);
  }

  async function getStockKline(code, market, opts, fetcher, options) {
    const count = Number(opts?.count || opts?.limit || 120);
    const key = buildKey("kline", [code, market, count]);
    return get(key, resolveTtl("kline"), fetcher, options);
  }

  async function getIndexKline(symbol, fetcher, options) {
    const key = buildKey("index-kline", [symbol]);
    return get(key, resolveTtl("indexKline"), fetcher, options);
  }

  async function getSectors(window, fetcher, options) {
    const key = buildKey("sectors", [window]);
    return get(key, resolveTtl("sectors"), fetcher, options);
  }

  async function getStocks(board, window, fetcher, options) {
    const key = buildKey("stocks", [board, window]);
    return get(key, resolveTtl("stocks"), fetcher, options);
  }

  async function getAllAshares(fetcher, options) {
    const key = buildKey("all-ashares", []);
    return get(key, resolveTtl("allAshares"), fetcher, options);
  }

  return {
    get,
    getQuote,
    getQuotes,
    getIndices,
    getStockKline,
    getIndexKline,
    getSectors,
    getStocks,
    getAllAshares,
    clear,
    clearByPattern,
    stats
  };
}

module.exports = {
  createMarketDataCache,
  DEFAULT_TTLS
};
