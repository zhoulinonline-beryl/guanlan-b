#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5173";
const adminPassword = process.env.ADMIN_PASSWORD || "123321";
let adminToken = "";

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} did not return JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok || json.ok === false) {
    throw new Error(`${pathname} failed: ${json.error || response.status}`);
  }
  return json;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const checks = [];
  const record = async (name, fn) => {
    const started = Date.now();
    const result = await fn();
    checks.push({ name, ms: Date.now() - started, result });
  };

  await record("settings", async () => {
    const json = await requestJson("/api/settings");
    assert(json.data && typeof json.data.marketDataSource === "string", "settings missing marketDataSource");
    return { marketDataSource: json.data.marketDataSource, useCache: json.data.useCache };
  });

  await record("indices", async () => {
    const json = await requestJson("/api/indices");
    assert(Array.isArray(json.data) && json.data.length >= 4, "indices count too small");
    return { count: json.data.length, first: json.data[0]?.name, source: json.data[0]?.source };
  });

  await record("sectors", async () => {
    const json = await requestJson("/api/sectors?window=5");
    assert(Array.isArray(json.data) && json.data.length >= 8, "sectors count too small");
    return { count: json.data.length, first: json.data[0]?.name, source: json.data[0]?.source };
  });

  await record("quote", async () => {
    const json = await requestJson("/api/quote?code=600519&market=1");
    assert(json.data?.price > 0, "quote missing price");
    return { name: json.data.name, price: json.data.price, source: json.data.source };
  });

  await record("kline", async () => {
    const json = await requestJson("/api/kline?code=600519&market=1");
    assert(Array.isArray(json.data?.klines) && json.data.klines.length >= 20, "kline count too small");
    return { count: json.data.klines.length, source: json.data.source };
  });

  await record("stocks", async () => {
    const json = await requestJson("/api/stocks?board=BK0478&window=5");
    assert(Array.isArray(json.data) && json.data.length >= 10, "stocks count too small");
    return { count: json.data.length, first: json.data[0]?.name, source: json.data[0]?.source };
  });

  await record("recommendations", async () => {
    const json = await requestJson("/api/recommendations");
    assert(["idle", "running", "ready", "error"].includes(json.status), "recommendations status invalid");
    if (json.status === "ready") assert(Array.isArray(json.data), "recommendations data missing");
    return { status: json.status, count: json.data?.length || 0, error: json.error || "" };
  });

  await record("admin-login", async () => {
    const json = await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: adminPassword })
    });
    assert(json.data?.token, "admin token missing");
    adminToken = json.data.token;
    return { token: "<ok>", expiresInMs: json.data.expiresInMs };
  });

  await record("holdings", async () => {
    const json = await requestJson("/api/holdings", {
      headers: { "X-Admin-Token": adminToken }
    });
    assert(json.data && Array.isArray(json.data.rows), "holdings rows missing");
    return { rows: json.data.rows.length, parser: json.data.parser };
  });

  if (process.env.RUN_EXTENDED === "1") {
    await record("index-kline", async () => {
      const json = await requestJson("/api/index-kline?symbol=sh000001");
      assert(Array.isArray(json.data?.klines) && json.data.klines.length >= 10, "index kline count too small");
      return { count: json.data.klines.length, source: json.data.source };
    });

    await record("stock-news", async () => {
      const json = await requestJson("/api/news?code=600519&name=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0");
      assert(Array.isArray(json.data), "stock news data missing");
      return { count: json.data.length, first: json.data[0]?.title || "" };
    });

    await record("sector-news", async () => {
      const json = await requestJson("/api/sector-news?names=%E6%9C%89%E8%89%B2%E9%87%91%E5%B1%9E,%E7%94%B5%E5%8A%9B%E8%AE%BE%E5%A4%87");
      assert(json.data && typeof json.data === "object", "sector news data missing");
      return Object.fromEntries(Object.entries(json.data).map(([name, items]) => [name, items.length]));
    });

    await record("advisor-chat", async () => {
      const json = await requestJson("/api/advisor-chat", {
        method: "POST",
        headers: { "X-Admin-Token": adminToken },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "请用一句话说明你是否已经能结合我的持仓成本和当前价回答。" }
          ]
        })
      });
      assert(json.data?.model, "advisor model missing");
      return {
        model: json.data.model,
        holdingsContextUsed: Boolean(json.data.holdingsContextUsed),
        contentPreview: String(json.data.content || "").slice(0, 80)
      };
    });
  }

  console.log(JSON.stringify({ ok: true, baseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error.message }, null, 2));
  process.exit(1);
});
