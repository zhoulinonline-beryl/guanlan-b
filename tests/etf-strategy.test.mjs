import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { parseEtfListHtml, marketOfEtf } = require("../src/server/etf/etfListService.js");
const { findBestSector, normalizeName } = require("../src/server/etf/etfSectorMapper.js");
const {
  computeEtfMetrics,
  mediumEtfScore,
  shortEtfScore,
  isMediumCandidate,
  isShortCandidate
} = require("../src/server/etf/etfStrategyService.js");
const {
  createEtfProductService,
  parseAllFundsJs,
  filterEtfProducts
} = require("../src/server/etf/etfProductService.js");

function mockHtml() {
  return `
    <div class="etf-box">
      <a href="/products/zhishu/510300/index.html#sgshqd">
      <p class="etf-name">沪深300ETF华泰柏瑞</p>
      <p class="etf-code">510300</p>
    </div>
    <div class="etf-box">
      <a href="/products/zhishu/159007/index.html#sgshqd">
      <p class="etf-name">养殖ETF华泰柏瑞</p>
      <p class="etf-code">159007</p>
    </div>
  `;
}

function upCandles(length = 70) {
  return Array.from({ length }, (_, index) => {
    const close = 10 + index * 0.2;
    const volume = 1000 + index * 50;
    return {
      day: `2026-06-${String(index + 1).padStart(2, "0")}`,
      open: close - 0.1,
      close,
      high: close + 0.15,
      low: close - 0.2,
      volume,
      turnover: 2.5 + index * 0.05
    };
  });
}

function downCandles(length = 70) {
  return Array.from({ length }, (_, index) => {
    const close = 20 - index * 0.25;
    const volume = 1000 + index * 40;
    return {
      day: `2026-06-${String(index + 1).padStart(2, "0")}`,
      open: close + 0.1,
      close,
      high: close + 0.2,
      low: close - 0.25,
      volume,
      turnover: 2.0 + index * 0.04
    };
  });
}

describe("etf list service", () => {
  it("parses ETF list HTML", () => {
    const etfs = parseEtfListHtml(mockHtml());
    assert.equal(etfs.length, 2);
    assert.equal(etfs[0].name, "沪深300ETF华泰柏瑞");
    assert.equal(etfs[0].code, "510300");
    assert.equal(etfs[0].market, 1);
    assert.equal(etfs[0].symbol, "sh510300");
    assert.equal(etfs[1].name, "养殖ETF华泰柏瑞");
    assert.equal(etfs[1].code, "159007");
    assert.equal(etfs[1].market, 0);
    assert.equal(etfs[1].symbol, "sz159007");
  });

  it("identifies ETF market by code", () => {
    assert.equal(marketOfEtf("510300"), 1);
    assert.equal(marketOfEtf("159915"), 0);
    assert.equal(marketOfEtf("560910"), 1);
  });
});

describe("etf sector mapper", () => {
  it("matches ETF name to sector by keyword", () => {
    const sectors = [
      { id: "bk1", name: "光伏设备", attackScore: 78, mainNet: 120000000 },
      { id: "bk2", name: "银行", attackScore: 62, mainNet: -50000000 },
      { id: "bk3", name: "养殖", attackScore: 55, mainNet: 30000000 }
    ];
    const bank = findBestSector("银行ETF华泰柏瑞", sectors);
    assert.equal(bank.name, "银行");
    assert.equal(bank.attackScore, 62);

    const pv = findBestSector("光伏ETF华泰柏瑞", sectors);
    assert.equal(pv.name, "光伏设备");

    const breed = findBestSector("养殖ETF华泰柏瑞", sectors);
    assert.equal(breed.name, "养殖");
  });

  it("returns null when keyword misses", () => {
    const sectors = [
      { id: "bk1", name: "家居家电", attackScore: 50, mainNet: 10000000 }
    ];
    const sector = findBestSector("沪深300ETF华泰柏瑞", sectors);
    assert.equal(sector, null);
  });

  it("returns null for unrelated names", () => {
    const sectors = [{ id: "bk1", name: "银行", attackScore: 60, mainNet: 0 }];
    const sector = findBestSector("光伏ETF华泰柏瑞", sectors);
    assert.equal(sector, null);
  });

  it("normalizes names", () => {
    assert.equal(normalizeName("  银行ETF华泰柏瑞  "), "银行");
    assert.equal(normalizeName("光伏ETF华泰柏瑞"), "光伏");
  });
});

describe("etf strategy service", () => {
  it("computes ETF metrics for rising candles", () => {
    const metrics = computeEtfMetrics(upCandles(70));
    assert.ok(metrics.return3m > 0);
    assert.ok(metrics.return2w > 0);
    assert.ok(Number.isFinite(metrics.volatility3m));
    assert.ok(Number.isFinite(metrics.trendScoreValue));
    assert.ok(metrics.technical !== null);
  });

  it("computes ETF metrics for falling candles", () => {
    const metrics = computeEtfMetrics(downCandles(70));
    assert.ok(metrics.return3m < 0);
    assert.ok(metrics.return2w < 0);
    assert.ok(Number.isFinite(metrics.volatility3m));
  });

  it("scores medium ETF higher for uptrend", () => {
    const up = computeEtfMetrics(upCandles(70));
    const down = computeEtfMetrics(downCandles(70));
    const sector = { sectorScore: 70, sectorMainNet: 100000000 };
    const upScore = mediumEtfScore(up, sector);
    const downScore = mediumEtfScore(down, sector);
    assert.ok(Number.isFinite(upScore));
    assert.ok(Number.isFinite(downScore));
    assert.ok(upScore > downScore);
  });

  it("scores short ETF higher for recent momentum", () => {
    const up = computeEtfMetrics(upCandles(70));
    const down = computeEtfMetrics(downCandles(70));
    const sector = { sectorScore: 70, sectorMainNet: 100000000 };
    const upScore = shortEtfScore(up, sector);
    const downScore = shortEtfScore(down, sector);
    assert.ok(Number.isFinite(upScore));
    assert.ok(Number.isFinite(downScore));
    assert.ok(upScore > downScore);
  });

  it("filters medium candidates by data sufficiency", () => {
    const enough = computeEtfMetrics(upCandles(70));
    enough.rowsCount = 70;
    assert.equal(isMediumCandidate(enough), true);

    const notEnough = computeEtfMetrics(upCandles(20));
    notEnough.rowsCount = 20;
    assert.equal(isMediumCandidate(notEnough), false);
  });

  it("filters short candidates by technical condition", () => {
    const good = computeEtfMetrics(upCandles(70));
    good.rowsCount = 70;
    assert.equal(isShortCandidate(good), true);

    const bad = computeEtfMetrics(upCandles(70));
    bad.rowsCount = 70;
    bad.technical = { macdLabel: "MACD空头", sarLabel: "SAR趋势压制" };
    assert.equal(isShortCandidate(bad), false);
  });
});

describe("etf product service", () => {
  const sampleJs = `
var allFunds = [
  '001097,华泰柏瑞积极优选股票A,股票型,华泰柏瑞积极优选股票A,/products/gupiao/001097/index.html,0,R3,王林军',
  '159007,养殖ETF华泰柏瑞,指数型,养殖ETF华泰柏瑞,/products/zhishu/159007/index.html,0,R3,尤家妤',
  '513930,恒生生物科技ETF华泰柏瑞,指数型,恒生生物科技ETF华泰柏瑞,/products/zhishu/513930/index.html,0,R4,陈柯含'
];
  `;

  it("parses allFunds JS array", () => {
    const products = parseAllFundsJs(sampleJs);
    assert.equal(products.length, 3);
    assert.equal(products[1].code, "159007");
    assert.equal(products[1].name, "养殖ETF华泰柏瑞");
    assert.equal(products[1].type, "指数型");
    assert.equal(products[1].risk, "R3");
    assert.equal(products[1].manager, "尤家妤");
  });

  it("filters ETF products", () => {
    const products = parseAllFundsJs(sampleJs);
    const etfs = filterEtfProducts(products);
    assert.equal(etfs.length, 2);
    assert.ok(etfs.every((item) => /ETF/i.test(item.name)));
  });

  it("finds ETF product info by code", async () => {
    const svc = createEtfProductService({
      fetchText: async () => sampleJs
    });
    const info = await svc.getEtfProductInfo("513930");
    assert.equal(info.code, "513930");
    assert.equal(info.name, "恒生生物科技ETF华泰柏瑞");
    assert.equal(info.risk, "R4");
  });

  it("returns null for missing ETF code", async () => {
    const svc = createEtfProductService({
      fetchText: async () => sampleJs
    });
    const info = await svc.getEtfProductInfo("999999");
    assert.equal(info, null);
  });
});
