const { DEFAULT_SETTINGS } = require("../config");
const { cacheGet, cacheSet } = require("../storage/cacheStore");
const { normalizeAiApiUrl, normalizeKimiApiUrl, normalizeModelQpm, providerDefaults, readAppSettings } = require("../storage/settingsStore");

function aiConfig() {
  const settings = readAppSettings();
  const provider = settings.aiProvider || DEFAULT_SETTINGS.aiProvider;
  const defaults = providerDefaults(provider);
  const isKimi = provider.startsWith("kimi");
  const apiKey = settings.apiKey || (isKimi ? settings.kimiApiKey : "") || DEFAULT_SETTINGS.apiKey;
  return {
    provider,
    providerLabel: defaults.label,
    apiKey,
    model: settings.textModel || defaults.textModel,
    visionModel: settings.visionModel || defaults.visionModel,
    advisorModel: settings.advisorModel || DEFAULT_SETTINGS.advisorModel,
    advisorRole: settings.advisorRole || DEFAULT_SETTINGS.advisorRole,
    advisorStyle: settings.advisorStyle || DEFAULT_SETTINGS.advisorStyle,
    apiUrl: normalizeAiApiUrl(settings.apiUrl, provider),
    ocrApiUrl: settings.ocrApiUrl || defaults.ocrApiUrl || "",
    ocrMode: defaults.ocrMode || "chatVision",
    supportsWebSearch: Boolean(defaults.supportsWebSearch),
    supportsVision: Boolean(defaults.supportsVision),
    modelQpm: normalizeModelQpm(settings.modelQpm),
    useCache: settings.useCache
  };
}

function hasAiKey() {
  return Boolean(aiConfig().apiKey);
}

function kimiChatOptions(model, base = {}, provider = aiConfig().provider, options = {}) {
  const text = String(model || "");
  const result = { ...base };
  if (provider.startsWith("kimi") && /^kimi-k2\.7-code/i.test(text)) {
    return result;
  }
  if (provider.startsWith("kimi") && /^kimi-k2\.[56]/i.test(text)) {
    return options.deepThinking
      ? { ...result, thinking: { type: "enabled" } }
      : { ...result, thinking: { type: "disabled" } };
  }
  if (options.deepThinking && /reasoner|reasoning|r1/i.test(text)) {
    return {
      ...result,
      temperature: 0.25
    };
  }
  return {
    temperature: 0.35,
    ...result
  };
}

function aiFallbackUrls(primaryUrl, provider = aiConfig().provider) {
  const urls = [normalizeAiApiUrl(primaryUrl, provider)];
  const extras = provider.startsWith("kimi")
    ? ["https://api.moonshot.cn/v1/chat/completions", "https://api.moonshot.ai/v1/chat/completions"]
    : [];
  for (const item of extras) {
    if (!urls.includes(item)) urls.push(item);
  }
  return urls;
}

function kimiFallbackUrls(primaryUrl) {
  return aiFallbackUrls(primaryUrl, "kimi-cn");
}

const modelCallQueue = [];
let modelCallRunning = false;
let nextModelCallAt = 0;

function modelCallIntervalMs(qpm = DEFAULT_SETTINGS.modelQpm || 500) {
  const safeQpm = Math.max(1, Math.min(1000, Number(qpm) || 500));
  return Math.ceil(60_000 / safeQpm);
}

function scheduleModelQueue() {
  if (modelCallRunning || !modelCallQueue.length) return;
  const waitMs = Math.max(0, nextModelCallAt - Date.now());
  setTimeout(runNextModelCall, waitMs);
}

async function runNextModelCall() {
  if (modelCallRunning || !modelCallQueue.length) return;
  const item = modelCallQueue.shift();
  modelCallRunning = true;
  nextModelCallAt = Date.now() + modelCallIntervalMs(item.qpm);
  try {
    item.resolve(await item.fn());
  } catch (error) {
    item.reject(error);
  } finally {
    modelCallRunning = false;
    scheduleModelQueue();
  }
}

function enqueueModelCall(providerConfig, fn) {
  return new Promise((resolve, reject) => {
    modelCallQueue.push({
      qpm: providerConfig?.modelQpm || DEFAULT_SETTINGS.modelQpm || 500,
      fn,
      resolve,
      reject
    });
    scheduleModelQueue();
  });
}

async function fetchWithModelLimit(providerConfig, url, options) {
  return enqueueModelCall(providerConfig, () => fetch(url, options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithModelRetry(providerConfig, url, options, retries = 2) {
  let response;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    response = await fetchWithModelLimit(providerConfig, url, options);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) return response;
    await sleep(800 * (attempt + 1));
  }
  return response;
}

async function chatCompletion({ model, messages, temperature, maxTokens, tools, providerConfig = aiConfig(), extra = {} }) {
  const body = {
    model,
    messages,
    ...extra
  };
  if (Number.isFinite(Number(temperature))) body.temperature = Number(temperature);
  if (!("temperature" in body) && Number.isFinite(Number(extra.temperature))) body.temperature = Number(extra.temperature);
  if (maxTokens) body.max_tokens = maxTokens;
  if (tools?.length) body.tools = tools;
  const res = await fetchWithModelRetry(providerConfig, providerConfig.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let detail = "";
    try {
      const raw = await res.text();
      const json = JSON.parse(raw);
      detail = json?.error?.message || json?.message || raw;
    } catch {
      detail = "";
    }
    throw new Error(`${providerConfig.providerLabel || providerConfig.provider} HTTP ${res.status}${detail ? `：${String(detail).slice(0, 160)}` : ""}`);
  }
  return res.json();
}

async function glmLayoutOcr({ imageData, providerConfig }) {
  const url = providerConfig.ocrApiUrl || providerDefaults(providerConfig.provider).ocrApiUrl;
  if (!url) throw new Error("GLM OCR API 地址未配置");
  const res = await fetchWithModelRetry(providerConfig, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`
    },
    body: JSON.stringify({
      model: providerConfig.visionModel || "glm-ocr",
      file: imageData
    })
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = json?.msg || json?.message || json?.error?.message || raw;
    throw new Error(`GLM OCR HTTP ${res.status}${detail ? `：${String(detail).slice(0, 160)}` : ""}`);
  }
  const text = [
    json?.data?.content,
    json?.data?.markdown,
    json?.data?.text,
    json?.result?.content,
    json?.result?.markdown,
    json?.result?.text,
    json?.content,
    json?.markdown,
    json?.text,
    raw
  ].find((item) => typeof item === "string" && item.trim());
  if (!text) throw new Error("GLM OCR 未返回可解析文本");
  return text;
}

function parseLooseJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function kimiWebSearchJson({ prompt, cacheKey, ttl = 10 * 60 * 1000 }) {
  const config = aiConfig();
  if (!config.apiKey) throw new Error(`未配置 ${config.providerLabel} AK`);
  if (!config.supportsWebSearch) throw new Error(`${config.providerLabel} 暂未接入联网搜索工具`);
  const effectiveCacheKey = cacheKey ? `${config.provider}-web:${config.model}:${cacheKey}` : "";
  const cached = effectiveCacheKey ? cacheGet(effectiveCacheKey, ttl) : null;
  if (cached) return cached;
  const messages = [
    {
      role: "system",
      content: [
        "你是 A 股新闻政策分析助手。",
        "必须使用联网搜索获取最新信息。",
        "只输出严格 JSON，不要 Markdown，不要解释 JSON 以外的内容。",
        "所有建议都必须是辅助性交易分析，不构成投资承诺。"
      ].join("")
    },
    { role: "user", content: prompt }
  ];
  const tools = [{ type: "builtin_function", function: { name: "$web_search" } }];
  let lastJson = null;
  for (let i = 0; i < 3; i += 1) {
    const json = await chatCompletion({
      model: config.model,
      messages,
      tools,
      temperature: 0.2,
      providerConfig: config,
      extra: config.provider.startsWith("kimi") ? { thinking: { type: "disabled" } } : {}
    });
    const choice = json.choices?.[0]?.message;
    if (!choice) throw new Error(`${config.providerLabel} 返回为空`);
    if (choice.tool_calls?.length) {
      messages.push(choice);
      for (const toolCall of choice.tool_calls) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function?.name || "$web_search",
          content: toolCall.function?.arguments || "{}"
        });
      }
      continue;
    }
    lastJson = parseLooseJson(choice.content || "");
    break;
  }
  if (!lastJson) throw new Error(`${config.providerLabel} 未返回结构化 JSON`);
  return effectiveCacheKey ? cacheSet(effectiveCacheKey, lastJson) : lastJson;
}

async function kimiJson({ system, prompt, cacheKey = "", ttl = 10 * 60 * 1000 }) {
  const config = aiConfig();
  if (!config.apiKey) throw new Error(`未配置 ${config.providerLabel} AK`);
  const effectiveCacheKey = cacheKey ? `${config.provider}-json:${config.model}:${cacheKey}` : "";
  if (effectiveCacheKey) {
    const cached = cacheGet(effectiveCacheKey, ttl);
    if (cached) return cached;
  }
  const json = await chatCompletion({
    model: config.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    temperature: 0.1,
    providerConfig: config,
    extra: config.provider.startsWith("kimi") ? { thinking: { type: "disabled" } } : {}
  });
  const content = json.choices?.[0]?.message?.content || "";
  const parsed = parseLooseJson(content);
  if (!parsed) throw new Error(`${config.providerLabel} 未返回结构化 JSON`);
  return effectiveCacheKey ? cacheSet(effectiveCacheKey, parsed) : parsed;
}

async function kimiVisionJson({ system, imageData, prompt, cacheKey = "", ttl = 60 * 60 * 1000 }) {
  const config = aiConfig();
  if (!config.apiKey) throw new Error(`未配置 ${config.providerLabel} AK`);
  if (!config.supportsVision || !config.visionModel) throw new Error(`${config.providerLabel} 暂未配置视觉模型`);
  if (!imageData) throw new Error("缺少持股图片");
  const effectiveCacheKey = cacheKey ? `${config.provider}-vision:${config.visionModel}:${cacheKey}` : "";
  if (effectiveCacheKey) {
    const cached = cacheGet(effectiveCacheKey, ttl);
    if (cached) return cached;
  }
  if (config.ocrMode === "glmLayout") {
    const ocrText = await glmLayoutOcr({ imageData, providerConfig: config });
    const parsed = await kimiJson({
      system,
      prompt: `${prompt}\n\n以下是 OCR 模型识别出的文本/Markdown，请基于这些内容提取结构化 JSON：\n${ocrText.slice(0, 8000)}`,
      cacheKey: cacheKey ? `${cacheKey}:structured` : "",
      ttl
    });
    return effectiveCacheKey ? cacheSet(effectiveCacheKey, parsed) : parsed;
  }
  const json = await chatCompletion({
    model: config.visionModel,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageData } }
        ]
      }
    ],
    temperature: 0.1,
    providerConfig: config,
    extra: config.provider.startsWith("kimi") ? kimiChatOptions(config.visionModel, {}, config.provider) : {}
  });
  const content = json.choices?.[0]?.message?.content || "";
  const parsed = parseLooseJson(content);
  if (!parsed) throw new Error(`${config.providerLabel} OCR 未返回结构化 JSON`);
  return effectiveCacheKey ? cacheSet(effectiveCacheKey, parsed) : parsed;
}

module.exports = {
  aiConfig,
  hasAiKey,
  aiFallbackUrls,
  chatCompletion,
  kimiChatOptions,
  kimiFallbackUrls,
  parseLooseJson,
  kimiWebSearchJson,
  kimiJson,
  kimiVisionJson
};
