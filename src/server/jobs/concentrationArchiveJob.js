function createConcentrationArchiveJob({ archiveToday, isAshareTradingAutoRefreshTime }) {
  return async function ensureArchive() {
    if (!isAshareTradingAutoRefreshTime()) {
      console.log("当前非 A 股交易时段，跳过集中度日终归档");
      return null;
    }
    try {
      return await archiveToday();
    } catch (error) {
      console.error("[concentration-archive-job-failed]", error.message);
      return null;
    }
  };
}

function startConcentrationArchiveJob({ archiveToday, isAshareTradingAutoRefreshTime }) {
  const archiveJob = createConcentrationArchiveJob({ archiveToday, isAshareTradingAutoRefreshTime });

  // 启动时尝试归档一次（如果在交易时段）
  archiveJob();

  // 每 5 分钟检查一次，只有在交易时段才会真正执行归档
  return setInterval(() => {
    archiveJob();
  }, 5 * 60 * 1000);
}

module.exports = {
  createConcentrationArchiveJob,
  startConcentrationArchiveJob
};
