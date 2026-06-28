const path = require("path");
const { readJsonFile } = require("../storage/jsonStore");

const ETF_LIST_URL = "https://www.huatai-pb.com/etf-list-search";
const SNAPSHOT_FILE = path.join(__dirname, "etfListSnapshot.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function marketOfEtf(code = "") {
  const c = String(code);
  // 深圳 ETF 以 159 开头，其余常见 ETF 均为上海
  return c.startsWith("159") ? 0 : 1;
}

function parseEtfListHtml(html = "") {
  const text = String(html || "");
  const regex = /<p class="etf-name">([^<]+)<\/p>\s*<p class="etf-code">(\d{6})<\/p>/g;
  const etfs = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const code = match[2].trim();
    if (!name || !code) continue;
    const market = marketOfEtf(code);
    etfs.push({
      name,
      code,
      market,
      symbol: `${market === 1 ? "sh" : "sz"}${code}`
    });
  }
  return etfs;
}

function createEtfListService({ fetchText } = {}) {
  const doFetchText = typeof fetchText === "function"
    ? fetchText
    : async (url) => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GuanlanRadar/1.0)"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    };

  let memoryCache = null;
  let memoryCachedAt = 0;

  function loadSnapshot() {
    const data = readJsonFile(SNAPSHOT_FILE, { etfs: [] });
    return Array.isArray(data.etfs) ? data.etfs : [];
  }

  async function fetchEtfList() {
    const html = await doFetchText(ETF_LIST_URL);
    const etfs = parseEtfListHtml(html);
    if (!etfs.length) throw new Error("未从华泰柏瑞官网解析到 ETF 数据");
    return etfs;
  }

  async function getEtfList(force = false) {
    if (!force && memoryCache && Date.now() - memoryCachedAt < CACHE_TTL_MS) {
      return memoryCache;
    }
    try {
      const etfs = await fetchEtfList();
      memoryCache = etfs;
      memoryCachedAt = Date.now();
      return etfs;
    } catch (error) {
      if (memoryCache) return memoryCache;
      const snapshot = loadSnapshot();
      memoryCache = snapshot;
      memoryCachedAt = Date.now();
      return snapshot;
    }
  }

  return {
    getEtfList,
    fetchEtfList,
    parseEtfListHtml,
    marketOfEtf
  };
}

module.exports = {
  createEtfListService,
  marketOfEtf,
  parseEtfListHtml
};
