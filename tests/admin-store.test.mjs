import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadAdminStoreWithDataDir(dataDir) {
  process.env.GUANLAN_DATA_DIR = dataDir;
  const modules = [
    "../src/server/config.js",
    "../src/server/storage/jsonStore.js",
    "../src/server/storage/adminStore.js"
  ];
  for (const id of modules) {
    delete require.cache[require.resolve(id)];
  }
  return require("../src/server/storage/adminStore.js");
}

describe("admin password persistence", () => {
  it("persists the settings-page password change and accepts it after a restart", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-admin-"));
    try {
      const firstRuntime = loadAdminStoreWithDataDir(dataDir);
      assert.equal(firstRuntime.publicAdminStatus().hasAdminPassword, false);

      firstRuntime.changeAdminPassword("", "123321");
      assert.ok(firstRuntime.adminLogin("123321").token);

      firstRuntime.changeAdminPassword("123321", "new-pass-778899");
      assert.throws(() => firstRuntime.adminLogin("123321"), /管理员密码错误/);
      assert.ok(firstRuntime.adminLogin("new-pass-778899").token);

      const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "admin.json"), "utf8"));
      assert.equal(stored.algorithm, "pbkdf2-sha256");
      assert.ok(stored.salt);
      assert.ok(stored.digest);
      assert.notEqual(stored.digest, "new-pass-778899");

      const restartedRuntime = loadAdminStoreWithDataDir(dataDir);
      assert.throws(() => restartedRuntime.adminLogin("123321"), /管理员密码错误/);
      assert.ok(restartedRuntime.adminLogin("new-pass-778899").token);
      assert.equal(restartedRuntime.publicAdminStatus().hasAdminPassword, true);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
