const { HOLDINGS_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonStore");

function normalizeHolding(item = {}) {
  const code = String(item.code || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
  const name = String(item.name || item.stockName || "").trim();
  const qty = Number(item.qty ?? item.quantity ?? item.holdingQty ?? item.shares);
  const cost = Number(item.cost ?? item.costPrice ?? item.avgCost ?? item.price);
  return {
    code,
    name,
    qty: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : null,
    cost: Number.isFinite(cost) && cost > 0 ? cost : null,
    raw: String(item.raw || item.source || "").trim()
  };
}

function readHoldingsStore() {
  const store = readJsonFile(HOLDINGS_FILE, { holdings: [], updatedAt: "" });
  return {
    holdings: Array.isArray(store.holdings) ? store.holdings.map(normalizeHolding).filter((item) => item.code || item.name) : [],
    updatedAt: store.updatedAt || ""
  };
}

function writeHoldingsStore(holdings = []) {
  const store = {
    holdings: (Array.isArray(holdings) ? holdings : []).map(normalizeHolding).filter((item) => item.code || item.name).slice(0, 50),
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(HOLDINGS_FILE, store);
  return store;
}

module.exports = {
  normalizeHolding,
  readHoldingsStore,
  writeHoldingsStore
};
