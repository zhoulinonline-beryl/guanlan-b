#!/usr/bin/env bash
set -Eeuo pipefail

# 观澜 - macOS 本地安装脚本
# 用法：
#   chmod +x install-macos.sh
#   ./install-macos.sh

APP_NAME="${APP_NAME:-guanlan-stock-radar}"
APP_DIR="${APP_DIR:-${HOME}/Applications/${APP_NAME}}"
PORT="${PORT:-5173}"
NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-18}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_ID="${PLIST_ID:-com.guanlan.stockradar}"
PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST_ID}.plist"
LOG_DIR="${HOME}/Library/Logs/guanlan"
KIMI_API_URL_DEFAULT="${KIMI_API_URL_DEFAULT:-https://api.moonshot.cn/v1/chat/completions}"
KIMI_INTL_API_URL_DEFAULT="${KIMI_INTL_API_URL_DEFAULT:-https://api.moonshot.ai/v1/chat/completions}"
KIMI_MODEL_DEFAULT="${KIMI_MODEL_DEFAULT:-kimi-k2.5}"
KIMI_VISION_MODEL_DEFAULT="${KIMI_VISION_MODEL_DEFAULT:-kimi-k2.5}"
ADVISOR_MODEL_DEFAULT="${ADVISOR_MODEL_DEFAULT:-kimi-k2.5}"
MARKET_DATA_SOURCE_DEFAULT="${MARKET_DATA_SOURCE_DEFAULT:-auto}"
AI_PROVIDER_DEFAULT="${AI_PROVIDER_DEFAULT:-kimi-cn}"

log() {
  printf '\033[1;34m[guanlan]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[guanlan]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[install failed]\033[0m %s\n' "$*" >&2
  exit 1
}

ask() {
  local prompt="$1"
  local default_value="${2:-}"
  local answer
  if [[ -n "$default_value" ]]; then
    read -r -p "${prompt} [${default_value}]: " answer
    printf '%s' "${answer:-$default_value}"
  else
    read -r -p "${prompt}: " answer
    printf '%s' "$answer"
  fi
}

ask_secret() {
  local prompt="$1"
  local answer
  read -r -p "${prompt}: " answer
  printf '%s' "$answer"
}

ask_yes_no() {
  local prompt="$1"
  local default_value="${2:-Y}"
  local answer
  read -r -p "${prompt} (${default_value}/$( [[ "$default_value" == "Y" ]] && echo "n" || echo "y" )): " answer
  answer="${answer:-$default_value}"
  case "$answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

ask_admin_password() {
  local password confirm
  if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
    [[ "${#ADMIN_PASSWORD}" -ge 6 ]] || fail "ADMIN_PASSWORD 至少需要 6 位"
    printf '%s' "$ADMIN_PASSWORD"
    return
  fi
  while true; do
    password="$(ask_secret "请设置管理员密码（保护我的持股历史数据，至少 6 位；明文显示）")"
    [[ -n "$password" ]] || fail "必须设置管理员密码，否则不能安装"
    [[ "${#password}" -ge 6 ]] || { warn "管理员密码至少需要 6 位"; continue; }
    confirm="$(ask_secret "请再次输入管理员密码")"
    [[ "$password" == "$confirm" ]] || { warn "两次输入不一致，请重新设置"; continue; }
    printf '%s' "$password"
    return
  done
}

write_admin_password_file() {
  local admin_password="$1"
  log "写入管理员密码哈希：${APP_DIR}/data/admin.json"
  ADMIN_PASSWORD_VALUE="$admin_password" ADMIN_FILE_PATH="${APP_DIR}/data/admin.json" node <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const password = String(process.env.ADMIN_PASSWORD_VALUE || "").trim();
if (password.length < 6) {
  console.error("管理员密码至少需要 6 位");
  process.exit(1);
}
const salt = crypto.randomBytes(16).toString("hex");
const iterations = 120000;
const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
const file = process.env.ADMIN_FILE_PATH;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify({
  algorithm: "pbkdf2-sha256",
  iterations,
  salt,
  digest,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}, null, 2)}\n`);
NODE
  chmod 600 "${APP_DIR}/data/admin.json"
}

choose_ai_provider() {
  local preset="${AI_PROVIDER:-$AI_PROVIDER_DEFAULT}"
  local default_choice="1"
  case "$preset" in
    kimi|kimi-cn) default_choice="1" ;;
    kimi-intl) default_choice="2" ;;
    deepseek) default_choice="3" ;;
    minimax) default_choice="4" ;;
    glm) default_choice="5" ;;
  esac

  echo "请选择模型供应商：" >&2
  echo "  1) Kimi 国内版（默认：https://api.moonshot.cn）" >&2
  echo "  2) Kimi 国际版（默认：https://api.moonshot.ai）" >&2
  echo "  3) DeepSeek" >&2
  echo "  4) MiniMax" >&2
  echo "  5) GLM / 智谱" >&2
  local choice
  while true; do
    read -r -p "请输入编号 [${default_choice}]: " choice
    choice="${choice:-$default_choice}"
    case "$choice" in
      1) printf '%s' "kimi-cn"; return ;;
      2) printf '%s' "kimi-intl"; return ;;
      3) printf '%s' "deepseek"; return ;;
      4) printf '%s' "minimax"; return ;;
      5) printf '%s' "glm"; return ;;
      *) warn "请输入 1-5 的编号，避免选错模型供应商。" ;;
    esac
  done
}

ensure_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "当前脚本仅支持 macOS"
}

ensure_project_files() {
  [[ -f "${SOURCE_DIR}/server.js" ]] || fail "当前目录缺少 server.js，请在项目根目录运行"
  [[ -f "${SOURCE_DIR}/index.html" ]] || fail "当前目录缺少 index.html，请在项目根目录运行"
  [[ -d "${SOURCE_DIR}/src" ]] || fail "当前目录缺少 src/，请在项目根目录运行"
}

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  node -v | sed -E 's/^v([0-9]+).*/\1/'
}

install_node_if_needed() {
  local major
  major="$(node_major)"
  if [[ "$major" -ge "$NODE_MIN_MAJOR" ]]; then
    log "Node.js 已满足要求：$(node -v)"
    return
  fi

  warn "未检测到 Node.js ${NODE_MIN_MAJOR}+。"
  if command -v brew >/dev/null 2>&1; then
    if ask_yes_no "是否使用 Homebrew 安装 Node.js 20 LTS" "Y"; then
      brew install node@20 || brew install node
    else
      fail "请先安装 Node.js ${NODE_MIN_MAJOR}+ 后重新运行脚本"
    fi
  else
    fail "未检测到 Homebrew。请先安装 Node.js ${NODE_MIN_MAJOR}+，或安装 Homebrew 后重试：https://brew.sh"
  fi

  major="$(node_major)"
  [[ "$major" -ge "$NODE_MIN_MAJOR" ]] || fail "Node.js 安装后仍不可用，请检查 PATH"
}

sync_app_files() {
  local target
  target="$(ask "安装目录" "$APP_DIR")"
  APP_DIR="${target/#\~/$HOME}"
  log "安装应用文件到 ${APP_DIR}"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude ".git" \
    --exclude ".env" \
    --exclude ".env.local" \
    --exclude "node_modules" \
    --exclude "data" \
    --exclude ".DS_Store" \
    "${SOURCE_DIR}/" "${APP_DIR}/"
}

write_env_and_settings() {
  local ai_provider provider_label api_key api_url text_model vision_model advisor_model market_source use_cache_bool use_cache_text admin_password
  local kimi_api_key kimi_api_url kimi_model kimi_vision_model
  local force_reconfigure="${FORCE_RECONFIGURE:-0}"

  mkdir -p "${APP_DIR}/data"
  if [[ ! -f "${APP_DIR}/data/holdings.json" ]]; then
    printf '{\n  "holdings": [],\n  "updatedAt": ""\n}\n' > "${APP_DIR}/data/holdings.json"
  fi
  if [[ ! -f "${APP_DIR}/data/cache.json" ]]; then
    printf '{\n  "items": []\n}\n' > "${APP_DIR}/data/cache.json"
  fi

  if [[ -f "${APP_DIR}/data/settings.json" && "$force_reconfigure" != "1" ]]; then
    log "检测到已有持久化设置：${APP_DIR}/data/settings.json，重新安装默认保留。"
    warn "如需重新写入模型、AK、缓存策略和管理员密码，请执行：FORCE_RECONFIGURE=1 ./install-macos.sh"
    if [[ ! -f "${APP_DIR}/.env.local" ]]; then
      log "未检测到 .env.local，写入最小运行环境：${APP_DIR}/.env.local"
      cat > "${APP_DIR}/.env.local" <<EOF
PORT=${PORT}
NODE_ENV=production
EOF
      chmod 600 "${APP_DIR}/.env.local"
    else
      log "保留已有环境变量：${APP_DIR}/.env.local"
    fi
    if [[ -f "${APP_DIR}/data/admin.json" ]]; then
      log "保留已有管理员密码哈希：${APP_DIR}/data/admin.json"
    else
      admin_password="$(ask_admin_password)"
      write_admin_password_file "$admin_password"
    fi
    log "持久化数据已保留：settings、admin、holdings、cache、tracking、market-snapshot 等 data/ 内容不会被覆盖。"
    return
  fi

  admin_password="$(ask_admin_password)"
  ai_provider="$(choose_ai_provider)"
  case "$ai_provider" in
    kimi|kimi-cn)
      ai_provider="kimi-cn"
      provider_label="Kimi 国内版"
      api_url="${AI_API_URL:-$KIMI_API_URL_DEFAULT}"
      text_model="${AI_TEXT_MODEL:-$KIMI_MODEL_DEFAULT}"
      vision_model="${AI_VISION_MODEL:-$KIMI_VISION_MODEL_DEFAULT}"
      advisor_model="${ADVISOR_MODEL:-$ADVISOR_MODEL_DEFAULT}"
      ;;
    kimi-intl)
      provider_label="Kimi 国际版"
      api_url="${AI_API_URL:-$KIMI_INTL_API_URL_DEFAULT}"
      text_model="${AI_TEXT_MODEL:-$KIMI_MODEL_DEFAULT}"
      vision_model="${AI_VISION_MODEL:-$KIMI_VISION_MODEL_DEFAULT}"
      advisor_model="${ADVISOR_MODEL:-$ADVISOR_MODEL_DEFAULT}"
      ;;
    deepseek)
      provider_label="DeepSeek"
      api_url="${AI_API_URL:-https://api.deepseek.com/chat/completions}"
      text_model="${AI_TEXT_MODEL:-deepseek-v4-flash}"
      vision_model="${AI_VISION_MODEL:-deepseek-ocr}"
      advisor_model="${ADVISOR_MODEL:-deepseek-v4-flash}"
      ;;
    minimax)
      provider_label="MiniMax"
      api_url="${AI_API_URL:-https://api.minimax.io/v1/chat/completions}"
      text_model="${AI_TEXT_MODEL:-MiniMax-M3}"
      vision_model="${AI_VISION_MODEL:-}"
      advisor_model="${ADVISOR_MODEL:-MiniMax-M3}"
      ;;
    glm)
      provider_label="GLM"
      api_url="${AI_API_URL:-https://open.bigmodel.cn/api/paas/v4/chat/completions}"
      text_model="${AI_TEXT_MODEL:-glm-5.1}"
      vision_model="${AI_VISION_MODEL:-glm-ocr}"
      advisor_model="${ADVISOR_MODEL:-glm-5.1}"
      ;;
    *)
      warn "未知模型供应商 ${ai_provider}，已改为 kimi-cn"
      ai_provider="kimi-cn"
      provider_label="Kimi 国内版"
      api_url="${AI_API_URL:-$KIMI_API_URL_DEFAULT}"
      text_model="${AI_TEXT_MODEL:-$KIMI_MODEL_DEFAULT}"
      vision_model="${AI_VISION_MODEL:-$KIMI_VISION_MODEL_DEFAULT}"
      advisor_model="${ADVISOR_MODEL:-$ADVISOR_MODEL_DEFAULT}"
      ;;
  esac

  log "已选择模型供应商：${provider_label}（${ai_provider}）"

  api_key="${AI_API_KEY:-${KIMI_API_KEY:-}}"
  if [[ -z "$api_key" ]]; then
    api_key="$(ask_secret "请输入 ${provider_label} AK（明文显示，便于确认粘贴完整；可留空）")"
  fi
  api_url="$(ask "${provider_label} API 地址" "$api_url")"
  text_model="$(ask "文本/分析模型" "$text_model")"
  vision_model="$(ask "图片 OCR 模型（无视觉模型可留空）" "$vision_model")"
  advisor_model="$(ask "观澜理财师模型" "$advisor_model")"
  if [[ "$ai_provider" == kimi-* ]]; then
    kimi_api_key="$api_key"
    kimi_api_url="$api_url"
    kimi_model="$text_model"
    kimi_vision_model="$vision_model"
  else
    kimi_api_key=""
    kimi_api_url="$KIMI_API_URL_DEFAULT"
    kimi_model="$KIMI_MODEL_DEFAULT"
    kimi_vision_model="$KIMI_VISION_MODEL_DEFAULT"
  fi
  market_source="$(ask "行情数据源 auto/tencent/eastmoney/sina" "${MARKET_DATA_SOURCE:-$MARKET_DATA_SOURCE_DEFAULT}")"
  case "$market_source" in
    auto|tencent|eastmoney|sina) ;;
    *)
      warn "未知行情源 ${market_source}，已改为 auto"
      market_source="auto"
      ;;
  esac

  if ask_yes_no "是否启用缓存策略（缓存历史行情、新闻政策和模型结果，降低等待和调用成本）" "Y"; then
    use_cache_bool="true"
    use_cache_text="true"
  else
    use_cache_bool="false"
    use_cache_text="false"
  fi

  log "写入 ${APP_DIR}/.env.local"
cat > "${APP_DIR}/.env.local" <<EOF
PORT=${PORT}
AI_PROVIDER=${ai_provider}
AI_API_KEY=${api_key}
AI_API_URL=${api_url}
AI_OCR_API_URL=${AI_OCR_API_URL:-}
AI_TEXT_MODEL=${text_model}
AI_VISION_MODEL=${vision_model}
KIMI_API_KEY=${kimi_api_key}
KIMI_API_URL=${kimi_api_url}
KIMI_MODEL=${kimi_model}
KIMI_VISION_MODEL=${kimi_vision_model}
ADVISOR_MODEL=${advisor_model}
NODE_ENV=production
EOF
  chmod 600 "${APP_DIR}/.env.local"

  if [[ -f "${APP_DIR}/data/admin.json" && "$force_reconfigure" != "1" ]]; then
    log "保留已有管理员密码哈希：${APP_DIR}/data/admin.json"
  else
    write_admin_password_file "$admin_password"
  fi

  log "写入 ${APP_DIR}/data/settings.json"
  cat > "${APP_DIR}/data/settings.json" <<EOF
{
  "aiProvider": "${ai_provider}",
  "apiUrl": "${api_url}",
  "ocrApiUrl": "${AI_OCR_API_URL:-}",
  "textModel": "${text_model}",
  "visionModel": "${vision_model}",
  "advisorModel": "${advisor_model}",
  "advisorRole": "你是观澜理财师，一名资深 A 股股票交易专家。你擅长从板块强弱、主力资金、K线位置、量能、消息催化和风险位综合判断交易机会。",
  "advisorStyle": "风格偏激进，回答简约直接。优先给结论、买卖触发价、仓位和风险位；少讲空话。所有内容仅作交易分析辅助，不承诺收益。",
  "apiKey": "${api_key}",
  "kimiApiUrl": "${kimi_api_url}",
  "kimiModel": "${kimi_model}",
  "kimiVisionModel": "${kimi_vision_model}",
  "kimiApiKey": "${kimi_api_key}",
  "useCache": ${use_cache_bool},
  "marketDataSource": "${market_source}"
}
EOF
  chmod 600 "${APP_DIR}/data/settings.json"

  log "缓存策略：${use_cache_text}"
}

write_launch_agent() {
  mkdir -p "${HOME}/Library/LaunchAgents" "$LOG_DIR"
  local node_path
  node_path="$(command -v node)"
  log "创建 LaunchAgent：${PLIST_FILE}"
  cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_path}</string>
    <string>${APP_DIR}/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/guanlan.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/guanlan.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
EOF

  launchctl unload "$PLIST_FILE" >/dev/null 2>&1 || true
  launchctl load "$PLIST_FILE"
}

print_result() {
  echo
  log "安装完成"
  echo "应用目录：${APP_DIR}"
  echo "访问地址：http://127.0.0.1:${PORT}"
  echo
  echo "常用命令："
  echo "  cd \"${APP_DIR}\" && node server.js"
  echo "  launchctl load \"${PLIST_FILE}\""
  echo "  launchctl unload \"${PLIST_FILE}\""
  echo "  tail -f \"${LOG_DIR}/guanlan.out.log\""
  echo "  tail -f \"${LOG_DIR}/guanlan.err.log\""
  echo
}

main() {
  ensure_macos
  ensure_project_files
  install_node_if_needed
  sync_app_files
  write_env_and_settings
  if ask_yes_no "是否创建 macOS 开机自启服务 LaunchAgent" "Y"; then
    write_launch_agent
  else
    warn "未创建自启服务。可手动运行：cd \"${APP_DIR}\" && node server.js"
  fi
  print_result
}

main "$@"
