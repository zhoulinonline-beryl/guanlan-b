const { EASTMONEY_UT, majorIndices } = require("../config");
const { marketDataSource } = require("../storage/settingsStore");
const { toNumber } = require("../utils/number");
const { marketOf, symbolOf } = require("./symbols");
const { trendScore } = require("./indicators");

const indexSecids = new Map([
  ["sh000001", "1.000001"],
  ["sz399001", "0.399001"],
  ["sz399006", "0.399006"],
  ["sh000688", "1.000688"],
  ["sh000300", "1.000300"],
  ["sh000905", "1.000905"],
  ["sh000016", "1.000016"],
  ["bj899050", "0.899050"]
]);

const curatedSectors = [
  ["semiconductor", "半导体", [["sh688981", "中芯国际"], ["sz002371", "北方华创"], ["sh688256", "寒武纪"], ["sh688120", "华海清科"], ["sh603986", "兆易创新"], ["sh600584", "长电科技"], ["sh603501", "韦尔股份"], ["sh688126", "沪硅产业"], ["sh688037", "芯源微"], ["sz002156", "通富微电"]]],
  ["robot", "机器人", [["sz002747", "埃斯顿"], ["sz300124", "汇川技术"], ["sh688017", "绿的谐波"], ["sz002896", "中大力德"], ["sh603728", "鸣志电器"], ["sz300024", "机器人"], ["sz300607", "拓斯达"], ["sh603662", "柯力传感"], ["sz002472", "双环传动"], ["sh688160", "步科股份"]]],
  ["low-altitude", "低空经济", [["sz001696", "宗申动力"], ["sz000988", "华工科技"], ["sz000099", "中信海直"], ["sz002389", "航天彩虹"], ["sh688070", "纵横股份"], ["sh688631", "莱斯信息"], ["sz002708", "光洋股份"], ["sz301091", "深城交"], ["sz002023", "海特高新"], ["sz300900", "广联航空"]]],
  ["compute", "算力租赁", [["sh601138", "工业富联"], ["sz300308", "中际旭创"], ["sz300502", "新易盛"], ["sz000977", "浪潮信息"], ["sz300442", "润泽科技"], ["sz000938", "紫光股份"], ["sz300383", "光环新网"], ["sh603881", "数据港"], ["sz002335", "科华数据"], ["sz300738", "奥飞数据"]]],
  ["innovative-drug", "创新药", [["sh600276", "恒瑞医药"], ["sh688235", "百济神州"], ["sh603259", "药明康德"], ["sz300558", "贝达药业"], ["sh688180", "君实生物"], ["sz002294", "信立泰"], ["sz002422", "科伦药业"], ["sh688331", "荣昌生物"], ["sh688062", "迈威生物"], ["sh688266", "泽璟制药"]]],
  ["broker", "证券", [["sh600030", "中信证券"], ["sz300059", "东方财富"], ["sh601688", "华泰证券"], ["sh601211", "国泰君安"], ["sh600999", "招商证券"], ["sz000776", "广发证券"], ["sh600837", "海通证券"], ["sh601108", "财通证券"], ["sh601878", "浙商证券"], ["sh601136", "首创证券"]]],
  ["ev", "新能源车", [["sz002594", "比亚迪"], ["sz300750", "宁德时代"], ["sh601127", "赛力斯"], ["sh601689", "拓普集团"], ["sz002920", "德赛西威"], ["sh603596", "伯特利"], ["sz002906", "华阳集团"], ["sh600699", "均胜电子"], ["sz002050", "三花智控"], ["sz300568", "星源材质"]]],
  ["liquor", "白酒", [["sh600519", "贵州茅台"], ["sz000858", "五粮液"], ["sz000568", "泸州老窖"], ["sh600809", "山西汾酒"], ["sz002304", "洋河股份"], ["sz000596", "古井贡酒"], ["sh603369", "今世缘"], ["sh600702", "舍得酒业"], ["sz000799", "酒鬼酒"], ["sh600779", "水井坊"]]],
  ["coal", "煤炭", [["sh601088", "中国神华"], ["sh601225", "陕西煤业"], ["sh600188", "兖矿能源"], ["sh601898", "中煤能源"], ["sh600546", "山煤国际"], ["sh601699", "潞安环能"], ["sh601666", "平煤股份"], ["sh600985", "淮北矿业"], ["sh600348", "华阳股份"], ["sz002128", "电投能源"]]],
  ["bank", "银行", [["sh600036", "招商银行"], ["sz002142", "宁波银行"], ["sh601398", "工商银行"], ["sh601939", "建设银行"], ["sh601288", "农业银行"], ["sh600919", "江苏银行"], ["sh601838", "成都银行"], ["sh600926", "杭州银行"], ["sh601128", "常熟银行"], ["sh601166", "兴业银行"]]],
  ["military", "军工", [["sh600760", "中航沈飞"], ["sh600893", "航发动力"], ["sz000768", "中航西飞"], ["sz002625", "光启技术"], ["sz002025", "航天电器"], ["sh688297", "中无人机"], ["sh600967", "内蒙一机"], ["sh603678", "火炬电子"], ["sz000733", "振华科技"], ["sz300395", "菲利华"]]],
  ["real-estate", "房地产", [["sz000002", "万科A"], ["sh600048", "保利发展"], ["sz001979", "招商蛇口"], ["sz002244", "滨江集团"], ["sh600383", "金地集团"], ["sh600325", "华发股份"], ["sh600266", "城建发展"], ["sh601155", "新城控股"], ["sh600606", "绿地控股"], ["sh600895", "张江高科"]]]
];

function normalizeSectorName(name = "") {
  return String(name)
    .replace(/\s+/g, "")
    .replace(/板块$/, "")
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u, "")
    .replace(/[一二三四五六七八九十]+$/u, "");
}

function stockAdviceForServer(stock) {
  const candles = stock.candles || [];
  if (candles.length < 20) {
    return {
      action: "等待数据",
      plan: "K 线数据不足，先按仓位和当日涨跌观察，不追加仓位。",
      risk: "补齐 K 线后再判断止损线。",
      position: "等待",
      levels: {}
    };
  }
  const last = candles.at(-1);
  const lows = candles.slice(-10).map((item) => item.low);
  const highs = candles.slice(-10).map((item) => item.high);
  const avg20 = candles.slice(-20).reduce((sum, item) => sum + item.close, 0) / 20;
  const upDays = candles.slice(-5).filter((item) => item.close >= item.open).length;
  const strong = last.close > avg20 && upDays >= 3 && Number(stock.pct) > -2;
  const tooHot = Number(stock.pct) > 7;
  const support = Math.max(Math.min(...lows), last.close * 0.94);
  const pullbackBuy = Math.max(avg20, last.close * 0.97);
  const breakoutBuy = Math.max(...highs) * 1.005;
  const firstTarget = Math.max(...highs, last.close * 1.045);
  if (tooHot) {
    return {
      action: "冲高减仓",
      plan: `当日涨幅偏高，等待回落到 ${pullbackBuy.toFixed(2)} 附近再考虑接回。`,
      risk: `跌回 ${support.toFixed(2)} 下方说明短线转弱。`,
      position: "降至半仓",
      levels: { pullbackBuy, breakoutBuy, stopLoss: support, firstTarget }
    };
  }
  if (strong) {
    return {
      action: "持有或小幅加仓",
      plan: `趋势仍在，回踩 ${pullbackBuy.toFixed(2)} 不破可小幅加仓，突破 ${breakoutBuy.toFixed(2)} 可继续持有。`,
      risk: `跌破 ${support.toFixed(2)} 或放量长阴应减仓。`,
      position: "3-5成",
      levels: { pullbackBuy, breakoutBuy, stopLoss: support, firstTarget }
    };
  }
  return {
    action: "观察减仓",
    plan: `未站稳 20 日均线 ${avg20.toFixed(2)} 前不追加仓位。`,
    risk: `跌破 ${support.toFixed(2)} 先控制风险。`,
    position: "1-2成",
    levels: { pullbackBuy, breakoutBuy, stopLoss: support, firstTarget }
  };
}

function createMarketService({
  fetchJson,
  fetchGbkText,
  eastmoneyUrl,
  getKlines,
  getSinaKlines,
  getTencentKlines,
  getTencentQuotes,
  getQuotesBySource,
  marketDataCache
}) {
  function symbolFromStock(stock) {
    return symbolOf(stock.code, stock.market ?? marketOf(stock.code));
  }

  function findCuratedStocksInText(text = "") {
    const userText = String(text || "");
    const found = [];
    for (const [, , stocks] of curatedSectors) {
      for (const [symbol, name] of stocks) {
        const code = symbol.slice(2);
        if (userText.includes(name) || userText.includes(code)) {
          found.push({ code, name, market: marketOf(code) });
        }
      }
    }
    return found;
  }

  function findSectorForCode(code = "") {
    const target = String(code || "").replace(/\D/g, "");
    if (!target) return null;
    const found = curatedSectors.find(([, , stocks]) => stocks.some(([symbol]) => symbol.slice(2) === target));
    if (!found) return null;
    return { id: found[0], name: found[1] };
  }

  function eastmoneyF10Code(code = "", market = marketOf(code)) {
    const cleanCode = String(code || "").replace(/\D/g, "");
    if (!cleanCode) return "";
    if (market === 1 || cleanCode.startsWith("6")) return `SH${cleanCode}`;
    if (cleanCode.startsWith("8") || cleanCode.startsWith("4")) return `BJ${cleanCode}`;
    return `SZ${cleanCode}`;
  }

  function cleanProfileText(text = "") {
    return String(text || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortClause(text = "", maxLength = 96) {
    const cleaned = cleanProfileText(text);
    if (!cleaned) return "";
    const clause = cleaned.split(/[。；;]\s*/).find(Boolean) || cleaned;
    return clause.length > maxLength ? `${clause.slice(0, maxLength)}...` : clause;
  }

  function extractMainBusiness(profile = "", businessScope = "") {
    const text = cleanProfileText(`${profile} ${businessScope}`);
    const match = text.match(/主营(.{4,80}?)(?=,|，|。|；|;|主导产品|核心产品|主要产品)/) || text.match(/主要从事(.{4,80}?)(?=,|，|。|；|;|主导产品|核心产品|主要产品)/);
    if (match) return cleanProfileText(match[0]);
    return shortClause(businessScope || profile, 110);
  }

  function extractFlagshipProducts(profile = "", businessScope = "", stockName = "") {
    const text = cleanProfileText(`${profile} ${businessScope}`);
    const patterns = [
      /主导产品(.{3,60}?)(?=,|，|。|；|;|是|为)/,
      /核心产品(.{3,60}?)(?=,|，|。|；|;|是|为)/,
      /拳头产品(.{3,60}?)(?=,|，|。|；|;|是|为)/,
      /主要产品(?:包括|为|有)?(.{3,60}?)(?=,|，|。|；|;|是|为)/
    ];
    const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
    if (match) return cleanProfileText(match[0]).replace(/^主要产品包括?/, "主要产品");
    const productTerms = [
      "贵州茅台酒", "酱香系列酒", "动力电池", "储能电池", "锂离子电池", "电池管理系统",
      "新能源汽车", "整车", "汽车零部件", "光模块", "通信设备", "网络设备", "芯片",
      "集成电路", "半导体设备", "半导体材料", "创新药", "仿制药", "医疗器械", "工业机器人",
      "伺服系统", "智能装备", "航空装备", "军工电子", "煤炭", "电力", "住宅开发", "物业服务",
      "证券经纪", "财富管理", "投行业务", "公司金融", "零售金融"
    ];
    const hits = productTerms.filter((term) => text.includes(term));
    if (hits.length) return [...new Set(hits)].slice(0, 4).join("、");
    const scopeLead = shortClause(businessScope, 90)
      .replace(/^(许可项目[:：]?|一般项目[:：]?)/, "")
      .replace(/的生产与销售|生产与销售|研发、生产、销售|研发、销售/g, "")
      .trim();
    if (scopeLead) return scopeLead;
    return stockName ? `${stockName}核心产品待进一步确认` : "核心产品待进一步确认";
  }

  async function getStockProfile(code, market = marketOf(code), name = "") {
    const f10Code = eastmoneyF10Code(code, market);
    if (!f10Code) throw new Error("缺少股票代码");
    const json = await fetchJson(`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${f10Code}`);
    const base = Array.isArray(json?.jbzl) ? json.jbzl[0] : null;
    if (!base) throw new Error(`无法获取 ${code} 公司资料`);
    const profile = cleanProfileText(base.ORG_PROFILE || "");
    const businessScope = cleanProfileText(base.BUSINESS_SCOPE || "");
    const stockName = base.SECURITY_NAME_ABBR || name || code;
    return {
      code: base.SECURITY_CODE || code,
      secucode: base.SECUCODE || "",
      name: stockName,
      companyName: cleanProfileText(base.ORG_NAME || ""),
      industry: cleanProfileText(base.EM2016 || base.INDUSTRYCSRC1 || ""),
      mainBusiness: extractMainBusiness(profile, businessScope),
      flagshipProduct: extractFlagshipProducts(profile, businessScope, stockName),
      businessScope,
      profile,
      website: cleanProfileText(base.ORG_WEB || ""),
      source: "eastmoney-f10"
    };
  }

  async function withTencentStockQuotes(stocks = [], window = 5) {
    const symbols = stocks.map(symbolFromStock);
    const { quotes, source } = await getQuotesBySource(symbols);
    return stocks.map((stock, index) => {
      const symbol = symbols[index];
      const quote = quotes.get(symbol);
      if (!quote || !Number.isFinite(quote.price)) return stock;
      const score = trendScore([], quote.pct, stock.mainFlow, quote.turnover, window);
      return {
        ...stock,
        name: quote.name || stock.name,
        code: quote.code || stock.code,
        market: symbol.startsWith("sh") ? 1 : 0,
        price: quote.price,
        pct: quote.pct,
        change: quote.change,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        prevClose: quote.prevClose,
        volume: quote.volume,
        amount: quote.amount,
        turnover: quote.turnover,
        score,
        quoteSource: quote.source || source,
        source: stock.source ? `${stock.source}+${quote.source || source}` : quote.source || source
      };
    });
  }

  async function _getQuote(code, market = marketOf(code)) {
    const symbol = symbolOf(code, market);
    const { quotes, source } = await getQuotesBySource([symbol]);
    const quote = quotes.get(symbol);
    if (!quote) throw new Error(`无法获取 ${code} 行情`);
    return {
      name: quote.name,
      code: quote.code,
      market: symbol.startsWith("sh") ? 1 : 0,
      price: quote.price,
      pct: quote.pct,
      change: quote.change,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      prevClose: quote.prevClose,
      volume: quote.volume,
      amount: quote.amount,
      turnover: quote.turnover,
      source: quote.source || source
    };
  }

  async function getQuote(code, market = marketOf(code), options = {}) {
    if (!marketDataCache) return _getQuote(code, market);
    return marketDataCache.getQuote(code, market, () => _getQuote(code, market), options);
  }

  async function _getIndices() {
    const { quotes, source } = await getQuotesBySource(majorIndices.map(([symbol]) => symbol));
    return majorIndices.map(([symbol, fallbackName]) => {
      const quote = quotes.get(symbol) || {};
      return {
        id: symbol,
        code: quote.code || symbol.slice(2),
        name: fallbackName,
        price: quote.price,
        pct: quote.pct,
        change: quote.change,
        high: quote.high,
        low: quote.low,
        open: quote.open,
        prevClose: quote.prevClose,
        amount: quote.amount,
        volume: quote.volume,
        source: quote.source || source
      };
    }).filter((item) => Number.isFinite(item.price));
  }

  async function getIndices(options = {}) {
    if (!marketDataCache) return _getIndices();
    return marketDataCache.getIndices(() => _getIndices(), options);
  }

  async function _getIndexKline(symbol) {
    const secid = indexSecids.get(symbol);
    if (!secid) throw new Error("暂不支持该指数");
    if (marketDataSource() === "tencent") {
      const klines = await getTencentKlines(symbol, 14);
      return { symbol, secid, klines, source: "tencent" };
    }
    if (marketDataSource() === "sina") {
      const klines = await getSinaKlines(symbol, 14);
      return { symbol, secid, klines, source: "sina" };
    }
    try {
      const klines = await getKlines(secid, 14);
      return { symbol, secid, klines, source: "eastmoney" };
    } catch {
      const klines = await getTencentKlines(symbol, 14);
      return { symbol, secid, klines, source: "tencent" };
    }
  }

  async function getIndexKline(symbol, options = {}) {
    if (!marketDataCache) return _getIndexKline(symbol);
    return marketDataCache.getIndexKline(symbol, () => _getIndexKline(symbol), options);
  }

  function sectorQuality(sector) {
    const hasMain = sector.mainNet !== null && sector.mainNet !== undefined && Number.isFinite(Number(sector.mainNet));
    const hasQuote = Number.isFinite(Number(sector.index)) || Number.isFinite(Number(sector.pct));
    const sourceScore = sector.source === "sohu" ? 0 : 100;
    return (hasMain ? 1000 : 0) + (hasQuote ? 200 : 0) + sourceScore + Number(sector.attackScore || 0);
  }

  function dedupeSectors(sectors) {
    const byName = new Map();
    for (const sector of sectors) {
      const key = normalizeSectorName(sector.name);
      const existing = byName.get(key);
      if (!existing || sectorQuality(sector) > sectorQuality(existing)) {
        byName.set(key, sector);
      }
    }
    return [...byName.values()];
  }

  async function _getSectors(window = 5) {
    const source = marketDataSource();
    if (source === "tencent") {
      try {
        return await getFallbackSectors(window);
      } catch {
        // 继续走其它行情源兜底。
      }
    }
    if (source === "sina") {
      try {
        return await getSohuFallbackSectors(window);
      } catch {
        // 继续走其它行情源兜底。
      }
    }
    try {
      const commonParams = {
        pn: "1",
        pz: "500",
        po: "1",
        np: "1",
        fltt: "2",
        invt: "2",
        ut: EASTMONEY_UT,
        fid: "f62",
        fields: "f12,f14,f2,f3,f4,f5,f6,f7,f8,f10,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f104,f105,f106"
      };
      const urls = [
        eastmoneyUrl("push2.eastmoney.com", "/api/qt/clist/get", { ...commonParams, fs: "m:90+t:2" }),
        eastmoneyUrl("push2.eastmoney.com", "/api/qt/clist/get", { ...commonParams, fs: "m:90+t:3" })
      ];
      const jsonList = await Promise.all(urls.map((url) => fetchJson(url)));
      const rows = jsonList.flatMap((json) => json?.data?.diff || []);
      if (!rows.length) throw new Error("东方财富板块资金源暂无数据");
      return buildSectorsFromFundRows(rows, window, "eastmoney");
    } catch {
      return getEastmoneyMobileFundSectors(window).catch(() => getSohuFallbackSectors(window).catch(() => getFallbackSectors(window)));
    }
  }

  async function getSectors(window = 5, options = {}) {
    if (!marketDataCache) return _getSectors(window);
    return marketDataCache.getSectors(window, () => _getSectors(window), options);
  }

  async function getEastmoneyMobileFundSectors(window = 5) {
    const url = eastmoneyUrl("emdatah5.eastmoney.com", "/dc/ZJLX/getZDYLBData", {
      fields: "f1,f2,f3,f4,f5,f6,f7,f8,f10,f12,f13,f14,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f104,f105,f106,f128,f140,f141",
      pn: "1",
      pz: "500",
      fid: "f62",
      po: "1",
      fs: "m:90+t:2",
      ut: EASTMONEY_UT
    });
    const json = await fetchJson(url);
    const rows = json?.data?.diff || [];
    if (!rows.length) throw new Error("东方财富移动板块资金源暂无数据");
    return buildSectorsFromFundRows(rows, window, "eastmoney-mobile");
  }

  async function buildSectorsFromFundRows(rows, window, source) {
    const seen = new Set();
    const uniqueRows = rows.filter((row) => {
      if (!row?.f12 || seen.has(row.f12)) return false;
      seen.add(row.f12);
      return true;
    });
    const sortedRows = uniqueRows.sort((a, b) => Number(b.f62 || 0) - Number(a.f62 || 0));
    const withK = await Promise.all(sortedRows.map(async (row, index) => {
      let klines = [];
      let history = [];
      if (index < 48) {
        try {
          klines = await getKlines(`90.${row.f12}`, 45);
          history = klines.slice(-24).map((item) => item.close);
        } catch {
          klines = [];
          history = [];
        }
      }
      const score = trendScore(klines, row.f3, row.f62, row.f8, window);
      return {
        id: row.f12,
        code: row.f12,
        name: row.f14,
        index: toNumber(row.f2),
        pct: toNumber(row.f3),
        change: toNumber(row.f4),
        amount: toNumber(row.f6),
        amplitude: toNumber(row.f7),
        turnover: toNumber(row.f8),
        mainNet: toNumber(row.f62),
        mainNetPct: toNumber(row.f184),
        superNet: toNumber(row.f66),
        superNetPct: toNumber(row.f69),
        bigNet: toNumber(row.f72),
        bigNetPct: toNumber(row.f75),
        mainInSpeed: flowSpeed(row.f6, row.f66, row.f72, "in"),
        mainOutSpeed: flowSpeed(row.f6, row.f66, row.f72, "out"),
        upCount: toNumber(row.f104, 0),
        downCount: toNumber(row.f105, 0),
        flatCount: toNumber(row.f106, 0),
        attackScore: score,
        history,
        source
      };
    }));
    return dedupeSectors(withK).sort((a, b) => Number(b.mainNet || 0) - Number(a.mainNet || 0));
  }

  function flowSpeed(amount, superNet, bigNet, mode) {
    const base = Math.abs(toNumber(amount, 0) || 0);
    if (!base) return null;
    const parts = [toNumber(superNet, 0), toNumber(bigNet, 0)];
    const value = mode === "out"
      ? parts.filter((item) => item < 0).reduce((sum, item) => sum + Math.abs(item), 0)
      : parts.filter((item) => item > 0).reduce((sum, item) => sum + item, 0);
    return (value / base) * 100;
  }

  async function getSohuFallbackSectors(window) {
    const text = await fetchGbkText("https://q.stock.sohu.com/cn/bk.shtml");
    const rows = [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((match) => {
        const plain = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const link = match[1].match(/bk_(\d+)\.shtml[^>]*>([^<]+)</);
        if (!link) return null;
        return { id: `sohu-${link[1]}`, code: `BK${link[1]}`, name: link[2], plain };
      })
      .filter(Boolean);
    const base = await getFallbackSectors(window).catch(() => []);
    const byName = new Map(base.map((item) => [normalizeSectorName(item.name), item]));
    const seenRows = new Set();
    const merged = rows.map((row) => {
      const rowName = normalizeSectorName(row.name);
      if (seenRows.has(rowName)) return null;
      seenRows.add(rowName);
      const enriched = byName.get(rowName);
      if (enriched) return { ...enriched, code: enriched.code || row.code };
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        index: null,
        pct: null,
        change: null,
        amount: null,
        amplitude: null,
        turnover: null,
        mainNet: null,
        upCount: 0,
        downCount: 0,
        flatCount: 0,
        attackScore: 0,
        history: [],
        source: "sohu"
      };
    }).filter(Boolean);
    const existing = new Set(merged.map((item) => normalizeSectorName(item.name)));
    base.filter((item) => !existing.has(normalizeSectorName(item.name))).forEach((item) => merged.push(item));
    return dedupeSectors(merged).sort((a, b) => {
      const af = a.mainNet !== null && a.mainNet !== undefined ? Number(a.mainNet) : -Infinity;
      const bf = b.mainNet !== null && b.mainNet !== undefined ? Number(b.mainNet) : -Infinity;
      if (af !== bf) return bf - af;
      return Number(b.attackScore || 0) - Number(a.attackScore || 0);
    });
  }

  async function _getStocks(board, window = 5) {
    const source = marketDataSource();
    if (source === "tencent" || source === "sina") {
      try {
        return await getFallbackStocks(board, window);
      } catch {
        // 继续走东方财富成分股资金源兜底。
      }
    }
    try {
      return await getMobileBoardFundStocks(board, window);
    } catch {
      try {
        const url = eastmoneyUrl("push2.eastmoney.com", "/api/qt/clist/get", {
          pn: "1",
          pz: "80",
          po: "1",
          np: "1",
          fltt: "2",
          invt: "2",
          fid: "f62",
          fs: `b:${board}`,
          fields: "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f15,f16,f17,f18,f20,f21,f23,f62,f184"
        });
        const json = await fetchJson(url);
        const rows = json?.data?.diff || [];
        const scored = rows.map((row) => {
          const score = trendScore([], row.f3, row.f62, row.f8, window);
          return {
            name: row.f14,
            code: row.f12,
            market: Number.isFinite(Number(row.f13)) ? Number(row.f13) : marketOf(row.f12),
            price: Number(row.f2),
            pct: Number(row.f3),
            change: Number(row.f4),
            volume: Number(row.f5),
            amount: Number(row.f6),
            amplitude: Number(row.f7),
            turnover: Number(row.f8),
            pe: Number(row.f9),
            high: Number(row.f15),
            low: Number(row.f16),
            open: Number(row.f17),
            prevClose: Number(row.f18),
            totalMarketCap: Number(row.f20),
            floatMarketCap: Number(row.f21),
            pb: Number(row.f23),
            mainFlow: Number(row.f62),
            mainFlowPct: Number(row.f184),
            score,
            source: "eastmoney"
          };
        });
        return (await withTencentStockQuotes(scored, window)).sort((a, b) => Number(b.mainFlow || 0) - Number(a.mainFlow || 0));
      } catch {
        return getFallbackStocks(board, window);
      }
    }
  }

  async function getStocks(board, window = 5, options = {}) {
    if (!marketDataCache) return _getStocks(board, window);
    return marketDataCache.getStocks(board, window, () => _getStocks(board, window), options);
  }

  async function getMobileBoardFundStocks(board, window = 5) {
    const url = eastmoneyUrl("emdatah5.eastmoney.com", "/dc/ZJLX/getZDYLBData", {
      fields: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f62,f184,f267,f268,f164,f165,f174,f175",
      pn: "1",
      pz: "80",
      fid: "f62",
      po: "1",
      fs: `b:${board}`,
      ut: EASTMONEY_UT
    });
    const json = await fetchJson(url);
    const rows = json?.data?.diff || [];
    if (!rows.length) throw new Error("移动板块成分股资金源暂无数据");
    const stocks = rows.map((row) => {
      const score = trendScore([], row.f3, row.f62, row.f8, window);
      return {
        name: row.f14,
        code: row.f12,
        market: Number.isFinite(Number(row.f13)) ? Number(row.f13) : marketOf(row.f12),
        price: toNumber(row.f2),
        pct: toNumber(row.f3),
        change: toNumber(row.f4),
        volume: toNumber(row.f5),
        amount: toNumber(row.f6),
        amplitude: toNumber(row.f7),
        turnover: toNumber(row.f8),
        pe: toNumber(row.f9),
        high: toNumber(row.f15),
        low: toNumber(row.f16),
        open: toNumber(row.f17),
        prevClose: toNumber(row.f18),
        totalMarketCap: toNumber(row.f20),
        floatMarketCap: toNumber(row.f21),
        pb: toNumber(row.f23),
        mainFlow: toNumber(row.f62),
        mainFlowPct: toNumber(row.f184),
        superNet: toNumber(row.f267 ?? row.f164),
        superNetPct: toNumber(row.f268 ?? row.f165),
        bigNet: toNumber(row.f174),
        bigNetPct: toNumber(row.f175),
        mainInSpeed: flowSpeed(row.f6, row.f267 ?? row.f164, row.f174, "in"),
        mainOutSpeed: flowSpeed(row.f6, row.f267 ?? row.f164, row.f174, "out"),
        score,
        source: "eastmoney-mobile-board"
      };
    });
    return (await withTencentStockQuotes(stocks, window)).sort((a, b) => Number(b.mainFlow || 0) - Number(a.mainFlow || 0));
  }

  async function _getStockKline(code, market, options = {}) {
    const resolvedMarket = market ?? marketOf(code);
    const symbol = symbolOf(code, resolvedMarket);
    const preferred = marketDataSource();
    const count = Math.max(30, Math.min(900, Number(options.count || options.limit || 120) || 120));
    if (preferred === "tencent") {
      try {
        const klines = await getTencentKlines(symbol, count);
        return { code, market: resolvedMarket, secid: symbol, klines, source: "tencent" };
      } catch {
        // 继续走其它 K 线源兜底。
      }
    }
    if (preferred === "sina") {
      try {
        const klines = await getSinaKlines(symbol, count);
        return { code, market: resolvedMarket, secid: symbol, klines, source: "sina" };
      } catch {
        // 继续走其它 K 线源兜底。
      }
    }
    if (preferred === "eastmoney") {
      try {
        const secid = `${resolvedMarket}.${code}`;
        const klines = await getKlines(secid, count);
        return { code, market: resolvedMarket, secid, klines, source: "eastmoney" };
      } catch {
        // 继续走其它 K 线源兜底。
      }
    }
    try {
      const klines = await getTencentKlines(symbol, count);
      return { code, market: resolvedMarket, secid: symbol, klines, source: "tencent" };
    } catch {
      // 东财和新浪作为 K 线兜底，实时个股行情仍由腾讯 quote 接口提供。
    }
    const secid = `${resolvedMarket}.${code}`;
    try {
      const klines = await getKlines(secid, count);
      return { code, market: resolvedMarket, secid, klines, source: "eastmoney" };
    } catch {
      const klines = await getSinaKlines(symbol, count);
      return { code, market: resolvedMarket, secid, klines, source: "sina" };
    }
  }

  async function getStockKline(code, market, options = {}) {
    if (!marketDataCache) return _getStockKline(code, market, options);
    return marketDataCache.getStockKline(code, market, options, () => _getStockKline(code, market, options));
  }

  async function getAllAsharesFromEastmoney() {
    const all = [];
    const pageSize = 100;
    let page = 1;
    const fs = "m:0+t:6,m:1+t:2,m:1+t:23,m:0+t:80";
    const fields = "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f20,f100";
    while (page <= 100) {
      const url = eastmoneyUrl("push2.eastmoney.com", "/api/qt/clist/get", {
        pn: String(page),
        pz: String(pageSize),
        po: "1",
        np: "1",
        fltt: "2",
        invt: "2",
        fid: "f6",
        fs,
        fields
      });
      const json = await fetchJson(url);
      const rows = json?.data?.diff || [];
      if (!rows.length) break;
      for (const row of rows) {
        const code = String(row.f12 || "").trim();
        const name = String(row.f14 || "").trim();
        const amount = Number(row.f6);
        const price = Number(row.f2);
        if (!code || !name || !Number.isFinite(amount) || amount <= 0) continue;
        all.push({
          name,
          code,
          market: Number.isFinite(Number(row.f13)) ? Number(row.f13) : marketOf(code),
          price,
          pct: Number(row.f3),
          change: Number(row.f4),
          volume: Number(row.f5),
          amount,
          amplitude: Number(row.f7),
          turnover: Number(row.f8),
          industry: String(row.f100 || "").trim(),
          source: "eastmoney"
        });
      }
      if (rows.length < pageSize) break;
      page += 1;
    }
    return all;
  }

  async function _getAllAshares() {
    const preferred = marketDataSource();
    const errors = [];
    if (preferred === "eastmoney") {
      try {
        return await getAllAsharesFromEastmoney();
      } catch (error) {
        errors.push(`eastmoney: ${error.message}`);
      }
    }
    try {
      return await getAllAsharesFromSina();
    } catch (error) {
      errors.push(`sina: ${error.message}`);
    }
    if (preferred !== "eastmoney") {
      try {
        return await getAllAsharesFromEastmoney();
      } catch (error) {
        errors.push(`eastmoney: ${error.message}`);
      }
    }
    throw new Error(`无法获取全A股数据: ${errors.join("; ")}`);
  }

  async function getAllAshares(options = {}) {
    if (!marketDataCache) return _getAllAshares();
    return marketDataCache.getAllAshares(() => _getAllAshares(), options);
  }

  async function getAllAsharesFromSina() {
    const all = [];
    const pageSize = 100;
    let page = 1;
    const maxPages = 100;
    while (page <= maxPages) {
      const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?node=hs_a&num=${pageSize}&page=${page}`;
      const rows = await fetchJson(url);
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        const code = String(row.code || "").trim();
        const name = String(row.name || "").trim();
        const symbol = String(row.symbol || "").trim();
        const amount = Number(row.amount);
        const price = Number(row.trade);
        if (!code || !name || !Number.isFinite(amount) || amount <= 0) continue;
        all.push({
          name,
          code,
          market: symbol.startsWith("sh") ? 1 : 0,
          price,
          pct: Number(row.changepercent),
          change: Number(row.pricechange),
          volume: Number(row.volume),
          amount,
          turnover: Number(row.turnoverratio),
          industry: "",
          source: "sina"
        });
      }
      if (rows.length < pageSize) break;
      page += 1;
    }
    if (!all.length) throw new Error("新浪全A股源返回为空");
    return all;
  }

  async function getAllAsharesFromTencent() {
    const allSymbols = curatedSectors.flatMap(([, , stocks]) => stocks.map(([symbol]) => symbol));
    const quotes = await getTencentQuotes(allSymbols);
    return [...quotes.values()]
      .filter((quote) => Number.isFinite(quote.amount) && quote.amount > 0)
      .map((quote) => ({
        name: quote.name,
        code: quote.code,
        market: quote.symbol.startsWith("sh") ? 1 : 0,
        price: quote.price,
        pct: quote.pct,
        change: quote.change,
        volume: quote.volume,
        amount: quote.amount,
        turnover: quote.turnover,
        industry: "",
        source: "tencent"
      }));
  }

  async function getFallbackSectors(window) {
    const allSymbols = curatedSectors.flatMap(([, , stocks]) => stocks.map(([symbol]) => symbol));
    const quotes = await getTencentQuotes(allSymbols);
    const sectors = await Promise.all(curatedSectors.map(async ([id, name, stocks]) => {
      const stockQuotes = stocks.map(([symbol, stockName]) => ({ ...quotes.get(symbol), symbol, name: stockName })).filter((item) => Number.isFinite(item.price));
      const pct = stockQuotes.reduce((sum, item) => sum + item.pct, 0) / Math.max(1, stockQuotes.length);
      const amount = stockQuotes.reduce((sum, item) => sum + (item.amount || 0), 0);
      const upCount = stockQuotes.filter((item) => item.pct > 0).length;
      const downCount = stockQuotes.filter((item) => item.pct < 0).length;
      let history = [];
      try {
        const samples = await Promise.all(stocks.slice(0, 4).map(([symbol]) => getSinaKlines(symbol, 32)));
        const len = Math.min(...samples.map((rows) => rows.length));
        history = Array.from({ length: Math.min(24, len) }, (_, i) => {
          const rowsIndex = len - Math.min(24, len) + i;
          return samples.reduce((sum, rows) => sum + rows[rowsIndex].close, 0) / samples.length;
        });
      } catch {
        history = stockQuotes.map((item, index) => 1000 + item.pct * 10 + index);
      }
      const attackScore = trendScore(history.map((close) => ({ close, volume: 1 })), pct, 0, 0, window) + Math.min(12, upCount);
      return {
        id,
        code: id,
        name,
        index: history.at(-1) || 1000 + pct * 10,
        pct,
        change: 0,
        amount,
        amplitude: 0,
        turnover: 0,
        mainNet: null,
        upCount,
        downCount,
        flatCount: Math.max(0, stockQuotes.length - upCount - downCount),
        attackScore: Math.max(5, Math.min(99, attackScore)),
        history,
        source: "tencent+sina"
      };
    }));
    return sectors.sort((a, b) => b.attackScore - a.attackScore);
  }

  async function getFallbackStocks(board, window) {
    const sector = curatedSectors.find(([id]) => id === board) || curatedSectors[0];
    if (!sector) throw new Error("当前行情源无法加载该板块成分股");
    const symbols = sector[2].map(([symbol]) => symbol);
    const quotes = await getTencentQuotes(symbols);
    const stocks = sector[2].map(([symbol, name]) => {
      const quote = quotes.get(symbol) || {};
      const code = symbol.slice(2);
      const score = trendScore([], quote.pct, 0, quote.turnover, window);
      return {
        name,
        code,
        market: symbol.startsWith("sh") ? 1 : 0,
        price: quote.price,
        pct: quote.pct,
        change: quote.change,
        volume: quote.volume,
        amount: quote.amount,
        amplitude: Number.isFinite(quote.high) && quote.low ? ((quote.high - quote.low) / quote.prevClose) * 100 : 0,
        turnover: quote.turnover,
        mainFlow: null,
        mainFlowPct: null,
        score,
        quoteSource: "tencent",
        source: "tencent"
      };
    }).filter((item) => Number.isFinite(item.price));
    return stocks.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  function clearMarketCache() {
    if (marketDataCache) marketDataCache.clear();
  }

  return {
    normalizeSectorName,
    stockAdviceForServer,
    symbolFromStock,
    findCuratedStocksInText,
    findSectorForCode,
    withTencentStockQuotes,
    getQuote,
    getIndices,
    getIndexKline,
    sectorQuality,
    dedupeSectors,
    getSectors,
    getStocks,
    getStockKline,
    getStockProfile,
    getAllAshares,
    getAllAsharesFromEastmoney,
    getAllAsharesFromSina,
    getAllAsharesFromTencent,
    getFallbackSectors,
    getFallbackStocks,
    clearMarketCache
  };
}

module.exports = {
  normalizeSectorName,
  stockAdviceForServer,
  createMarketService
};
