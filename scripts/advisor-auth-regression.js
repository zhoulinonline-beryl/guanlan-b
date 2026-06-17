#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5173";
const adminPassword = process.env.ADMIN_PASSWORD || "123321";

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} did not return JSON: ${text.slice(0, 120)}`);
  }
  return { response, json };
}

function assert(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details).slice(0, 1000)}`);
}

async function main() {
  const checks = [];
  const record = async (name, fn) => {
    const started = Date.now();
    const result = await fn();
    checks.push({ name, ms: Date.now() - started, result });
  };

  await record("admin-status", async () => {
    const { json } = await requestJson("/api/admin/status");
    assert(json.ok, "admin status failed", json);
    assert(json.data?.hasHoldings === true, "test requires historical holdings", json);
    assert(json.data?.hasAdminPassword === true, "test requires admin password", json);
    return { hasHoldings: json.data.hasHoldings, authenticated: json.data.authenticated };
  });

  await record("holdings-blocked-without-token", async () => {
    const { response, json } = await requestJson("/api/holdings?fast=1");
    assert(response.status === 401, "holdings should reject missing token", { status: response.status, json });
    assert(json.code === "ADMIN_AUTH_REQUIRED", "holdings should return auth code", json);
    return { status: response.status, code: json.code };
  });

  await record("advisor-holdings-blocked-without-token", async () => {
    const { json } = await requestJson("/api/advisor-chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "我的持股有哪些？成本价和数量是多少？" }]
      })
    });
    assert(json.ok, "advisor no-token response should be ok prompt", json);
    assert(json.data?.holdingsAuthRequired === true, "advisor should request auth", json);
    assert(json.data?.holdingsContextUsed === false, "advisor should not use holdings context", json);
    assert(/没有管理员授权/.test(json.data?.content || ""), "advisor should explain missing auth", json);
    return {
      holdingsAuthRequired: json.data.holdingsAuthRequired,
      holdingsContextUsed: json.data.holdingsContextUsed
    };
  });

  let token = "";
  await record("admin-login", async () => {
    const { response, json } = await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: adminPassword })
    });
    assert(response.status === 200 && json.ok && json.data?.token, "admin login failed", { status: response.status, json });
    token = json.data.token;
    return { token: "<ok>", expiresInMs: json.data.expiresInMs };
  });

  await record("holdings-allowed-with-token", async () => {
    const { response, json } = await requestJson("/api/holdings?fast=1", {
      headers: { "X-Admin-Token": token }
    });
    assert(response.status === 200 && json.ok, "holdings should allow valid token", { status: response.status, json });
    assert(Array.isArray(json.data?.rows) && json.data.rows.length > 0, "holdings rows missing", json);
    return { rows: json.data.rows.length };
  });

  await record("advisor-holdings-allowed-with-token", async () => {
    const { json } = await requestJson("/api/advisor-chat", {
      method: "POST",
      headers: { "X-Admin-Token": token },
      body: JSON.stringify({
        messages: [{ role: "user", content: "我的持股有哪些？成本价和数量是多少？" }]
      })
    });
    assert(json.ok, "advisor token response failed", json);
    assert(json.data?.holdingsContextUsed === true, "advisor should use holdings context with token", json);
    assert(Number(json.data?.holdingsContextCount || 0) > 0, "advisor holdings count missing", json);
    return {
      holdingsContextUsed: json.data.holdingsContextUsed,
      holdingsContextCount: json.data.holdingsContextCount
    };
  });

  console.log(JSON.stringify({ ok: true, baseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error.message }, null, 2));
  process.exit(1);
});
