function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function average(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function roundLot(qty) {
  const value = Math.floor(Number(qty || 0) / 100) * 100;
  return value >= 100 ? value : 0;
}

function splitLots(totalQty, firstRatio = 0.5) {
  const total = roundLot(totalQty);
  if (!total) return [0, 0];
  const first = Math.max(100, roundLot(total * firstRatio));
  const second = roundLot(total - first);
  return second ? [first, second] : [total, 0];
}

function moneyText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return n.toFixed(0);
}

function toFixedText(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

module.exports = {
  toNumber,
  average,
  roundLot,
  splitLots,
  moneyText,
  toFixedText
};
