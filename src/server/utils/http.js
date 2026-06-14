async function readJsonBody(req, { maxBytes = 12_000_000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json;charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function okJson(res, data, extra = {}) {
  sendJson(res, 200, { ok: true, data, updatedAt: new Date().toISOString(), ...extra });
}

function errorJson(res, statusCode, error, extra = {}) {
  sendJson(res, statusCode, { ok: false, error: error.message || String(error), updatedAt: new Date().toISOString(), ...extra });
}

module.exports = {
  readJsonBody,
  sendJson,
  okJson,
  errorJson
};
