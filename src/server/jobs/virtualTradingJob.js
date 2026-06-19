function createVirtualTradingJob({
  runVirtualTradingCycle,
  isAshareTradingAutoRefreshTime,
  refreshMs = 10 * 60 * 1000
}) {
  let inFlight = null;

  async function refreshVirtualTrading({ reason = "schedule", force = false } = {}) {
    if (isAshareTradingAutoRefreshTime && !isAshareTradingAutoRefreshTime()) {
      return { skipped: true, reason, message: "非A股交易自动刷新时段" };
    }
    if (inFlight) {
      return { skipped: true, reason, message: "上一轮虚拟交易仍在执行" };
    }
    inFlight = runVirtualTradingCycle({ reason, force });
    const result = await inFlight.finally(() => {
      inFlight = null;
    });
    if (!result?.cycle?.skipped) {
      const signals = result?.cycle?.signals || [];
      const traded = signals.filter((item) => item.traded).length;
      if (signals.length) console.log(`[virtual-trading] ${reason}: signals=${signals.length}, trades=${traded}`);
    }
    return result;
  }

  function start() {
    setTimeout(() => refreshVirtualTrading({ reason: "startup" }).catch((error) => {
      console.error("[virtual-trading-startup-failed]", error.message);
    }), 2500);
    return setInterval(() => {
      refreshVirtualTrading({ reason: "schedule" }).catch((error) => {
        console.error("[virtual-trading-failed]", error.message);
      });
    }, refreshMs);
  }

  return {
    refreshVirtualTrading,
    start
  };
}

module.exports = {
  createVirtualTradingJob
};
