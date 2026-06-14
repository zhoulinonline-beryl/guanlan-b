function maskSecret(value = "") {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 10) return "********";
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function redactLogText(value = "") {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .slice(0, 2000);
}

module.exports = {
  maskSecret,
  redactLogText
};
