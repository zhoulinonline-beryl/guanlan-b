const { CN_MARKET_CLOSED_DATES_2026 } = require("../config");

function chinaMarketNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const get = (type) => parts.find((item) => item.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    minutes: Number(get("hour")) * 60 + Number(get("minute"))
  };
}

function isAshareTradingAutoRefreshTime(now = new Date()) {
  const market = chinaMarketNow(now);
  if (market.weekday === "Sat" || market.weekday === "Sun") return false;
  if (CN_MARKET_CLOSED_DATES_2026.has(market.date)) return false;
  const inMorning = market.minutes >= 9 * 60 + 30 && market.minutes <= 11 * 60 + 30;
  const inAfternoon = market.minutes >= 13 * 60 && market.minutes <= 15 * 60;
  return inMorning || inAfternoon;
}

module.exports = {
  chinaMarketNow,
  isAshareTradingAutoRefreshTime
};
