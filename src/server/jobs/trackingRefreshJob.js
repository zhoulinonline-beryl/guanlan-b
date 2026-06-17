function createTrackingRefreshJob({
  readTrackingStore,
  appendTrackingSample,
  updateTrackingKlines,
  getQuote,
  getStockKline,
  marketOf,
  refreshMs = 15 * 60 * 1000
}) {
  async function refreshTrackedStocks({ reason = "schedule" } = {}) {
    const store = readTrackingStore();
    const rows = [];
    for (const stock of store.stocks) {
      try {
        const quote = await getQuote(stock.code, stock.market ?? marketOf(stock.code));
        appendTrackingSample(stock.code, quote);
        if (getStockKline && updateTrackingKlines) {
          const kline = await getStockKline(stock.code, quote.market ?? stock.market ?? marketOf(stock.code)).catch(() => null);
          if (kline?.klines?.length) updateTrackingKlines(stock.code, kline.klines.slice(-7));
        }
        rows.push({ code: stock.code, ok: true, price: quote.price, volume: quote.volume });
      } catch (error) {
        rows.push({ code: stock.code, ok: false, error: error.message });
      }
    }
    if (rows.length) {
      console.log(`[tracking-refresh] ${reason}: ${rows.filter((item) => item.ok).length}/${rows.length}`);
    }
    return { rows, updatedAt: new Date().toISOString() };
  }

  function start() {
    setTimeout(() => refreshTrackedStocks({ reason: "startup" }).catch((error) => {
      console.error("[tracking-refresh-startup-failed]", error.message);
    }), 1500);
    return setInterval(() => {
      refreshTrackedStocks({ reason: "schedule" }).catch((error) => {
        console.error("[tracking-refresh-failed]", error.message);
      });
    }, refreshMs);
  }

  return {
    refreshTrackedStocks,
    start
  };
}

module.exports = {
  createTrackingRefreshJob
};
