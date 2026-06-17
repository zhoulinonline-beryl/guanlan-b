const { TRACKING_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonStore");

const MAX_SAMPLES_PER_STOCK = 480;
const MAX_KLINES_PER_STOCK = 7;

function normalizeTrackedStock(item = {}) {
  const code = String(item.code || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
  const name = String(item.name || item.stockName || item.title || code).trim();
  const market = Number(item.market);
  const addedAt = item.addedAt || new Date().toISOString();
  return {
    code,
    name,
    market: Number.isFinite(market) ? market : null,
    addedAt,
    lastUpdatedAt: item.lastUpdatedAt || "",
    klines: Array.isArray(item.klines) ? item.klines.map(normalizeTrackingKline).filter(Boolean).slice(-MAX_KLINES_PER_STOCK) : [],
    samples: Array.isArray(item.samples) ? item.samples.map(normalizeTrackingSample).filter(Boolean).slice(-MAX_SAMPLES_PER_STOCK) : []
  };
}

function normalizeTrackingKline(row = {}) {
  const open = Number(row.open);
  const close = Number(row.close);
  const high = Number(row.high);
  const low = Number(row.low);
  const volume = Number(row.volume);
  if (![open, close, high, low].every(Number.isFinite)) return null;
  return {
    day: String(row.day || row.date || row.time || "").trim(),
    open,
    close,
    high,
    low,
    volume: Number.isFinite(volume) ? volume : null
  };
}

function normalizeTrackingSample(sample = {}) {
  const price = Number(sample.price);
  const volume = Number(sample.volume);
  const amount = Number(sample.amount);
  if (!Number.isFinite(price) && !Number.isFinite(volume)) return null;
  return {
    time: sample.time || sample.updatedAt || new Date().toISOString(),
    price: Number.isFinite(price) ? price : null,
    volume: Number.isFinite(volume) ? volume : null,
    amount: Number.isFinite(amount) ? amount : null,
    pct: Number.isFinite(Number(sample.pct)) ? Number(sample.pct) : null,
    source: String(sample.source || "").trim()
  };
}

function emptyTrackingStore() {
  return { stocks: [], updatedAt: "" };
}

function readTrackingStore() {
  const store = readJsonFile(TRACKING_FILE, emptyTrackingStore());
  return {
    stocks: Array.isArray(store.stocks) ? store.stocks.map(normalizeTrackedStock).filter((item) => item.code) : [],
    updatedAt: store.updatedAt || ""
  };
}

function writeTrackingStore(stocks = []) {
  const store = {
    stocks: (Array.isArray(stocks) ? stocks : []).map(normalizeTrackedStock).filter((item) => item.code),
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(TRACKING_FILE, store);
  return store;
}

function addTrackedStock(stock = {}) {
  const next = normalizeTrackedStock(stock);
  if (!next.code) throw new Error("缺少股票代码");
  const store = readTrackingStore();
  const existing = store.stocks.find((item) => item.code === next.code);
  if (existing) {
    Object.assign(existing, {
      name: next.name || existing.name,
      market: next.market ?? existing.market
    });
    return writeTrackingStore(store.stocks);
  }
  return writeTrackingStore([{ ...next, addedAt: new Date().toISOString() }, ...store.stocks]);
}

function removeTrackedStock(code = "") {
  const cleanCode = String(code || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
  const store = readTrackingStore();
  return writeTrackingStore(store.stocks.filter((item) => item.code !== cleanCode));
}

function appendTrackingSample(code = "", quote = {}) {
  const cleanCode = String(code || quote.code || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
  if (!cleanCode) return readTrackingStore();
  const store = readTrackingStore();
  const stock = store.stocks.find((item) => item.code === cleanCode);
  if (!stock) return store;
  const sample = normalizeTrackingSample({
    time: new Date().toISOString(),
    price: quote.price,
    volume: quote.volume,
    amount: quote.amount,
    pct: quote.pct,
    source: quote.source
  });
  if (!sample) return store;
  stock.name = quote.name || stock.name;
  stock.market = Number.isFinite(Number(quote.market)) ? Number(quote.market) : stock.market;
  stock.lastUpdatedAt = sample.time;
  stock.samples = [...stock.samples, sample].slice(-MAX_SAMPLES_PER_STOCK);
  return writeTrackingStore(store.stocks);
}

function updateTrackingKlines(code = "", klines = []) {
  const cleanCode = String(code || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
  if (!cleanCode) return readTrackingStore();
  const store = readTrackingStore();
  const stock = store.stocks.find((item) => item.code === cleanCode);
  if (!stock) return store;
  stock.klines = (Array.isArray(klines) ? klines : []).map(normalizeTrackingKline).filter(Boolean).slice(-MAX_KLINES_PER_STOCK);
  stock.lastUpdatedAt = new Date().toISOString();
  return writeTrackingStore(store.stocks);
}

module.exports = {
  MAX_KLINES_PER_STOCK,
  MAX_SAMPLES_PER_STOCK,
  addTrackedStock,
  appendTrackingSample,
  normalizeTrackedStock,
  normalizeTrackingKline,
  normalizeTrackingSample,
  readTrackingStore,
  removeTrackedStock,
  updateTrackingKlines,
  writeTrackingStore
};
