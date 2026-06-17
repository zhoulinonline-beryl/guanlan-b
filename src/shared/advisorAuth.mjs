export const HOLDINGS_INTENT_PATTERN = /我的|持仓|持股|仓位|成本|浮盈|浮亏|被套|解套|做T|做t|卖不卖|要不要卖|要不要加|加仓|减仓|补仓|清仓|调仓|组合|账户|股票池/;

export function latestUserText(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item?.role === "user")
    .slice(-4)
    .map((item) => String(item.content || ""))
    .join("\n");
}

export function isHoldingsQuestion(input = "") {
  const text = Array.isArray(input) ? latestUserText(input) : String(input || "");
  return Boolean(text.trim() && HOLDINGS_INTENT_PATTERN.test(text));
}

export function shouldRequestHoldingsAuth({ text = "", messages = [], hasHoldings = false, authenticated = false } = {}) {
  if (!hasHoldings || authenticated) return false;
  return isHoldingsQuestion(text || messages);
}

export function holdingsUnauthorizedMessage({ hasAdminPassword = true } = {}) {
  if (!hasAdminPassword) {
    return "检测到本地保存过我的持股，但管理员密码尚未初始化。请先到设置页创建管理员密码，再回到个股讨论读取持仓。";
  }
  return "需要先完成管理员授权，才能读取我的持股、成本价和持有数量。";
}
