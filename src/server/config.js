const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "../..");

function loadLocalEnv() {
  const files = [".env.local", ".env"];
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const raw = trimmed.slice(index + 1).trim();
      const value = raw.replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 5173);
const HOST = "127.0.0.1";
const RECOMMEND_REFRESH_MS = 15 * 60 * 1000;
const EASTMONEY_UT = "b2884a393a59ad64002292a3e90d46a5";

const DATA_DIR = process.env.GUANLAN_DATA_DIR ? path.resolve(process.env.GUANLAN_DATA_DIR) : path.join(root, "data");
const HOLDINGS_FILE = process.env.GUANLAN_HOLDINGS_FILE || path.join(DATA_DIR, "holdings.json");
const SETTINGS_FILE = process.env.GUANLAN_SETTINGS_FILE || path.join(DATA_DIR, "settings.json");
const ADMIN_FILE = process.env.GUANLAN_ADMIN_FILE || path.join(DATA_DIR, "admin.json");
const CACHE_FILE = process.env.GUANLAN_CACHE_FILE || path.join(DATA_DIR, "cache.json");
const MARKET_SNAPSHOT_FILE = process.env.GUANLAN_MARKET_SNAPSHOT_FILE || path.join(DATA_DIR, "market-snapshot.json");
const TRACKING_FILE = process.env.GUANLAN_TRACKING_FILE || path.join(DATA_DIR, "tracking.json");

const AI_PROVIDERS = {
  "kimi-cn": {
    label: "Kimi 国内版 / Moonshot CN",
    apiUrl: "https://api.moonshot.cn/v1/chat/completions",
    textModel: "kimi-k2.6",
    visionModel: "kimi-k2.6",
    advisorModel: "kimi-k2.6",
    ocrMode: "chatVision",
    supportsWebSearch: true,
    supportsVision: true
  },
  "kimi-intl": {
    label: "Kimi 国际版 / Moonshot AI",
    apiUrl: "https://api.moonshot.ai/v1/chat/completions",
    textModel: "kimi-k2.6",
    visionModel: "kimi-k2.6",
    advisorModel: "kimi-k2.6",
    ocrMode: "chatVision",
    supportsWebSearch: true,
    supportsVision: true
  },
  deepseek: {
    label: "DeepSeek",
    apiUrl: "https://api.deepseek.com/chat/completions",
    textModel: "deepseek-v4-flash",
    visionModel: "deepseek-ocr",
    advisorModel: "deepseek-v4-flash",
    ocrMode: "chatVision",
    supportsWebSearch: false,
    supportsVision: true
  },
  minimax: {
    label: "MiniMax",
    apiUrl: "https://api.minimax.io/v1/chat/completions",
    textModel: "MiniMax-M3",
    visionModel: "MiniMax-VL-01",
    advisorModel: "MiniMax-M3",
    ocrMode: "chatVision",
    supportsWebSearch: false,
    supportsVision: true
  },
  glm: {
    label: "GLM / 智谱",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    textModel: "glm-5.1",
    visionModel: "glm-ocr",
    advisorModel: "glm-5.1",
    ocrMode: "glmLayout",
    ocrApiUrl: "https://api.z.ai/api/paas/v4/layout_parsing",
    supportsWebSearch: false,
    supportsVision: true
  }
};

const DEFAULT_AI_PROVIDER_ENV = process.env.AI_PROVIDER === "kimi" ? "kimi-cn" : process.env.AI_PROVIDER;
const DEFAULT_AI_PROVIDER = AI_PROVIDERS[DEFAULT_AI_PROVIDER_ENV] ? DEFAULT_AI_PROVIDER_ENV : "kimi-cn";
const DEFAULT_AI_PROVIDER_CONFIG = AI_PROVIDERS[DEFAULT_AI_PROVIDER];

const DEFAULT_SETTINGS = {
  aiProvider: DEFAULT_AI_PROVIDER,
  apiUrl: process.env.AI_API_URL || process.env.KIMI_API_URL || DEFAULT_AI_PROVIDER_CONFIG.apiUrl,
  ocrApiUrl: process.env.AI_OCR_API_URL || DEFAULT_AI_PROVIDER_CONFIG.ocrApiUrl || "",
  textModel: process.env.AI_TEXT_MODEL || process.env.KIMI_MODEL || DEFAULT_AI_PROVIDER_CONFIG.textModel,
  visionModel: process.env.AI_VISION_MODEL || process.env.KIMI_VISION_MODEL || DEFAULT_AI_PROVIDER_CONFIG.visionModel,
  advisorModel: process.env.ADVISOR_MODEL || DEFAULT_AI_PROVIDER_CONFIG.advisorModel,
  advisorRole: "你是观澜理财师，一名资深 A 股股票交易专家。你擅长从板块强弱、主力资金、K线位置、量能、消息催化和风险位综合判断交易机会。",
  advisorStyle: "风格偏激进，回答简约直接。优先给结论、买卖触发价、仓位和风险位；少讲空话。所有内容仅作交易分析辅助，不承诺收益。",
  apiKey: process.env.AI_API_KEY || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "",
  kimiApiUrl: process.env.KIMI_API_URL || AI_PROVIDERS["kimi-cn"].apiUrl,
  kimiModel: process.env.KIMI_MODEL || AI_PROVIDERS["kimi-cn"].textModel,
  kimiVisionModel: process.env.KIMI_VISION_MODEL || AI_PROVIDERS["kimi-cn"].visionModel,
  kimiApiKey: process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "",
  modelQpm: Number(process.env.MODEL_QPM || 500),
  useCache: true,
  marketDataSource: process.env.MARKET_DATA_SOURCE || "auto"
};

const CN_MARKET_CLOSED_DATES_2026 = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"
]);

const majorIndices = [
  ["sh000001", "上证指数"],
  ["sz399001", "深证成指"],
  ["sz399006", "创业板指"],
  ["sh000688", "科创50"],
  ["sh000300", "沪深300"],
  ["sh000905", "中证500"],
  ["sh000016", "上证50"],
  ["bj899050", "北证50"]
];

module.exports = {
  root,
  PORT,
  HOST,
  RECOMMEND_REFRESH_MS,
  EASTMONEY_UT,
  DATA_DIR,
  HOLDINGS_FILE,
  SETTINGS_FILE,
  ADMIN_FILE,
  CACHE_FILE,
  MARKET_SNAPSHOT_FILE,
  TRACKING_FILE,
  AI_PROVIDERS,
  DEFAULT_SETTINGS,
  CN_MARKET_CLOSED_DATES_2026,
  majorIndices
};
