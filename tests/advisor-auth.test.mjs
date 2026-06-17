import test from "node:test";
import assert from "node:assert/strict";
import {
  holdingsUnauthorizedMessage,
  isHoldingsQuestion,
  latestUserText,
  shouldRequestHoldingsAuth
} from "../src/shared/advisorAuth.mjs";

test("latestUserText keeps only the latest four user messages", () => {
  assert.equal(latestUserText([
    { role: "system", content: "ignore" },
    { role: "user", content: "一" },
    { role: "assistant", content: "ignore" },
    { role: "user", content: "二" },
    { role: "user", content: "三" },
    { role: "user", content: "四" },
    { role: "user", content: "五" }
  ]), "二\n三\n四\n五");
});

test("latestUserText handles non-array input", () => {
  assert.equal(latestUserText(null), "");
});

test("latestUserText handles missing message content", () => {
  assert.equal(latestUserText([
    null,
    { role: "assistant", content: "ignore" },
    { role: "user" },
    { role: "user", content: 123 }
  ]), "\n123");
});

test("isHoldingsQuestion detects direct holding intent from string", () => {
  assert.equal(isHoldingsQuestion("我的持股成本是多少"), true);
  assert.equal(isHoldingsQuestion("今天大盘怎么看"), false);
});

test("isHoldingsQuestion detects holding intent from messages", () => {
  assert.equal(isHoldingsQuestion([
    { role: "assistant", content: "你好" },
    { role: "user", content: "帮我看看仓位和做T" }
  ]), true);
});

test("isHoldingsQuestion rejects blank input", () => {
  assert.equal(isHoldingsQuestion("   "), false);
  assert.equal(isHoldingsQuestion(), false);
});

test("shouldRequestHoldingsAuth requires holdings, no authentication, and holdings intent", () => {
  assert.equal(shouldRequestHoldingsAuth({ text: "我的持仓", hasHoldings: true, authenticated: false }), true);
  assert.equal(shouldRequestHoldingsAuth({ text: "我的持仓", hasHoldings: false, authenticated: false }), false);
  assert.equal(shouldRequestHoldingsAuth({ text: "我的持仓", hasHoldings: true, authenticated: true }), false);
  assert.equal(shouldRequestHoldingsAuth({ text: "半导体怎么看", hasHoldings: true, authenticated: false }), false);
});

test("shouldRequestHoldingsAuth can read messages when text is absent", () => {
  assert.equal(shouldRequestHoldingsAuth({
    messages: [{ role: "user", content: "我的成本价是多少" }],
    hasHoldings: true,
    authenticated: false
  }), true);
  assert.equal(shouldRequestHoldingsAuth({
    messages: [{ role: "user", content: "大盘怎么看" }],
    hasHoldings: true,
    authenticated: false
  }), false);
});

test("shouldRequestHoldingsAuth handles default input", () => {
  assert.equal(shouldRequestHoldingsAuth(), false);
});

test("holdingsUnauthorizedMessage explains locked and uninitialized states", () => {
  assert.match(holdingsUnauthorizedMessage({ hasAdminPassword: true }), /管理员授权/);
  assert.match(holdingsUnauthorizedMessage({ hasAdminPassword: false }), /管理员密码尚未初始化/);
  assert.match(holdingsUnauthorizedMessage(), /管理员授权/);
});
