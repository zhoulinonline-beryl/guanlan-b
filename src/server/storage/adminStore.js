const crypto = require("crypto");
const { ADMIN_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonStore");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function cleanPassword(value = "") {
  return String(value || "").trim();
}

function isStrongEnoughPassword(password = "") {
  return cleanPassword(password).length >= 6;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), iterations = 120000) {
  const digest = crypto.pbkdf2Sync(cleanPassword(password), salt, iterations, 32, "sha256").toString("hex");
  return { algorithm: "pbkdf2-sha256", iterations, salt, digest };
}

function timingSafeEqualHex(a = "", b = "") {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  if (left.length !== right.length || !left.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readAdminStore() {
  const store = readJsonFile(ADMIN_FILE, {});
  return {
    algorithm: store.algorithm || "",
    iterations: Number(store.iterations || 0),
    salt: String(store.salt || ""),
    digest: String(store.digest || ""),
    createdAt: store.createdAt || "",
    updatedAt: store.updatedAt || ""
  };
}

function hasAdminPassword() {
  const store = readAdminStore();
  return Boolean(store.salt && store.digest && store.iterations);
}

function verifyAdminPassword(password = "") {
  const store = readAdminStore();
  if (!hasAdminPassword()) return false;
  const hashed = hashPassword(password, store.salt, store.iterations);
  return timingSafeEqualHex(hashed.digest, store.digest);
}

function writeAdminPassword(password = "") {
  const clean = cleanPassword(password);
  if (!isStrongEnoughPassword(clean)) throw new Error("管理员密码至少需要 6 位");
  const current = readAdminStore();
  const hashed = hashPassword(clean);
  const next = {
    ...hashed,
    createdAt: current.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  writeJsonFile(ADMIN_FILE, next);
  sessions.clear();
  return publicAdminStatus();
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + TOKEN_TTL_MS);
  return { token, expiresInMs: TOKEN_TTL_MS };
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) sessions.delete(token);
  }
}

function verifyAdminToken(token = "") {
  cleanupSessions();
  const expiresAt = sessions.get(String(token || ""));
  if (!expiresAt || expiresAt <= Date.now()) return false;
  sessions.set(token, Date.now() + TOKEN_TTL_MS);
  return true;
}

function adminLogin(password = "") {
  if (!verifyAdminPassword(password)) {
    const error = new Error("管理员密码错误");
    error.statusCode = 401;
    error.code = "ADMIN_PASSWORD_INVALID";
    throw error;
  }
  return createAdminSession();
}

function changeAdminPassword(oldPassword = "", newPassword = "") {
  if (hasAdminPassword() && !verifyAdminPassword(oldPassword)) {
    const error = new Error("原管理员密码错误");
    error.statusCode = 401;
    error.code = "ADMIN_PASSWORD_INVALID";
    throw error;
  }
  return writeAdminPassword(newPassword);
}

function extractAdminToken(req) {
  const header = req.headers["x-admin-token"] || req.headers.authorization || "";
  return String(header).replace(/^Bearer\s+/i, "").trim();
}

function publicAdminStatus() {
  const store = readAdminStore();
  return {
    hasAdminPassword: hasAdminPassword(),
    updatedAt: store.updatedAt || store.createdAt || ""
  };
}

module.exports = {
  TOKEN_TTL_MS,
  adminLogin,
  changeAdminPassword,
  extractAdminToken,
  hasAdminPassword,
  isStrongEnoughPassword,
  publicAdminStatus,
  verifyAdminToken,
  writeAdminPassword
};
