const fs = require("fs");
const path = require("path");

// Run from project root: node scripts/backfillConcentration.js [--start=2025-06-28] [--end=2026-06-28] [--workers=4]

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  acc[key] = value || true;
  return acc;
}, {});

const startDate = args.start || getRelativeDate(365);
const endDate = args.end || getRelativeDate(0);
const workers = Math.max(1, Math.min(10, Number(args.workers) || 4));
const minCoverage = 0.6;

const {
  readHistoryFile,
  writeHistoryFile,
  putRecord
} = require("../src/server/indicators/concentrationHistoryStore");
const { calculateConcentration } = require("../src/server/indicators/concentration");
const { symbolOf, marketOf } = require("../src/server/market/symbols");

const EASTMONEY_UT = "b2884a393a59ad64002292a3e90d46a5";

function getRelativeDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36",
          Referer: "https://quote.eastmoney.com/",
          Accept: "application/json,text/plain,*/*"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty response");
      return JSON.parse(text.replace(/^jQuery\d+_\d+\(/, "").replace(/\);?$/, ""));
    } catch (error) {
      lastError = error;
      await sleep(500 * (i + 1));
    }
  }
  throw lastError;
}

function eastmoneyUrl(host, pathname, params) {
  const url = new URL(`https://${host}${pathname}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function getAllAshares() {
  const all = [];
  const pageSize = 100;
  let page = 1;
  const fsFilter = "m:0+t:6,m:1+t:2,m:1+t:23,m:0+t:80";
  const fields = "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8";
  while (page <= 100) {
    const url = eastmoneyUrl("push2.eastmoney.com", "/api/qt/clist/get", {
      pn: String(page),
      pz: String(pageSize),
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f6",
      fs: fsFilter,
      fields
    });
    const json = await fetchJson(url);
    const rows = json?.data?.diff || [];
    if (!rows.length) break;
    for (const row of rows) {
      const code = String(row.f12 || "").trim();
      const name = String(row.f14 || "").trim();
      if (!code || !name) continue;
      all.push({
        code,
        name,
        market: Number.isFinite(Number(row.f13)) ? Number(row.f13) : marketOf(code)
      });
    }
    if (rows.length < pageSize) break;
    page += 1;
  }
  return all;
}

async function getStockKlines(stock, count) {
  const secid = `${stock.market}.${stock.code}`;
  const url = eastmoneyUrl("push2his.eastmoney.com", "/api/qt/stock/kline/get", {
    secid,
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt: "101",
    fqt: "1",
    end: "20500101",
    lmt: String(count)
  });
  const json = await fetchJson(url);
  const lines = json?.data?.klines || [];
  return lines.map((line) => {
    const [day, open, close, high, low, volume, amount, amplitude, pct, change, turnover] = line.split(",");
    return {
      day,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      price: Number(close),
      pct: Number(pct),
      change: Number(change),
      amount: Number(amount),
      volume: Number(volume),
      turnover: Number(turnover)
    };
  }).filter((item) => Number.isFinite(item.amount) && item.amount > 0);
}

function getTradingDays(start, end) {
  const days = [];
  let current = new Date(`${start}T00:00:00+08:00`);
  const last = new Date(`${end}T00:00:00+08:00`);
  while (current <= last) {
    const weekday = current.getDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(current.toISOString().slice(0, 10));
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index;
      index += 1;
      try {
        results[i] = await tasks[i]();
      } catch (error) {
        results[i] = { error: error.message };
      }
      await sleep(120); // ~8 req/s per worker
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`补录区间: ${startDate} ~ ${endDate}`);
  console.log(`并发数: ${workers}`);

  const history = readHistoryFile();
  const existingDates = new Set((history.records || []).map((r) => r.date));

  const tradingDays = getTradingDays(startDate, endDate);
  console.log(`交易日数量: ${tradingDays.length}`);

  console.log("获取当前全 A 股代码列表...");
  const stocks = await getAllAshares();
  console.log(`共 ${stocks.length} 只股票`);

  const targetCount = tradingDays.length;
  const klineDays = Math.ceil(targetCount * 1.2) + 5;

  console.log(`开始拉取每只股票的 ${klineDays} 日 K 线...`);
  const progressInterval = setInterval(() => {
    process.stdout.write(`\r已处理: ${completed}/${stocks.length}`);
  }, 1000);

  let completed = 0;
  const byDay = new Map();
  for (const day of tradingDays) byDay.set(day, []);

  const tasks = stocks.map((stock) => async () => {
    const rows = await getStockKlines(stock, klineDays);
    for (const row of rows) {
      const list = byDay.get(row.day);
      if (list) list.push(row);
    }
    completed += 1;
  });

  await runWithConcurrency(tasks, workers);
  clearInterval(progressInterval);
  process.stdout.write(`\r已处理: ${completed}/${stocks.length}\n`);

  console.log("计算每日集中度...");
  let saved = 0;
  let skippedHoliday = 0;
  for (const day of tradingDays) {
    const list = byDay.get(day) || [];
    if (existingDates.has(day)) {
      continue;
    }
    if (list.length < stocks.length * minCoverage) {
      skippedHoliday += 1;
      continue;
    }
    const calc = calculateConcentration(list);
    if (calc.sampleCount < 100) continue;
    putRecord({
      date: day,
      scope: "沪深A股",
      sampleCount: calc.sampleCount,
      dataSource: "eastmoney",
      totalAmount: calc.totalAmount,
      dimensions: {
        top25: { ratio: calc.top25.ratio, amount: calc.top25.amount },
        top1pct: { ratio: calc.top1pct.ratio, amount: calc.top1pct.amount },
        top5pct: { ratio: calc.top5pct.ratio, amount: calc.top5pct.amount }
      },
      industryDistribution: [],
      checksum: "",
      cachedAt: new Date().toISOString()
    });
    saved += 1;
  }

  console.log(`已保存 ${saved} 条新记录，跳过 ${skippedHoliday} 个低覆盖率日期（节假日）`);
  const final = readHistoryFile();
  console.log(`历史记录总数: ${final.records.length}`);
}

main().catch((error) => {
  console.error("补录失败:", error);
  process.exit(1);
});
