const { AI_PROVIDERS, DEFAULT_SETTINGS, SETTINGS_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonStore");
const { maskSecret } = require("../utils/security");

function normalizeAiProvider(provider = DEFAULT_SETTINGS.aiProvider) {
  const value = String(provider || DEFAULT_SETTINGS.aiProvider || "kimi").trim().toLowerCase();
  if (value === "kimi") return "kimi-cn";
  return AI_PROVIDERS[value] ? value : "kimi-cn";
}

function providerDefaults(provider = DEFAULT_SETTINGS.aiProvider) {
  return AI_PROVIDERS[normalizeAiProvider(provider)] || AI_PROVIDERS["kimi-cn"];
}

function normalizeAiApiUrl(url = "", provider = DEFAULT_SETTINGS.aiProvider) {
  return String(url || "").replace(/\s+/g, "").trim() || providerDefaults(provider).apiUrl;
}

function normalizeKimiApiUrl(url = "") {
  return normalizeAiApiUrl(url, "kimi-cn");
}

function normalizeMarketDataSource(source = "auto") {
  const value = String(source || "auto").trim();
  return ["auto", "tencent", "eastmoney", "sina"].includes(value) ? value : "auto";
}

function readAppSettings() {
  const stored = readJsonFile(SETTINGS_FILE, {});
  const provider = normalizeAiProvider(stored.aiProvider || DEFAULT_SETTINGS.aiProvider);
  const defaults = providerDefaults(provider);
  const legacyKimiSelected = provider.startsWith("kimi");
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiProvider: provider,
    apiUrl: stored.apiUrl || (legacyKimiSelected ? stored.kimiApiUrl : "") || defaults.apiUrl || DEFAULT_SETTINGS.apiUrl,
    ocrApiUrl: stored.ocrApiUrl || defaults.ocrApiUrl || DEFAULT_SETTINGS.ocrApiUrl || "",
    textModel: stored.textModel || (legacyKimiSelected ? stored.kimiModel : "") || defaults.textModel || DEFAULT_SETTINGS.textModel,
    visionModel: stored.visionModel || (legacyKimiSelected ? stored.kimiVisionModel : "") || defaults.visionModel || DEFAULT_SETTINGS.visionModel,
    apiKey: stored.apiKey || (legacyKimiSelected ? stored.kimiApiKey : "") || DEFAULT_SETTINGS.apiKey || "",
    kimiApiUrl: stored.kimiApiUrl || DEFAULT_SETTINGS.kimiApiUrl,
    kimiModel: stored.kimiModel || DEFAULT_SETTINGS.kimiModel,
    kimiVisionModel: stored.kimiVisionModel || DEFAULT_SETTINGS.kimiVisionModel,
    kimiApiKey: stored.kimiApiKey || DEFAULT_SETTINGS.kimiApiKey
  };
}

function writeAppSettings(next = {}) {
  const current = readAppSettings();
  const source = normalizeMarketDataSource(next.marketDataSource || current.marketDataSource || DEFAULT_SETTINGS.marketDataSource);
  const provider = normalizeAiProvider(next.aiProvider || current.aiProvider || DEFAULT_SETTINGS.aiProvider);
  const defaults = providerDefaults(provider);
  const keepKey = next.apiKey === "__KEEP__" || next.kimiApiKey === "__KEEP__";
  const nextApiKey = keepKey ? current.apiKey : String(next.apiKey ?? next.kimiApiKey ?? current.apiKey ?? "").trim();
  const apiUrl = normalizeAiApiUrl(next.apiUrl || next.kimiApiUrl || current.apiUrl || defaults.apiUrl, provider);
  const ocrApiUrl = String(next.ocrApiUrl || current.ocrApiUrl || defaults.ocrApiUrl || "").trim();
  const textModel = String(next.textModel || next.kimiModel || current.textModel || defaults.textModel).trim();
  const visionModel = String(next.visionModel || next.kimiVisionModel || current.visionModel || defaults.visionModel || "").trim();
  const clean = {
    aiProvider: provider,
    apiUrl,
    ocrApiUrl,
    textModel,
    visionModel,
    advisorModel: String(next.advisorModel || current.advisorModel || defaults.advisorModel || DEFAULT_SETTINGS.advisorModel).trim(),
    advisorRole: String(next.advisorRole ?? current.advisorRole ?? DEFAULT_SETTINGS.advisorRole).trim(),
    advisorStyle: String(next.advisorStyle ?? current.advisorStyle ?? DEFAULT_SETTINGS.advisorStyle).trim(),
    apiKey: nextApiKey,
    kimiApiUrl: provider.startsWith("kimi") ? apiUrl : (current.kimiApiUrl || DEFAULT_SETTINGS.kimiApiUrl),
    kimiModel: provider.startsWith("kimi") ? textModel : (current.kimiModel || DEFAULT_SETTINGS.kimiModel),
    kimiVisionModel: provider.startsWith("kimi") ? visionModel : (current.kimiVisionModel || DEFAULT_SETTINGS.kimiVisionModel),
    kimiApiKey: provider.startsWith("kimi") ? nextApiKey : (current.kimiApiKey || DEFAULT_SETTINGS.kimiApiKey || ""),
    useCache: Boolean(next.useCache),
    marketDataSource: source
  };
  writeJsonFile(SETTINGS_FILE, clean);
  return clean;
}

function publicSettings(settings = readAppSettings()) {
  const provider = normalizeAiProvider(settings.aiProvider);
  const defaults = providerDefaults(provider);
  return {
    aiProvider: provider,
    aiProviderLabel: defaults.label,
    aiProviders: Object.fromEntries(Object.entries(AI_PROVIDERS).map(([key, item]) => [key, {
      label: item.label,
      apiUrl: item.apiUrl,
      textModel: item.textModel,
      visionModel: item.visionModel,
      advisorModel: item.advisorModel,
      ocrMode: item.ocrMode,
      ocrApiUrl: item.ocrApiUrl || "",
      supportsVision: item.supportsVision,
      supportsWebSearch: item.supportsWebSearch
    }])),
    apiUrl: normalizeAiApiUrl(settings.apiUrl, provider),
    ocrApiUrl: settings.ocrApiUrl || defaults.ocrApiUrl || "",
    ocrMode: defaults.ocrMode || "chatVision",
    textModel: settings.textModel,
    visionModel: settings.visionModel,
    advisorModel: settings.advisorModel,
    advisorRole: settings.advisorRole,
    advisorStyle: settings.advisorStyle,
    useCache: settings.useCache,
    marketDataSource: normalizeMarketDataSource(settings.marketDataSource),
    hasApiKey: Boolean(settings.apiKey),
    apiKeyMasked: maskSecret(settings.apiKey),
    kimiApiUrl: normalizeKimiApiUrl(settings.kimiApiUrl),
    kimiModel: settings.kimiModel,
    kimiVisionModel: settings.kimiVisionModel,
    hasKimiApiKey: Boolean(settings.kimiApiKey || (provider.startsWith("kimi") && settings.apiKey)),
    kimiApiKeyMasked: maskSecret(settings.kimiApiKey || (provider.startsWith("kimi") ? settings.apiKey : ""))
  };
}

function marketDataSource() {
  return normalizeMarketDataSource(readAppSettings().marketDataSource);
}

module.exports = {
  AI_PROVIDERS,
  normalizeAiProvider,
  providerDefaults,
  normalizeAiApiUrl,
  normalizeKimiApiUrl,
  normalizeMarketDataSource,
  readAppSettings,
  writeAppSettings,
  publicSettings,
  marketDataSource
};
