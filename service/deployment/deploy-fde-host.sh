#!/usr/bin/env bash
set -euo pipefail

FDE_ROOT="${FDE_ROOT:-/opt/fde}"
FDE_ENV="${FDE_ENV:-$FDE_ROOT/app/.env}"
CORE_ROOT="${CORE_ROOT:-/opt/enterprise-ai-landing-guide}"
CORE_IMAGE="${CORE_IMAGE:-enterprise-ai-landing-guide:1.0.0-p1}"
FDE_IMAGE="${FDE_IMAGE:-lantuzhigou-fde-server:9b3c92d-external-landing-p1}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://101.37.87.144}"
FDE_ENTERPRISE_ID="${FDE_ENTERPRISE_ID:-22222222-2222-2222-2222-222222222222}"
FDE_OWNER_USER_ID="${FDE_OWNER_USER_ID:-lantoo-admin}"
FDE_NETWORK_NAME="${FDE_NETWORK_NAME:-fde_fde-internal}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This deployment script must run as root." >&2
  exit 1
fi
for command in docker openssl awk grep; do
  command -v "$command" >/dev/null
done
test -s "$FDE_ENV"
docker image inspect "$CORE_IMAGE" >/dev/null
docker image inspect "$FDE_IMAGE" >/dev/null
docker network inspect "$FDE_NETWORK_NAME" >/dev/null

env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$FDE_ENV"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temporary="${file}.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$temporary"
  chmod --reference="$file" "$temporary"
  chown --reference="$file" "$temporary"
  mv "$temporary" "$file"
}

deepseek_key="$(env_value DEEPSEEK_API_KEY)"
test -n "$deepseek_key"
fde_key="$(env_value EXTERNAL_LANDING_FDE_API_KEY)"
stats_key="$(env_value EXTERNAL_LANDING_STATS_API_KEY)"
if [ -z "$fde_key" ]; then fde_key="$(openssl rand -base64 48 | tr -d '\n')"; fi
if [ -z "$stats_key" ]; then stats_key="$(openssl rand -hex 48)"; fi
data_key="$(openssl rand -base64 32 | tr -d '\n')"

stamp="$(date +%Y%m%d-%H%M%S)"
backup_root="$FDE_ROOT/backups/external-landing-$stamp"
mkdir -p "$backup_root" "$CORE_ROOT"
chmod 700 "$backup_root" "$CORE_ROOT"
cp "$FDE_ENV" "$backup_root/fde.env.before"
cp "$FDE_ROOT/docker-compose.yml" "$backup_root/docker-compose.yml.before"
if [ -f /etc/nginx/conf.d/enterprise-ai-landing-guide-ip.conf ]; then
  cp /etc/nginx/conf.d/enterprise-ai-landing-guide-ip.conf "$backup_root/nginx-ip.conf.before"
fi
docker exec fde-postgres-1 sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$backup_root/database.dump"
test -s "$backup_root/database.dump"

set_env_value "$FDE_ENV" SERVER_IMAGE "$FDE_IMAGE"
set_env_value "$FDE_ENV" EXTERNAL_LANDING_FDE_API_KEY "$fde_key"
set_env_value "$FDE_ENV" EXTERNAL_LANDING_ALLOWED_TENANT_IDS "$FDE_ENTERPRISE_ID"
set_env_value "$FDE_ENV" EXTERNAL_LANDING_OWNER_USER_ID "$FDE_OWNER_USER_ID"
set_env_value "$FDE_ENV" EXTERNAL_LANDING_CORE_API_BASE "http://enterprise-ai-landing-guide:3020"
set_env_value "$FDE_ENV" EXTERNAL_LANDING_STATS_API_KEY "$stats_key"

umask 077
printf '%s\n' \
  'COMPOSE_PROJECT_NAME=enterprise-ai-landing-guide' \
  'NODE_ENV=production' \
  'HOST=0.0.0.0' \
  'PORT=3020' \
  "EXTERNAL_PUBLIC_BASE_URL=$PUBLIC_BASE_URL" \
  'EXTERNAL_DATABASE_PATH=.runtime/enterprise-ai-landing-guide.sqlite' \
  'EXTERNAL_UPLOAD_DIR=.runtime/uploads' \
  'EXTERNAL_SKILL_RETENTION_DAYS=30' \
  'EXTERNAL_SESSION_TTL_MINUTES=120' \
  'EXTERNAL_MAX_UPLOAD_MB=10' \
  'EXTERNAL_RATE_LIMIT_PER_MINUTE=60' \
  'FDE_API_BASE=http://server:3000/api' \
  "FDE_ENTERPRISE_ID=$FDE_ENTERPRISE_ID" \
  "EXTERNAL_LANDING_FDE_API_KEY=$fde_key" \
  "EXTERNAL_DATA_ENCRYPTION_KEY=$data_key" \
  "EXTERNAL_STATS_API_KEY=$stats_key" \
  'DEFAULT_AI_MODEL=deepseek-chat' \
  'DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions' \
  "DEEPSEEK_API_KEY=$deepseek_key" \
  'LLM_TIMEOUT_MS=90000' > "$CORE_ROOT/.env"

cat > "$CORE_ROOT/compose.yaml" <<EOF
services:
  enterprise-ai-landing-guide:
    image: $CORE_IMAGE
    container_name: enterprise-ai-landing-guide
    restart: unless-stopped
    init: true
    env_file:
      - .env
    ports:
      - "127.0.0.1:3020:3020"
    volumes:
      - enterprise-ai-landing-guide-data:/app/.runtime
    networks:
      - fde-internal
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 256m
    pids_limit: 128
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3020/api/public/clawhive/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

volumes:
  enterprise-ai-landing-guide-data:

networks:
  fde-internal:
    external: true
    name: $FDE_NETWORK_NAME
EOF
chmod 600 "$CORE_ROOT/.env"
chmod 640 "$CORE_ROOT/compose.yaml"

docker run --rm --network "$FDE_NETWORK_NAME" --env-file "$FDE_ENV" "$FDE_IMAGE" npx prisma migrate deploy

(
  cd "$FDE_ROOT"
  docker compose --env-file "$FDE_ENV" up -d --no-deps --pull never server
)
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3000/health >/dev/null

(
  cd "$CORE_ROOT"
  docker compose up -d
)
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3020/api/public/clawhive/v1/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3020/api/public/clawhive/v1/health >/dev/null

echo "Deployment completed. Backup: $backup_root"
docker ps --filter name=fde-server-1 --filter name=enterprise-ai-landing-guide --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
