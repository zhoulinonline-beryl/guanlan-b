function createNewsService({ fetchText, kimiWebSearchJson, escapeXml, normalizeSectorName }) {
  function normalizeKimiNewsItems(items = [], limit = 10, fallbackName = "", maxAgeDays = 181) {
    const oldest = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return items
      .filter((item) => item && item.title && item.link)
      .map((item) => {
        const pubDate = item.pubDate || item.date || "";
        const time = item.time ? Number(item.time) : Date.parse(pubDate) || 0;
        const kind = item.kind || (/政策|发改委|工信部|财政部|证监会|国常会|规划|补贴|监管|标准|通知/.test(`${item.title} ${item.summary || ""}`) ? "政策" : "新闻");
        const tone = item.tone || "中性观察";
        return {
          title: String(item.title).trim(),
          link: String(item.link).trim(),
          description: item.summary || item.description || "",
          pubDate,
          time,
          source: item.source || sourceFromLink(item.link),
          kind,
          tone,
          impact: item.impact || `${kind}${tone}：${fallbackName || "相关方向"} 需关注${String(item.title).replace(/\s+/g, "")}`,
          advice: item.advice || "结合价格、量能和资金强弱确认，不单独依据消息面追涨杀跌。",
          reason: item.reason || item.impact || "消息面仅作为辅助变量，需等待技术面和资金面确认。"
        };
      })
      .filter((item) => !item.time || (item.time <= Date.now() + 60 * 60 * 1000 && item.time >= oldest))
      .slice(0, limit);
  }

  async function getKimiStockNews(code, name, limit = 10) {
    const stockName = name || code;
    const windowDays = 3;
    const prompt = [
      `请使用全网搜索最近${windowDays}天内与 A 股股票「${stockName} ${code}」直接相关的新闻、公告、政策、产业催化、监管信息或公司事件，最多${limit}条。`,
      `今天是 ${new Date().toISOString().slice(0, 10)}，不要返回未来日期的信息。`,
      `只返回最近${windowDays}天内的信息；如果不足3条也不要放宽到更早日期，必须在 pubDate 标注真实发布日期，不要编造。`,
      "搜索范围不要局限在新闻站点，也要覆盖交易所/上市公司公告、监管机构、行业协会、权威媒体、财经网站和可公开访问的网页。",
      "必须是直接影响该上市公司本身的信息；如果股票名称也是券商/研究机构，排除其发布的行业研报、评级观点、策略报告，除非新闻直接涉及该公司公告、业绩、股东、融资、并购、监管、主营业务或股价交易。",
      "请优先选择权威媒体、交易所公告、公司公告、证券媒体、政策发布源。",
      "返回 JSON：{\"items\":[{\"title\":\"\",\"link\":\"\",\"source\":\"\",\"pubDate\":\"YYYY-MM-DD HH:mm\",\"kind\":\"政策|新闻|公告\",\"tone\":\"偏正面|偏负面|中性观察\",\"summary\":\"一句话摘要\",\"impact\":\"对该股的影响判断\",\"reason\":\"为什么影响交易判断\",\"advice\":\"具体操作建议\"}]}。",
      "advice 要具体说明建仓/持有/减仓/观察条件，例如结合 K 线、MACD、SAR、BOLL 或主力资金确认。"
    ].join("\n");
    const json = await kimiWebSearchJson({
      prompt,
      cacheKey: `kimi-stock-news:${code}:${stockName}:${limit}:${windowDays}d`
    });
    return normalizeKimiNewsItems(json.items || [], limit * 2, stockName, windowDays)
      .filter((item) => isStockRelatedNews(item, code, stockName))
      .slice(0, limit);
  }

  async function getStockNews(code, name, limit = 10) {
    try {
      const items = await getKimiStockNews(code, name, limit);
      if (items.length) return items;
    } catch {
      // 联网搜索失败时回退到公开搜索 RSS，保证页面仍可用。
    }
    try {
      const since = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const items = await fetchWholeWebRssItems([
        `A股 ${name || ""} ${code} 新闻 公告 政策`,
        `${name || ""} ${code} 上市公司 公告 监管 业绩`,
        `${name || ""} ${code} 资金 主力 股价`
      ]);
      return dedupeNewsItems(items)
        .filter((item) => item.title && item.link)
        .filter((item) => isStockRelatedNews(item, code, name))
        .filter((item) => !item.time || item.time >= since)
        .sort((a, b) => stockNewsScore(b, code, name) - stockNewsScore(a, code, name))
        .map((item) => ({ ...item, ...stockNewsAdvice(item, code, name) }))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  function decodeBingNewsLink(link) {
    try {
      const parsed = new URL(link);
      const target = parsed.searchParams.get("url");
      return target ? decodeURIComponent(target) : link;
    } catch {
      return link;
    }
  }

  function sourceFromLink(link) {
    try {
      const target = decodeBingNewsLink(link);
      return new URL(target).hostname.replace(/^www\./, "");
    } catch {
      return "Bing News";
    }
  }

  function parseRssItems(text) {
    return [...String(text).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
      const block = match[1];
      const rawLink = escapeXml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "");
      const link = decodeBingNewsLink(rawLink);
      const title = escapeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
      const description = escapeXml(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "").replace(/<[^>]+>/g, "");
      const pubDate = escapeXml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "");
      return { title, link, description, pubDate, time: Date.parse(pubDate) || 0, source: sourceFromLink(rawLink) };
    });
  }

  function wholeWebSearchUrls(query) {
    const keyword = encodeURIComponent(query);
    return [
      `https://www.bing.com/news/search?q=${keyword}&format=rss&setlang=zh-CN`,
      `https://www.bing.com/search?q=${keyword}&format=rss&setlang=zh-CN`
    ];
  }

  async function fetchWholeWebRssItems(queries = []) {
    const urls = [...new Set(queries.flatMap((query) => wholeWebSearchUrls(String(query || "").trim())).filter(Boolean))];
    const batches = await Promise.all(urls.map(async (url) => {
      try {
        const text = await fetchText(url);
        const type = url.includes("/news/search") ? "Bing News" : "Bing Web";
        return parseRssItems(text).map((item) => ({ ...item, searchSource: type }));
      } catch {
        return [];
      }
    }));
    return batches.flat();
  }

  function dedupeNewsItems(items = []) {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${String(item.link || "").replace(/[?#].*$/, "")}|${String(item.title || "").replace(/\s+/g, "")}`;
      if (!item.title || !item.link || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isStockRelatedNews(item, code, name) {
    const stockName = String(name || "").trim();
    const compactName = stockName.replace(/股份|集团|有限责任公司|有限公司|科技|证券|银行/g, "");
    const text = `${item.title || ""} ${item.description || ""} ${item.source || ""} ${item.link || ""}`;
    if (code && text.includes(String(code))) return true;
    if (stockName && text.includes(stockName)) return true;
    return compactName.length >= 2 && text.includes(compactName);
  }

  function stockNewsScore(item, code, name) {
    const text = `${item.title || ""} ${item.description || ""}`;
    let score = item.time || 0;
    if (name && text.includes(name)) score += 4 * 24 * 60 * 60 * 1000;
    if (code && text.includes(code)) score += 3 * 24 * 60 * 60 * 1000;
    if (/政策|发改委|工信部|财政部|证监会|国常会|规划|补贴|监管|标准|通知/.test(text)) score += 2 * 24 * 60 * 60 * 1000;
    if (/主力|资金|北向|融资|机构|龙虎榜|回购|增持|减持|订单|业绩/.test(text)) score += 24 * 60 * 60 * 1000;
    return score;
  }

  function stockNewsAdvice(item, code, name) {
    const stockName = name || code || "该股";
    const title = item.title || "";
    const text = `${title} ${item.description || ""}`;
    const isPolicy = /政策|发改委|工信部|财政部|证监会|国常会|规划|补贴|关税|监管|标准|发布|通知|意见|办法|方案/.test(text);
    const titleNegative = /净卖出|净流出|减持|处罚|调查|问询|退市|诉讼|制裁|禁令|事故|立案/.test(title);
    const titlePositive = /净买入|净流入|增持|回购|中标|订单|补贴|支持|涨停|创新高/.test(title);
    const strongNegative = /净卖出|净流出|减持|处罚|调查|问询|退市|诉讼|制裁|禁令|事故|立案/.test(text);
    const strongPositive = /净买入|净流入|增持|回购|中标|订单|补贴|支持|涨停|创新高/.test(text);
    const isNegative = strongNegative || /下调|亏损|承压|风险|大跌/.test(text);
    const isPositive = strongPositive || /上调|增长|扭亏|扩产|突破|利好|复苏/.test(text);
    const tone = titleNegative ? "偏负面" : titlePositive ? "偏正面" : strongNegative ? "偏负面" : strongPositive ? "偏正面" : isNegative ? "偏负面" : isPositive ? "偏正面" : "中性观察";
    const kind = isPolicy ? "政策" : "新闻";
    const action = tone === "偏负面"
      ? "不宜追高，先看分时承接和关键均线是否守住；已有仓位可降低到防守仓位。"
      : tone === "偏正面"
        ? "若 K 线放量站稳关键位且 MACD/SAR 同步转强，可用小仓位试错，避免情绪高点一次性打满。"
        : "作为辅助变量跟踪，买卖仍以量价、BOLL 位置和资金强弱确认。";
    const reason = tone === "偏负面"
      ? `${stockName} 的消息面可能压制风险偏好，短线优先验证卖压是否释放。`
      : tone === "偏正面"
        ? `${stockName} 的消息面有利于资金关注，但需要技术面共振确认持续性。`
        : `${stockName} 暂未出现明确单边催化，建议结合盘口和板块强度判断。`;
    return {
      kind,
      tone,
      impact: `${kind}${tone}：${item.title.replace(/\s+/g, "")}`,
      advice: action,
      reason
    };
  }

  function policyImpact(item, sectorName) {
    const text = `${item.title} ${item.description}`;
    const policyTerms = /政策|发改委|工信部|财政部|证监会|国常会|规划|补贴|关税|监管|标准|发布|通知/;
    const isPolicy = policyTerms.test(item.title) || /发改委|工信部|财政部|证监会|国常会/.test(item.description);
    const isNegative = /下调|处罚|调查|限制|风险|亏损|减产|下跌|承压|退坡|禁令|制裁/.test(text);
    const isPositive = /上调|支持|加码|补贴|增长|拉升|走高|涨停|突破|利好|扩产|复苏/.test(text);
    const tone = isNegative ? "偏负面" : isPositive ? "偏正面" : "中性观察";
    const kind = isPolicy ? "政策" : "新闻";
    return `${kind}${tone}：${sectorName} 需关注${item.title.replace(/\s+/g, "")}`;
  }

  function sectorNewsScore(item, sectorName) {
    const title = item.title || "";
    const description = item.description || "";
    const normalized = normalizeSectorName(sectorName);
    const titleHit = title.includes(sectorName) || title.includes(normalized);
    const descHit = description.includes(sectorName) || description.includes(normalized);
    const policyHit = /政策|发改委|工信部|财政部|证监会|国常会|规划|补贴|关税|监管|标准|发布|通知/.test(`${title} ${description}`);
    const recency = item.time ? Math.max(0, 2 - (Date.now() - item.time) / (24 * 60 * 60 * 1000)) : 0.5;
    return (titleHit ? 8 : 0) + (descHit ? 4 : 0) + (policyHit ? 2 : 0) + recency;
  }

  async function getSectorNews(name, limit = 3) {
    try {
      const items = await getKimiSectorNews(name, limit);
      if (items.length) return items;
    } catch {
      // 联网搜索失败时回退到公开搜索 RSS。
    }
    try {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const items = dedupeNewsItems(await fetchWholeWebRssItems([
        `A股 ${name} 板块 政策 新闻`,
        `${name} 行业 政策 产业 监管 A股`,
        `${name} 板块 主力 资金 催化`
      ]))
        .filter((item) => item.title && item.link)
        .map((item) => ({
          ...item,
          impact: policyImpact(item, name)
        }))
        .sort((a, b) => sectorNewsScore(b, name) - sectorNewsScore(a, name));
      return items.filter((item) => !item.time || item.time >= since).slice(0, limit);
    } catch {
      return [];
    }
  }

  async function getKimiSectorNews(name, limit = 3) {
    const prompt = [
      `请使用全网搜索优先查找最近1天可能影响 A 股「${name}」板块的新闻、政策、产业事件、监管信息或公开网页，最多${limit}条。`,
      `今天是 ${new Date().toISOString().slice(0, 10)}，不要返回未来日期的信息。`,
      "如果最近1天不足3条，请放宽到最近30天；如果仍不足，再最多放宽到最近180天，但必须在 pubDate 标注真实发布日期，不要编造。",
      "搜索范围不要局限在新闻站点，也要覆盖政策发布源、交易所/协会公告、公司公告、权威媒体、财经网站和可公开访问的网页。",
      "请优先选择政策发布源、权威媒体、交易所/协会/公司公告、证券媒体。",
      "返回 JSON：{\"items\":[{\"title\":\"\",\"link\":\"\",\"source\":\"\",\"pubDate\":\"YYYY-MM-DD HH:mm\",\"kind\":\"政策|新闻|公告\",\"tone\":\"偏正面|偏负面|中性观察\",\"summary\":\"一句话摘要\",\"impact\":\"对该板块的影响判断\",\"reason\":\"为什么影响该板块\",\"advice\":\"对板块交易的具体建议\"}]}。",
      "impact 必须直接提到板块名称；advice 要说明是追踪、试仓、等待确认还是风险规避。"
    ].join("\n");
    const json = await kimiWebSearchJson({
      prompt,
      cacheKey: `kimi-sector-news:${name}:${limit}`
    });
    return normalizeKimiNewsItems(json.items || [], limit, name);
  }

  async function getSectorNewsBatch(names = []) {
    const unique = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))].slice(0, 12);
    const pairs = await Promise.all(unique.map(async (name) => {
      const news = await getSectorNews(name, 3).catch(() => []);
      return [name, news];
    }));
    return Object.fromEntries(pairs);
  }

  return {
    normalizeKimiNewsItems,
    getKimiStockNews,
    getStockNews,
    decodeBingNewsLink,
    sourceFromLink,
    parseRssItems,
    stockNewsScore,
    stockNewsAdvice,
    policyImpact,
    sectorNewsScore,
    getSectorNews,
    getKimiSectorNews,
    getSectorNewsBatch
  };
}

module.exports = {
  createNewsService
};
