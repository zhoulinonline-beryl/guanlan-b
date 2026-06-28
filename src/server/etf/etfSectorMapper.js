const { toNumber } = require("../utils/number");

// ETF 名称中的主题词 → 期望匹配的板块名称关键字（优先级从前到后）
const KEYWORD_SECTOR_MAP = [
  { keywords: ["光伏"], sectorKeywords: ["光伏"] },
  { keywords: ["银行"], sectorKeywords: ["银行"] },
  { keywords: ["证券"], sectorKeywords: ["证券"] },
  { keywords: ["机器人"], sectorKeywords: ["机器人"] },
  { keywords: ["半导体", "芯片", "半导体设备"], sectorKeywords: ["半导体", "芯片"] },
  { keywords: ["创新药"], sectorKeywords: ["创新药", "生物制品", "医药"] },
  { keywords: ["新能源车", "汽车"], sectorKeywords: ["汽车", "新能源车"] },
  { keywords: ["白酒", "酿酒"], sectorKeywords: ["白酒", "酿酒"] },
  { keywords: ["煤炭"], sectorKeywords: ["煤炭"] },
  { keywords: ["军工"], sectorKeywords: ["军工"] },
  { keywords: ["房地产", "地产"], sectorKeywords: ["房地产", "地产"] },
  { keywords: ["算力", "云计算", "人工智能", "AI"], sectorKeywords: ["算力", "云计算", "人工智能"] },
  { keywords: ["低空"], sectorKeywords: ["低空"] },
  { keywords: ["红利", "高股息", "低波"], sectorKeywords: ["红利", "高股息"] },
  { keywords: ["生物科技", "生物"], sectorKeywords: ["生物", "医药", "医疗"] },
  { keywords: ["互联网", "物联网"], sectorKeywords: ["互联网", "物联网", "通信", "传媒"] },
  { keywords: ["有色", "稀土", "工业有色"], sectorKeywords: ["有色", "稀土", "金属"] },
  { keywords: ["工程机械"], sectorKeywords: ["工程机械", "机械"] },
  { keywords: ["电池", "锂电"], sectorKeywords: ["电池", "锂电"] },
  { keywords: ["科技"], sectorKeywords: ["科技"] },
  { keywords: ["恒生", "港股通"], sectorKeywords: ["恒生", "港股"] },
  { keywords: ["养殖", "畜牧", "农业"], sectorKeywords: ["养殖", "畜牧", "农业"] }
];

function normalizeName(name = "") {
  return String(name)
    .replace(/[\s\u200b]/g, "")
    .replace(/ETF.*/gi, "")
    .replace(/华泰柏瑞/g, "")
    .toLowerCase();
}

function charOverlapScore(a = "", b = "") {
  const sa = new Set(String(a));
  const sb = new Set(String(b));
  if (!sa.size || !sb.size) return 0;
  let common = 0;
  for (const ch of sa) {
    if (sb.has(ch)) common += 1;
  }
  return common / Math.max(sa.size, sb.size);
}

function keywordMatchScore(etfNameNorm = "", sectorNameNorm = "") {
  let score = 0;
  for (const rule of KEYWORD_SECTOR_MAP) {
    const hitEtf = rule.keywords.some((kw) => etfNameNorm.includes(kw.toLowerCase()));
    if (!hitEtf) continue;
    const hitSector = rule.sectorKeywords.some((kw) => sectorNameNorm.includes(kw.toLowerCase()));
    if (hitSector) {
      // ETF 与板块同时命中同一主题关键词
      score += 1.0;
    }
  }
  return score;
}

function findBestSector(etfName = "", sectors = []) {
  if (!sectors.length) return null;
  const etfNorm = normalizeName(etfName);
  let best = null;
  let bestKwScore = 0;

  // 第一轮：仅按关键词匹配，避免模糊匹配导致的错误映射
  for (const sector of sectors) {
    const sectorName = String(sector.name || "");
    const sectorNorm = normalizeName(sectorName);
    const kwScore = keywordMatchScore(etfNorm, sectorNorm);
    if (kwScore > bestKwScore) {
      bestKwScore = kwScore;
      best = sector;
    }
  }

  if (bestKwScore > 0) return best;
  return null;
}

function createEtfSectorMapper({ getSectors } = {}) {
  let sectorCache = null;
  let sectorCachedAt = 0;
  const CACHE_TTL_MS = 5 * 60 * 1000;

  async function fetchSectors() {
    if (typeof getSectors !== "function") return [];
    if (sectorCache && Date.now() - sectorCachedAt < CACHE_TTL_MS) return sectorCache;
    sectorCache = await getSectors(5);
    sectorCachedAt = Date.now();
    return sectorCache;
  }

  function clearCache() {
    sectorCache = null;
    sectorCachedAt = 0;
  }

  async function mapEtfToSector(etfName = "") {
    const sectors = await fetchSectors();
    const sector = findBestSector(etfName, sectors);
    if (!sector) {
      return {
        sectorName: "",
        sectorScore: 0,
        sectorMainNet: 0,
        sectorId: ""
      };
    }
    return {
      sectorName: String(sector.name || ""),
      sectorScore: toNumber(sector.attackScore, 0) || 0,
      sectorMainNet: toNumber(sector.mainNet, 0) || 0,
      sectorId: String(sector.id || sector.code || "")
    };
  }

  return {
    mapEtfToSector,
    findBestSector,
    clearCache
  };
}

module.exports = {
  createEtfSectorMapper,
  findBestSector,
  normalizeName,
  KEYWORD_SECTOR_MAP
};
