const {
  CONCENTRATION_HISTORY_FILE,
  CONCENTRATION_HISTORY_MAX_DAYS,
  CONCENTRATION_CACHE_TTL_TRADING_MS,
  CONCENTRATION_CACHE_TTL_IDLE_MS
} = require("../config");
const { readJsonFile, writeJsonFile } = require("../storage/jsonStore");
const { isAshareTradingAutoRefreshTime } = require("../utils/time");

const memoryCache = new Map();
let memoryCacheUpdatedAt = 0;

function emptyHistory() {
  return { version: 1, records: [] };
}

function readHistoryFile() {
  return readJsonFile(CONCENTRATION_HISTORY_FILE, emptyHistory());
}

function writeHistoryFile(history = {}) {
  const normalized = {
    version: history.version || 1,
    records: (history.records || [])
      .slice(-CONCENTRATION_HISTORY_MAX_DAYS)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  };
  writeJsonFile(CONCENTRATION_HISTORY_FILE, normalized);
  return normalized;
}

function loadMemoryCache() {
  memoryCache.clear();
  const history = readHistoryFile();
  for (const record of history.records || []) {
    if (record && record.date) memoryCache.set(record.date, record);
  }
  memoryCacheUpdatedAt = Date.now();
  return history;
}

function getMemoryCache() {
  return memoryCache;
}

function getRecord(date = "") {
  const key = String(date);
  if (memoryCache.has(key)) return memoryCache.get(key);
  const history = readHistoryFile();
  return (history.records || []).find((item) => item.date === key) || null;
}

function putRecord(record = {}) {
  if (!record.date) return null;
  const history = readHistoryFile();
  const records = (history.records || []).filter((item) => item.date !== record.date);
  records.push(record);
  const normalized = writeHistoryFile({ ...history, records });
  memoryCache.set(record.date, record);
  memoryCacheUpdatedAt = Date.now();
  return normalized;
}

function removeRecord(date = "") {
  const history = readHistoryFile();
  const records = (history.records || []).filter((item) => item.date !== date);
  memoryCache.delete(date);
  return writeHistoryFile({ ...history, records });
}

function listRecords(window = 60) {
  const history = readHistoryFile();
  const records = (history.records || [])
    .filter((item) => item && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return records.slice(-Math.max(1, Number(window) || 60));
}

function isMemoryCacheExpired() {
  const ttl = isAshareTradingAutoRefreshTime() ? CONCENTRATION_CACHE_TTL_TRADING_MS : CONCENTRATION_CACHE_TTL_IDLE_MS;
  return Date.now() - memoryCacheUpdatedAt > ttl;
}

function memoryCacheStats() {
  return {
    size: memoryCache.size,
    updatedAt: memoryCacheUpdatedAt,
    expired: isMemoryCacheExpired()
  };
}

function clearMemoryCache() {
  memoryCache.clear();
  memoryCacheUpdatedAt = 0;
}

module.exports = {
  emptyHistory,
  readHistoryFile,
  writeHistoryFile,
  loadMemoryCache,
  getMemoryCache,
  getRecord,
  putRecord,
  removeRecord,
  listRecords,
  isMemoryCacheExpired,
  memoryCacheStats,
  clearMemoryCache
};
