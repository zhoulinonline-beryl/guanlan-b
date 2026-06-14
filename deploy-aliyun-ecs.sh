#!/usr/bin/env bash
set -Eeuo pipefail

# 观澜 - 阿里云 ECS 一键部署脚本
# 用法：
#   1. 把项目目录上传到 ECS，例如 /root/a-stock-radar
#   2. cd /root/a-stock-radar
#   3. sudo bash deploy-aliyun-ecs.sh
#
# 可选环境变量：
#   APP_NAME=a-stock-radar
#   APP_DIR=/opt/a-stock-radar
#   PORT=5173
#   DOMAIN=radar.example.com
#   KIMI_API_KEY=sk-xxx
#   KIMI_MODEL=moonshot-v1-auto

APP_NAME="${APP_NAME:-a-stock-radar}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
PORT="${PORT:-5173}"
DOMAIN="${DOMAIN:-_}"
KIMI_MODEL="${KIMI_MODEL:-moonshot-v1-auto}"
NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-18}"
SOURCE_DIR="$(pwd)"
SERVICE_USER="${SERVICE_USER:-root}"
NGINX_CONF="/etc/nginx/conf.d/${APP_NAME}.conf"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

log() {
  printf '\033[1;34m[deploy]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[deploy failed]\033[0m %s\n' "$*" >&2
  exit 1
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
  log "安装基础依赖：curl、nginx、ca-certificates"
  if [[ "$pm" == "apt" ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates gnupg nginx
  elif [[ "$pm" == "dnf" ]]; then
    dnf install -y curl ca-certificates nginx
  else
    yum install -y curl ca-certificates nginx
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
  local key="${KIMI_API_KEY:-}"
  if [[ -z "$key" ]]; then
    read -r -p "请输入 KIMI_API_KEY（可留空，留空则新闻/图片解析相关能力不可用）： " key
  fi

  log "写入环境变量：${APP_DIR}/.env.local"
  cat > "${APP_DIR}/.env.local" <<EOF
PORT=${PORT}
KIMI_API_KEY=${key}
KIMI_MODEL=${KIMI_MODEL}
NODE_ENV=production
EOF
  chmod 600 "${APP_DIR}/.env.local"
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
