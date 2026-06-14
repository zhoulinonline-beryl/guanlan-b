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
KIMI_API_URL_DEFAULT="${KIMI_API_URL_DEFAULT:-https://api.moonshot.ai/v1/chat/completions}"
KIMI_MODEL_DEFAULT="${KIMI_MODEL_DEFAULT:-moonshot-v1-auto}"
KIMI_VISION_MODEL_DEFAULT="${KIMI_VISION_MODEL_DEFAULT:-moonshot-v1-8k-vision-preview}"
ADVISOR_MODEL_DEFAULT="${ADVISOR_MODEL_DEFAULT:-kimi-k2.5}"
MARKET_DATA_SOURCE_DEFAULT="${MARKET_DATA_SOURCE_DEFAULT:-auto}"

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
  read -r -s -p "${prompt}: " answer
  printf '\n' >&2
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
    --exclude ".DS_Store" \
    "${SOURCE_DIR}/" "${APP_DIR}/"
}

write_env_and_settings() {
  local api_key api_url kimi_model vision_model advisor_model market_source use_cache_bool use_cache_text
  api_key="${KIMI_API_KEY:-}"
  if [[ -z "$api_key" ]]; then
    api_key="$(ask_secret "请输入 Kimi AK（可留空，留空后个股讨论/新闻/OCR 能力会受限）")"
  fi
  api_url="$(ask "Kimi API 地址" "${KIMI_API_URL:-$KIMI_API_URL_DEFAULT}")"
  kimi_model="$(ask "文本/联网分析模型" "${KIMI_MODEL:-$KIMI_MODEL_DEFAULT}")"
  vision_model="$(ask "图片 OCR 模型" "${KIMI_VISION_MODEL:-$KIMI_VISION_MODEL_DEFAULT}")"
  advisor_model="$(ask "观澜理财师模型" "${ADVISOR_MODEL:-$ADVISOR_MODEL_DEFAULT}")"
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
KIMI_API_KEY=${api_key}
KIMI_API_URL=${api_url}
KIMI_MODEL=${kimi_model}
KIMI_VISION_MODEL=${vision_model}
ADVISOR_MODEL=${advisor_model}
NODE_ENV=production
EOF
  chmod 600 "${APP_DIR}/.env.local"

  mkdir -p "${APP_DIR}/data"
  if [[ ! -f "${APP_DIR}/data/holdings.json" ]]; then
    printf '{\n  "holdings": [],\n  "updatedAt": ""\n}\n' > "${APP_DIR}/data/holdings.json"
  fi
  if [[ ! -f "${APP_DIR}/data/cache.json" ]]; then
    printf '{\n  "items": []\n}\n' > "${APP_DIR}/data/cache.json"
  fi

  log "写入 ${APP_DIR}/data/settings.json"
  cat > "${APP_DIR}/data/settings.json" <<EOF
{
  "aiProvider": "kimi",
  "kimiApiUrl": "${api_url}",
  "kimiModel": "${kimi_model}",
  "kimiVisionModel": "${vision_model}",
  "advisorModel": "${advisor_model}",
  "advisorRole": "你是观澜理财师，一名资深 A 股股票交易专家。你擅长从板块强弱、主力资金、K线位置、量能、消息催化和风险位综合判断交易机会。",
  "advisorStyle": "风格偏激进，回答简约直接。优先给结论、买卖触发价、仓位和风险位；少讲空话。所有内容仅作交易分析辅助，不承诺收益。",
  "kimiApiKey": "${api_key}",
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
