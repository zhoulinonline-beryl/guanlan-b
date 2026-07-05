function startGoldenPinRefreshJob({ isAshareTradingAutoRefreshTime, refreshGoldenPins, refreshMs }) {
  if (isAshareTradingAutoRefreshTime()) {
    refreshGoldenPins({ force: true }).then((cache) => {
      console.log(`金针探底池已生成: ${cache.data.length} 只`);
    }).catch((error) => {
      console.warn(`金针探底池生成失败: ${error.message}`);
    });
  } else {
    console.log("当前非 A 股交易时段，跳过金针探底池自动生成");
  }

  return setInterval(() => {
    if (!isAshareTradingAutoRefreshTime()) return;
    refreshGoldenPins({ force: true }).then((cache) => {
      console.log(`金针探底池已刷新: ${cache.data.length} 只`);
    }).catch((error) => {
      console.warn(`金针探底池刷新失败: ${error.message}`);
    });
  }, refreshMs);
}

module.exports = {
  startGoldenPinRefreshJob
};
