function marketOf(code) {
  if (/^(6|9|688)/.test(code)) return 1;
  if (/^(8|4|43|83|87|92)/.test(code)) return 0;
  return 0;
}

function symbolOf(code, market = marketOf(code)) {
  if (String(code).startsWith("bj")) return String(code);
  if (String(code).startsWith("sh") || String(code).startsWith("sz")) return String(code);
  return `${Number(market) === 1 ? "sh" : "sz"}${code}`;
}

function eastmoneySecidFromSymbol(symbol) {
  const code = String(symbol).replace(/^(sh|sz|bj)/, "");
  const market = String(symbol).startsWith("sh") ? 1 : 0;
  return `${market}.${code}`;
}

module.exports = {
  marketOf,
  symbolOf,
  eastmoneySecidFromSymbol
};
