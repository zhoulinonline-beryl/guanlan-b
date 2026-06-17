#!/usr/bin/env bash
set -Eeuo pipefail

# 观澜 - 阿里云 ECS 一键部署脚本
# 用法：
#   1. 把项目目录上传到 ECS，例如 /root/a-stock-radar
#   2. cd /root/a-stock-radar
#   3. sudo bash deploy-aliyun-ecs.sh
#
# 可选环境变量：
#   APP_NAME=guanlan-stock-radar
#   APP_DIR=/opt/guanlan-stock-radar
#   PORT=5173
#   DOMAIN=radar.example.com
#   AI_PROVIDER=kimi-cn|kimi-intl|deepseek|minimax|glm
#   AI_API_KEY=sk-xxx

APP_NAME="${APP_NAME:-guanlan-stock-radar}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
PORT="${PORT:-5173}"
DOMAIN="${DOMAIN:-_}"
NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-18}"
SOURCE_DIR="$(pwd)"
SERVICE_USER="${SERVICE_USER:-root}"
NGINX_CONF="/etc/nginx/conf.d/${APP_NAME}.conf"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
AI_PROVIDER_DEFAULT="${AI_PROVIDER_DEFAULT:-kimi-cn}"
KIMI_API_URL_DEFAULT="${KIMI_API_URL_DEFAULT:-https://api.moonshot.cn/v1/chat/completions}"
KIMI_INTL_API_URL_DEFAULT="${KIMI_INTL_API_URL_DEFAULT:-https://api.moonshot.ai/v1/chat/completions}"
KIMI_MODEL_DEFAULT="${KIMI_MODEL_DEFAULT:-kimi-k2.6}"
KIMI_VISION_MODEL_DEFAULT="${KIMI_VISION_MODEL_DEFAULT:-kimi-k2.6}"
ADVISOR_MODEL_DEFAULT="${ADVISOR_MODEL_DEFAULT:-kimi-k2.6}"
MARKET_DATA_SOURCE_DEFAULT="${MARKET_DATA_SOURCE_DEFAULT:-auto}"

log() {
  printf '\033[1;34m[deploy]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[deploy failed]\033[0m %s\n' "$*" >&2
  exit 1
}

warn() {
  printf '\033[1;33m[deploy]\033[0m %s\n' "$*"
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
    [[ -n "$password" ]] || fail "必须设置管理员密码，否则不能部署"
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

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "请使用 root 或 sudo 运行：sudo bash deploy-aliyun-ecs.sh"
  fi
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v yum >/dev/null 2>&1; then
    echo "yum"
  else
    fail "未找到 apt-get/dnf/yum，暂不支持当前系统"
  fi
}

install_base_packages() {
  local pm="$1"
  log "安装基础依赖：curl、rsync、nginx、ca-certificates"
  if [[ "$pm" == "apt" ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl rsync ca-certificates gnupg nginx
  elif [[ "$pm" == "dnf" ]]; then
    dnf install -y curl rsync ca-certificates nginx
  else
    yum install -y curl rsync ca-certificates nginx
  fi
}

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  node -v | sed -E 's/^v([0-9]+).*/\1/'
}

install_node() {
  local pm="$1"
  local major
  major="$(node_major)"
  if [[ "$major" -ge "$NODE_MIN_MAJOR" ]]; then
    log "Node.js 已满足要求：$(node -v)"
    return
  fi

  log "安装 Node.js 20 LTS"
  if [[ "$pm" == "apt" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  elif [[ "$pm" == "dnf" ]]; then
    dnf module reset -y nodejs || true
    dnf module enable -y nodejs:20 || true
    dnf install -y nodejs npm
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  fi

  major="$(node_major)"
  [[ "$major" -ge "$NODE_MIN_MAJOR" ]] || fail "Node.js 安装失败或版本过低，当前：$(node -v 2>/dev/null || echo none)"
}

ensure_project_files() {
  [[ -f "${SOURCE_DIR}/server.js" ]] || fail "当前目录缺少 server.js，请在项目根目录运行脚本"
  [[ -f "${SOURCE_DIR}/index.html" ]] || fail "当前目录缺少 index.html，请在项目根目录运行脚本"
  [[ -d "${SOURCE_DIR}/src" ]] || fail "当前目录缺少 src/，请在项目根目录运行脚本"
}

write_env_file() {
  local ai_provider provider_label api_key api_url ocr_api_url text_model vision_model advisor_model market_source use_cache_bool admin_password
  local kimi_api_key kimi_api_url kimi_model kimi_vision_model

  admin_password="$(ask_admin_password)"
  ai_provider="$(choose_ai_provider)"
  case "$ai_provider" in
    kimi|kimi-cn)
      ai_provider="kimi-cn"
      provider_label="Kimi 国内版"
      api_url="${AI_API_URL:-$KIMI_API_URL_DEFAULT}"
      ocr_api_url="${AI_OCR_API_URL:-}"
      text_model="${AI_TEXT_MODEL:-$KIMI_MODEL_DEFAULT}"
      vision_model="${AI_VISION_MODEL:-$KIMI_VISION_MODEL_DEFAULT}"
      advisor_model="${ADVISOR_MODEL:-$ADVISOR_MODEL_DEFAULT}"
      ;;
    kimi-intl)
      provider_label="Kimi 国际版"
      api_url="${AI_API_URL:-$KIMI_INTL_API_URL_DEFAULT}"
      ocr_api_url="${AI_OCR_API_URL:-}"
      text_model="${AI_TEXT_MODEL:-$KIMI_MODEL_DEFAULT}"
      vision_model="${AI_VISION_MODEL:-$KIMI_VISION_MODEL_DEFAULT}"
      advisor_model="${ADVISOR_MODEL:-$ADVISOR_MODEL_DEFAULT}"
      ;;
    deepseek)
      provider_label="DeepSeek"
      api_url="${AI_API_URL:-https://api.deepseek.com/chat/completions}"
      ocr_api_url="${AI_OCR_API_URL:-}"
      text_model="${AI_TEXT_MODEL:-deepseek-v4-flash}"
      vision_model="${AI_VISION_MODEL:-deepseek-ocr}"
      advisor_model="${ADVISOR_MODEL:-deepseek-v4-flash}"
      ;;
    minimax)
      provider_label="MiniMax"
      api_url="${AI_API_URL:-https://api.minimax.io/v1/chat/completions}"
      ocr_api_url="${AI_OCR_API_URL:-}"
      text_model="${AI_TEXT_MODEL:-MiniMax-M3}"
      vision_model="${AI_VISION_MODEL:-MiniMax-VL-01}"
      advisor_model="${ADVISOR_MODEL:-MiniMax-M3}"
      ;;
    glm)
      provider_label="GLM"
      api_url="${AI_API_URL:-https://open.bigmodel.cn/api/paas/v4/chat/completions}"
      ocr_api_url="${AI_OCR_API_URL:-https://api.z.ai/api/paas/v4/layout_parsing}"
      text_model="${AI_TEXT_MODEL:-glm-5.1}"
      vision_model="${AI_VISION_MODEL:-glm-ocr}"
      advisor_model="${ADVISOR_MODEL:-glm-5.1}"
      ;;
    *)
      warn "未知模型供应商 ${ai_provider}，已改为 kimi-cn"
      ai_provider="kimi-cn"
      provider_label="Kimi 国内版"
      api_url="${AI_API_URL:-$KIMI_API_URL_DEFAULT}"
      ocr_api_url="${AI_OCR_API_URL:-}"
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
  if [[ "$ai_provider" == "glm" ]]; then
    ocr_api_url="$(ask "GLM OCR API 地址" "$ocr_api_url")"
  fi
  text_model="$(ask "文本/分析模型" "$text_model")"
  vision_model="$(ask "图片 OCR 模型（无视觉模型可留空）" "$vision_model")"
  advisor_model="$(ask "观澜理财师模型" "$advisor_model")"
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
  else
    use_cache_bool="false"
  fi

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

  log "写入环境变量：${APP_DIR}/.env.local"
  cat > "${APP_DIR}/.env.local" <<EOF
PORT=${PORT}
AI_PROVIDER=${ai_provider}
AI_API_KEY=${api_key}
AI_API_URL=${api_url}
AI_OCR_API_URL=${ocr_api_url}
AI_TEXT_MODEL=${text_model}
AI_VISION_MODEL=${vision_model}
ADVISOR_MODEL=${advisor_model}
KIMI_API_KEY=${kimi_api_key}
KIMI_API_URL=${kimi_api_url}
KIMI_MODEL=${kimi_model}
KIMI_VISION_MODEL=${kimi_vision_model}
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
  write_admin_password_file "$admin_password"

  log "写入应用设置：${APP_DIR}/data/settings.json"
  cat > "${APP_DIR}/data/settings.json" <<EOF
{
  "aiProvider": "${ai_provider}",
  "apiUrl": "${api_url}",
  "ocrApiUrl": "${ocr_api_url}",
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
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}/data" "${APP_DIR}/.env.local"
}

sync_app_files() {
  log "部署应用文件到 ${APP_DIR}"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude ".git" \
    --exclude ".env" \
    --exclude ".env.local" \
    --exclude "node_modules" \
    --exclude ".DS_Store" \
    "${SOURCE_DIR}/" "${APP_DIR}/"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
}

write_systemd_service() {
  log "创建 systemd 服务：${SERVICE_FILE}"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=A Stock Radar Node Service
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env.local
ExecStart=$(command -v node) ${APP_DIR}/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${APP_NAME}"
  systemctl restart "${APP_NAME}"
}

write_nginx_conf() {
  log "配置 Nginx 反向代理：${NGINX_CONF}"
  local server_name="$DOMAIN"
  local listen_line="listen 80;"
  if [[ "$DOMAIN" == "_" || -z "$DOMAIN" ]]; then
    listen_line="listen 80 default_server;"
    server_name="_"
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  fi

  cat > "$NGINX_CONF" <<EOF
server {
    ${listen_line}
    server_name ${server_name};

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

  nginx -t
  systemctl enable nginx
  systemctl restart nginx
}

print_result() {
  local public_target
  if [[ "$DOMAIN" == "_" || -z "$DOMAIN" ]]; then
    public_target="http://服务器公网IP/"
  else
    public_target="http://${DOMAIN}/"
  fi

  log "部署完成"
  echo
  echo "应用目录：${APP_DIR}"
  echo "本地服务：http://127.0.0.1:${PORT}"
  echo "公网入口：${public_target}"
  echo
  echo "常用命令："
  echo "  systemctl status ${APP_NAME}"
  echo "  journalctl -u ${APP_NAME} -f"
  echo "  systemctl restart ${APP_NAME}"
  echo "  nginx -t && systemctl reload nginx"
  echo
  echo "阿里云安全组请确认已开放：80、443；SSH 22 建议只允许你的固定 IP。"
  echo "如使用大陆地域和域名访问，请先完成 ICP 备案。"
}

main() {
  need_root
  ensure_project_files
  local pm
  pm="$(detect_pkg_manager)"
  install_base_packages "$pm"
  install_node "$pm"
  sync_app_files
  write_env_file
  write_systemd_service
  write_nginx_conf
  print_result
}

main "$@"
