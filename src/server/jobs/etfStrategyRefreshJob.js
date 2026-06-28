function startEtfStrategyRefreshJob({ isAshareTradingAutoRefreshTime, refreshEtfStrategy, refreshMs }) {
  if (isAshareTradingAutoRefreshTime()) {
    refreshEtfStrategy({ force: false }).then((result) => {
      console.log(`ETF 策略已生成: 中期 ${result.mediumTop5.length} 只，短期 ${result.shortTop5.length} 只`);
    }).catch((error) => {
      console.warn(`ETF 策略初始刷新失败: ${error.message}`);
    });
  } else {
    console.log("当前非 A 股交易时段，跳过 ETF 策略自动生成");
  }

  return setInterval(() => {
    if (!isAshareTradingAutoRefreshTime()) return;
    refreshEtfStrategy({ force: true }).then((result) => {
      console.log(`ETF 策略已刷新: 中期 ${result.mediumTop5.length} 只，短期 ${result.shortTop5.length} 只`);
    }).catch((error) => {
      console.warn(`ETF 策略刷新失败: ${error.message}`);
    });
  }, refreshMs);
}

module.exports = {
  startEtfStrategyRefreshJob
};
