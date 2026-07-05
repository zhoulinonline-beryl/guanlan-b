import { describe, it } from "node:test";
import assert from "node:assert";
import { createMarketDataCache } from "../src/server/market/marketDataCache.js";

describe("market data cache", () => {
  it("returns cached value without calling fetcher on second call", async () => {
    const cache = createMarketDataCache({ isAshareTradingAutoRefreshTime: () => true });
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { price: 100 };
    };
    const first = await cache.getQuote("600519", 1, fetcher);
    const second = await cache.getQuote("600519", 1, fetcher);
    assert.deepStrictEqual(first, { price: 100 });
    assert.deepStrictEqual(second, { price: 100 });
    assert.equal(calls, 1);
  });

  it("calls fetcher again after ttl expires", async () => {
    const cache = createMarketDataCache({
      isAshareTradingAutoRefreshTime: () => true,
      ttls: { quote: { trading: 0, idle: 0 } }
    });
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { price: calls * 10 };
    };
    await cache.getQuote("600519", 1, fetcher);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await cache.getQuote("600519", 1, fetcher);
    assert.equal(calls, 2);
    assert.equal(result.price, 20);
  });

  it("skips cache when force is true", async () => {
    const cache = createMarketDataCache({ isAshareTradingAutoRefreshTime: () => true });
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { price: calls };
    };
    await cache.getQuote("600519", 1, fetcher);
    const result = await cache.getQuote("600519", 1, fetcher, { force: true });
    assert.equal(calls, 2);
    assert.equal(result.price, 2);
  });

  it("clears all cached entries", async () => {
    const cache = createMarketDataCache({ isAshareTradingAutoRefreshTime: () => true });
    await cache.getQuote("600519", 1, async () => ({ price: 100 }));
    assert.equal(cache.stats().size, 1);
    cache.clear();
    assert.equal(cache.stats().size, 0);
  });

  it("clears entries by pattern", async () => {
    const cache = createMarketDataCache({ isAshareTradingAutoRefreshTime: () => true });
    await cache.getQuote("600519", 1, async () => ({ price: 100 }));
    await cache.getStockKline("600519", 1, { count: 120 }, async () => ([]));
    assert.equal(cache.stats().size, 2);
    cache.clearByPattern("kline");
    assert.equal(cache.stats().size, 1);
    assert.ok(cache.stats().keys[0].startsWith("quote:"));
  });

  it("isolates cache keys by data source", async () => {
    let source = "tencent";
    const cache = createMarketDataCache({
      isAshareTradingAutoRefreshTime: () => true,
      getMarketDataSource: () => source,
      ttls: { quote: { trading: 60_000, idle: 60_000 } }
    });
    const fetcher = async () => ({ source });
    const first = await cache.getQuote("600519", 1, fetcher);
    assert.equal(first.source, "tencent");
    source = "eastmoney";
    const second = await cache.getQuote("600519", 1, fetcher);
    assert.equal(second.source, "eastmoney");
  });

  it("caches indices, sectors, stocks and all-ashares independently", async () => {
    const cache = createMarketDataCache({ isAshareTradingAutoRefreshTime: () => true });
    let calls = 0;
    await cache.getIndices(async () => { calls += 1; return []; });
    await cache.getSectors(5, async () => { calls += 1; return []; });
    await cache.getStocks("BK0474", 5, async () => { calls += 1; return []; });
    await cache.getAllAshares(async () => { calls += 1; return []; });
    await cache.getIndexKline("sh000001", async () => { calls += 1; return []; });
    assert.equal(calls, 5);
    assert.equal(cache.stats().size, 5);
  });

  it("evicts oldest entries when max size is exceeded", async () => {
    const cache = createMarketDataCache({
      isAshareTradingAutoRefreshTime: () => true,
      ttls: { quote: { trading: 60_000, idle: 60_000 } }
    });
    for (let i = 0; i < 5002; i += 1) {
      await cache.getQuote(String(i), 0, async () => ({ price: i }));
    }
    assert.ok(cache.stats().size <= 5000);
  });
});
