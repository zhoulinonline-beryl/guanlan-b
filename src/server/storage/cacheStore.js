const { CACHE_FILE } = require("../config");
const { readAppSettings } = require("./settingsStore");
const { readJsonFile, writeJsonFile } = require("./jsonStore");

const cache = new Map();
let cacheFlushTimer = null;

function cacheGet(key, ttl) {
  if (!readAppSettings().useCache) return null;
  const item = cache.get(key);
  if (!item) return null;
  if (ttl && Date.now() - item.time > ttl) return null;
  return item.value;
}

function cacheSet(key, value) {
  if (!readAppSettings().useCache) return value;
  cache.set(key, { time: Date.now(), value });
  scheduleCacheFlush();
  return value;
}

function loadPersistentCache() {
  cache.clear();
  const stored = readJsonFile(CACHE_FILE, {});
  for (const [key, item] of Object.entries(stored)) {
    if (item && Number.isFinite(Number(item.time))) cache.set(key, item);
  }
}

function scheduleCacheFlush() {
  if (cacheFlushTimer) return;
  cacheFlushTimer = setTimeout(() => {
    cacheFlushTimer = null;
    flushPersistentCache();
  }, 1200);
}

function flushPersistentCache() {
  if (!readAppSettings().useCache) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = [...cache.entries()]
    .filter(([, item]) => item.time >= cutoff)
    .slice(-400);
  writeJsonFile(CACHE_FILE, Object.fromEntries(rows));
}

function clearRuntimeCache() {
  cache.clear();
}

module.exports = {
  cacheGet,
  cacheSet,
  loadPersistentCache,
  scheduleCacheFlush,
  flushPersistentCache,
  clearRuntimeCache
};
