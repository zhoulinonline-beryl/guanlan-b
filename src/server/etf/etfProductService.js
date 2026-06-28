const path = require("path");
const { readJsonFile } = require("../storage/jsonStore");

const PRODUCTS_JS_URL = "https://www.huatai-pb.com/common/index.html.js";
const PRODUCT_SNAPSHOT_FILE = path.join(__dirname, "etfProductSnapshot.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function parseAllFundsJs(text = "") {
  const js = String(text || "");
  const start = js.indexOf("var allFunds = [");
  if (start === -1) return [];
  const end = js.indexOf("];", start);
  if (end === -1) return [];
  const arrayLiteral = js.slice(start + "var allFunds = ".length, end + 2);
  // 使用 Function 构造器安全地解析数组字面量（仅包含字符串字面量）
  const funds = new Function(`return ${arrayLiteral};`)();
  if (!Array.isArray(funds)) return [];
  return funds.map((row) => {
    const parts = String(row).split(",");
    return {
      code: parts[0]?.trim() || "",
      name: parts[1]?.trim() || "",
      type: parts[2]?.trim() || "",
      fullName: parts[3]?.trim() || "",
      url: parts[4]?.trim() || "",
      buyable: parts[5]?.trim() === "1",
      risk: parts[6]?.trim() || "",
      manager: parts[7]?.trim() || ""
    };
  }).filter((item) => item.code && item.name);
}

function filterEtfProducts(products = []) {
  return products.filter((item) => /ETF/i.test(item.name));
}

function createEtfProductService({ fetchText } = {}) {
  const doFetchText = typeof fetchText === "function"
    ? fetchText
    : async (url) => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GuanlanRadar/1.0)",
          Referer: "https://www.huatai-pb.com/products/index.html"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    };

  let memoryCache = null;
  let memoryCachedAt = 0;

  function loadSnapshot() {
    const data = readJsonFile(PRODUCT_SNAPSHOT_FILE, { updatedAt: "", products: [] });
    return Array.isArray(data.products) ? data.products : [];
  }

  async function fetchAllProducts() {
    const js = await doFetchText(PRODUCTS_JS_URL);
    const products = parseAllFundsJs(js);
    if (!products.length) throw new Error("未从华泰柏瑞官网解析到基金数据");
    return products;
  }

  async function getAllProducts(force = false) {
    if (!force && memoryCache && Date.now() - memoryCachedAt < CACHE_TTL_MS) {
      return memoryCache;
    }
    try {
      const products = await fetchAllProducts();
      memoryCache = products;
      memoryCachedAt = Date.now();
      return products;
    } catch (error) {
      if (memoryCache) return memoryCache;
      const snapshot = loadSnapshot();
      memoryCache = snapshot;
      memoryCachedAt = Date.now();
      return snapshot;
    }
  }

  async function getEtfProductInfo(code = "") {
    const products = await getAllProducts();
    const target = String(code).trim();
    return products.find((item) => item.code === target) || null;
  }

  async function getEtfProducts() {
    const products = await getAllProducts();
    return filterEtfProducts(products);
  }

  return {
    getAllProducts,
    getEtfProductInfo,
    getEtfProducts,
    parseAllFundsJs,
    filterEtfProducts
  };
}

module.exports = {
  createEtfProductService,
  parseAllFundsJs,
  filterEtfProducts
};
