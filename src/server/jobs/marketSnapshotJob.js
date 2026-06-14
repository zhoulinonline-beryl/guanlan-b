function createStartupMarketSnapshotJob({
  readMarketSnapshot,
  writeMarketSnapshot,
  getIndices,
  getSectors,
  getStocks,
  getQuote,
  getStockKline
}) {
  return async function ensureStartupMarketSnapshot() {
    const existing = readMarketSnapshot();
    if (existing.indices?.length && existing.sectors?.length) {
      console.log(`市场快照已存在: ${existing.updatedAt || "unknown"}`);
      return existing;
    }
    console.log("首次启动市场快照不存在，开始拉取最新行情并持久化");
    const snapshot = {
      indices: [],
      sectors: [],
      stocksByBoard: {},
      klinesByCode: {},
      quotesByCode: {}
    };
    try {
      snapshot.indices = await getIndices();
    } catch (error) {
      console.warn(`预热大盘指数失败: ${error.message}`);
    }
    try {
      snapshot.sectors = await getSectors(5);
    } catch (error) {
      console.warn(`预热板块行情失败: ${error.message}`);
    }
    for (const sector of snapshot.sectors.slice(0, 6)) {
      try {
        snapshot.stocksByBoard[sector.id] = await getStocks(sector.id, 5);
      } catch (error) {
        console.warn(`预热 ${sector.name || sector.id} 成分股失败: ${error.message}`);
      }
    }
    const sampleStocks = Object.values(snapshot.stocksByBoard)
      .flat()
      .slice(0, 12);
    for (const stock of sampleStocks) {
      if (!stock?.code) continue;
      try {
        snapshot.quotesByCode[stock.code] = await getQuote(stock.code, stock.market);
      } catch {
        snapshot.quotesByCode[stock.code] = stock;
      }
      try {
        snapshot.klinesByCode[stock.code] = await getStockKline(stock.code, stock.market);
      } catch (error) {
        console.warn(`预热 ${stock.name || stock.code} K线失败: ${error.message}`);
      }
    }
    writeMarketSnapshot(snapshot);
    console.log(`市场快照已写入: 指数 ${snapshot.indices.length} 个，板块 ${snapshot.sectors.length} 个，股票池 ${Object.values(snapshot.stocksByBoard).flat().length} 只`);
    return snapshot;
  };
}

module.exports = {
  createStartupMarketSnapshotJob
};
