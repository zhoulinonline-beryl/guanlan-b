import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadTrackingStoreWithDataDir(dataDir) {
  process.env.GUANLAN_DATA_DIR = dataDir;
  for (const id of [
    "../src/server/config.js",
    "../src/server/storage/jsonStore.js",
    "../src/server/storage/trackingStore.js"
  ]) {
    delete require.cache[require.resolve(id)];
  }
  return require("../src/server/storage/trackingStore.js");
}

describe("tracking store", () => {
  it("adds, samples, caps, and removes tracked stocks", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-tracking-"));
    try {
      const store = loadTrackingStoreWithDataDir(dataDir);
      assert.deepEqual(store.readTrackingStore(), { stocks: [], updatedAt: "" });

      store.addTrackedStock({ code: "sh600000", name: "浦发银行", market: 1 });
      let current = store.readTrackingStore();
      assert.equal(current.stocks.length, 1);
      assert.equal(current.stocks[0].code, "600000");
      assert.equal(current.stocks[0].name, "浦发银行");

      store.addTrackedStock({ code: "600000", name: "浦发银行A", market: 1 });
      current = store.readTrackingStore();
      assert.equal(current.stocks.length, 1);
      assert.equal(current.stocks[0].name, "浦发银行A");

      store.appendTrackingSample("600000", { price: 10.1, volume: 1200, amount: 90000, pct: 1.2, source: "test" });
      current = store.readTrackingStore();
      assert.equal(current.stocks[0].samples.length, 1);
      assert.equal(current.stocks[0].samples[0].price, 10.1);
      assert.equal(current.stocks[0].samples[0].volume, 1200);

      const manySamples = Array.from({ length: store.MAX_SAMPLES_PER_STOCK + 5 }, (_, index) => ({
        time: `T-${index}`,
        price: 10 + index,
        volume: index
      }));
      const manyKlines = Array.from({ length: store.MAX_KLINES_PER_STOCK + 3 }, (_, index) => ({
        day: `D-${index}`,
        open: 10 + index,
        close: 10.5 + index,
        high: 11 + index,
        low: 9 + index,
        volume: 1000 + index
      }));
      store.writeTrackingStore([{ code: "600000", name: "浦发银行A", samples: manySamples, klines: manyKlines }]);
      current = store.readTrackingStore();
      assert.equal(current.stocks[0].samples.length, store.MAX_SAMPLES_PER_STOCK);
      assert.equal(current.stocks[0].samples[0].price, 15);
      assert.equal(current.stocks[0].klines.length, store.MAX_KLINES_PER_STOCK);
      assert.equal(current.stocks[0].klines[0].day, "D-3");

      store.updateTrackingKlines("600000", manyKlines.slice(0, 2));
      current = store.readTrackingStore();
      assert.equal(current.stocks[0].klines.length, 2);
      assert.equal(current.stocks[0].klines[1].close, 11.5);

      store.removeTrackedStock("600000");
      assert.equal(store.readTrackingStore().stocks.length, 0);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("ignores invalid samples and rejects missing stock codes", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-tracking-"));
    try {
      const store = loadTrackingStoreWithDataDir(dataDir);
      assert.throws(() => store.addTrackedStock({ name: "无代码" }), /缺少股票代码/);
      store.addTrackedStock({ code: "000001", name: "平安银行" });
      store.appendTrackingSample("000001", { price: "bad", volume: "bad" });
      assert.equal(store.readTrackingStore().stocks[0].samples.length, 0);
      store.updateTrackingKlines("000001", [{ open: "bad", close: 1, high: 2, low: 0 }]);
      assert.equal(store.readTrackingStore().stocks[0].klines.length, 0);
      assert.equal(store.normalizeTrackingSample({ price: 1, volume: 2 })?.price, 1);
      assert.equal(store.normalizeTrackingSample({ price: "bad", volume: "bad" }), null);
      assert.equal(store.normalizeTrackingKline({ open: 1, close: 2, high: 3, low: 0 })?.close, 2);
      assert.equal(store.normalizeTrackingKline({ open: "bad", close: 2, high: 3, low: 0 }), null);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
