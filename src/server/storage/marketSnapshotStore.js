const { MARKET_SNAPSHOT_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonStore");

function emptySnapshot() {
  return {
    updatedAt: "",
    indices: [],
    sectors: [],
    stocksByBoard: {},
    klinesByCode: {},
    quotesByCode: {}
  };
}

function readMarketSnapshot() {
  return readJsonFile(MARKET_SNAPSHOT_FILE, emptySnapshot());
}

function writeMarketSnapshot(snapshot = {}) {
  writeJsonFile(MARKET_SNAPSHOT_FILE, {
    ...emptySnapshot(),
    ...snapshot,
    updatedAt: new Date().toISOString()
  });
}

function updateMarketSnapshot(part, key, value) {
  const snapshot = readMarketSnapshot();
  if (part === "indices") snapshot.indices = value;
  if (part === "sectors") snapshot.sectors = value;
  if (part === "stocks") snapshot.stocksByBoard = { ...snapshot.stocksByBoard, [key]: value };
  if (part === "kline") snapshot.klinesByCode = { ...snapshot.klinesByCode, [key]: value };
  if (part === "quote") snapshot.quotesByCode = { ...snapshot.quotesByCode, [key]: value };
  writeMarketSnapshot(snapshot);
}

function snapshotFallback(part, key = "") {
  const snapshot = readMarketSnapshot();
  if (part === "indices") return snapshot.indices?.length ? snapshot.indices : null;
  if (part === "sectors") return snapshot.sectors?.length ? snapshot.sectors : null;
  if (part === "stocks") return snapshot.stocksByBoard?.[key] || null;
  if (part === "kline") return snapshot.klinesByCode?.[key] || null;
  if (part === "quote") return snapshot.quotesByCode?.[key] || null;
  return null;
}

module.exports = {
  readMarketSnapshot,
  writeMarketSnapshot,
  updateMarketSnapshot,
  snapshotFallback
};
