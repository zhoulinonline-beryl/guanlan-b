function startRecommendationRefreshJob({ isAshareTradingAutoRefreshTime, refreshRecommendations, refreshMs }) {
  if (isAshareTradingAutoRefreshTime()) {
    refreshRecommendations({ force: true }).then((cache) => {
      console.log(`股票推荐池已生成: ${cache.data.length} 只`);
    });
  } else {
    console.log("当前非 A 股交易时段，跳过股票推荐池自动生成");
  }

  return setInterval(() => {
    if (!isAshareTradingAutoRefreshTime()) return;
    refreshRecommendations({ force: true }).then((cache) => {
      console.log(`股票推荐池已刷新: ${cache.data.length} 只`);
    });
  }, refreshMs);
}

module.exports = {
  startRecommendationRefreshJob
};
