#!/bin/sh
# POSIX/curl client for the Enterprise AI Landing Guide public API.
# ClawHive's Bash runtime may not provide python3; keep this client dependency-free.

set -u

VERSION=1.3.3
PREFIX=/api/public/clawhive/v1
BASE_URL=${ENTERPRISE_AI_LANDING_API_BASE:-https://fde.lantuzhigou.com}
TIMEOUT=35
TMP_FILE=
STATE_TTL=3600

usage() {
  cat >&2 <<'EOF'
Usage: fde_client.sh [--base-url URL] [--timeout SECONDS] COMMAND [OPTIONS]
  Commands: health create message generate map consent convert request-review delete diagnose
Create:   --external-session-id ID [--mode MODE] [--campaign CODE] [--referrer URL] [--entry-url URL] [--test-data]
Message:  --session-id ID --text TEXT [--mode MODE] [--idempotency-key KEY]
Generate: --session-id ID [--idempotency-key KEY]
Map:      --session-id ID
Consent:  --session-id ID [--store] [--contact] [--company NAME] [--contact-name NAME] [--mobile PHONE] [--email EMAIL] [--idempotency-key KEY]
Convert:  --session-id ID [--idempotency-key KEY]
Request-review: --session-handle HANDLE --store --company NAME [--contact --contact-name NAME --mobile PHONE --email EMAIL]
Delete:   --session-id ID | --session-handle HANDLE
Diagnose: --external-session-id ID --text TEXT --mode MODE [--campaign CODE] [--referrer URL] [--entry-url URL] [--test-data] [--idempotency-key KEY]
EOF
  exit 2
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || die "选项$1需要值"
}

cleanup() {
  if [ -n "${TMP_FILE:-}" ]; then
    rm -f "$TMP_FILE"
    TMP_FILE=
  fi
}
trap cleanup 0 HUP INT TERM

state_dir() {
  dir=${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/enterprise-ai-landing-guide
  if [ ! -d "$dir" ]; then
    (umask 077 && mkdir -p "$dir") || die '无法创建会话状态目录'
  fi
  chmod 700 "$dir" || die '无法保护会话状态目录'
  printf '%s' "$dir"
}

valid_handle() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

new_handle() {
  random=$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
  [ -n "$random" ] || random=$(date +%s)-$$
  printf 's-%s' "$random"
}

state_path() {
  handle=$1
  valid_handle "$handle" || die 'session-handle格式无效'
  printf '%s/%s.state' "$(state_dir)" "$handle"
}

write_state() {
  handle=$1
  session_id=$2
  token=$3
  path=$(state_path "$handle")
  now=$(date +%s)
  umask 077
  tmp_state=$(mktemp "${path}.XXXXXX") || die '无法创建会话状态'
  chmod 600 "$tmp_state"
  {
    printf 'created_at=%s\n' "$now"
    printf 'session_id=%s\n' "$session_id"
    printf 'session_token=%s\n' "$token"
  } >"$tmp_state" || { rm -f "$tmp_state"; die '无法写入会话状态'; }
  mv -f "$tmp_state" "$path" || { rm -f "$tmp_state"; die '无法保存会话状态'; }
  chmod 600 "$path"
}

state_field() {
  path=$1
  field=$2
  awk -F= -v wanted="$field" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$path"
}

load_state() {
  handle=$1
  state_path_value=$(state_path "$handle")
  [ -f "$state_path_value" ] || die 'session-handle不存在或已完成'
  chmod 600 "$state_path_value" 2>/dev/null || true
  created_at=$(state_field "$state_path_value" created_at)
  session_id=$(state_field "$state_path_value" session_id)
  session_token=$(state_field "$state_path_value" session_token)
  case "$created_at" in ''|*[!0-9]*) die 'session-handle状态无效' ;; esac
  now=$(date +%s)
  [ "$now" -ge "$created_at" ] || die 'session-handle状态无效'
  [ $((now - created_at)) -lt "$STATE_TTL" ] || die 'session-handle已过期，请新建会话'
  [ -n "$session_id" ] && [ -n "$session_token" ] || die 'session-handle状态不完整'
}

# Escape a shell string for use inside a JSON string. Shell variables cannot
# contain NUL; all other JSON control characters handled by this function are
# escaped rather than interpolated into a hand-written curl payload.
json_escape() {
  awk 'BEGIN { ORS="" }
  {
    if (NR > 1) printf "\\n"
    for (i = 1; i <= length($0); i++) {
      c = substr($0, i, 1)
      if (c == "\\") printf "\\\\"
      else if (c == "\"") printf "\\\""
      else if (c == "\t") printf "\\t"
      else if (c == "\r") printf "\\r"
      else if (c == "\b") printf "\\b"
      else if (c == "\f") printf "\\f"
      else {
        escaped = 0
        for (n = 0; n < 32; n++) {
          if (c == sprintf("%c", n)) {
            printf "\\u%04x", n
            escaped = 1
            break
          }
        }
        if (!escaped) printf "%s", c
      }
    }
  }'
}

json_string() {
  escaped=$(printf '%s' "$1" | json_escape) || die "JSON转义失败"
  printf '"%s"' "$escaped"
}

json_field() {
  field=$1
  json=$2
  # Public session fields are opaque ASCII identifiers. Flattening is only for
  # extracting those identifiers; response JSON itself is returned unchanged.
  printf '%s' "$json" | tr '\n' ' ' | sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

new_key() {
  if [ -n "${1:-}" ]; then
    printf '%s-%s' "$1" "$2"
  else
    printf 'skill-%s-%s-%s' "$(date +%s)" "$$" "$2"
  fi
}

api_request() {
  method=$1
  path=$2
  body=${3:-}
  token=${4:-}
  idem=${5:-}
  TMP_FILE=$(mktemp "${TMPDIR:-/tmp}/enterprise-ai-landing-guide.XXXXXX") || die "无法创建临时响应文件"

  set -- curl -sS --max-time "$TIMEOUT" -o "$TMP_FILE" -w '%{http_code}' -X "$method" \
    -H 'Accept: application/json' -H "User-Agent: enterprise-ai-landing-guide-skill/$VERSION"
  [ -n "$idem" ] && set -- "$@" -H "Idempotency-Key: $idem"
  if [ -n "$body" ]; then
    set -- "$@" -H 'Content-Type: application/json' --data "$body"
  fi
  set -- "$@" "${BASE_URL%/}${PREFIX}${path}"

  # Keep the opaque session token out of curl's argv/process listing. Curl
  # reads this one header from stdin as a config fragment; request JSON and
  # non-secret headers remain normal arguments.
  if [ -n "$token" ]; then
    shift
    status=$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl --config - "$@" 2>"$TMP_FILE.curl-error")
  else
    status=$("$@" 2>"$TMP_FILE.curl-error")
  fi
  curl_status=$?
  if [ "$curl_status" -ne 0 ]; then
    error=$(cat "$TMP_FILE.curl-error" 2>/dev/null || true)
    rm -f "$TMP_FILE.curl-error"
    die "HTTP请求失败: ${error:-curl退出码$curl_status}"
  fi
  rm -f "$TMP_FILE.curl-error"
  response=$(cat "$TMP_FILE")
  cleanup
  case "$status" in
    2??)
      printf '%s\n' "$response"
      ;;
    *)
      code=$(json_field code "$response")
      message=$(json_field message "$response")
      die "HTTP $status ${code:-EXT-HTTP}: ${message:-请求失败}"
      ;;
  esac
}

check_mode() {
  case "$1" in
    KNOWN_PROBLEM|OPPORTUNITY_SCAN) ;;
    *) die "mode必须是KNOWN_PROBLEM或OPPORTUNITY_SCAN" ;;
  esac
}

create_payload() {
  external_id=$1
  mode=$2
  campaign=$3
  referrer=$4
  entry_url=$5
  test_data=$6
  payload='{"sourcePlatform":"CLAWHIVE","sourceVersion":"1.3.3","externalSessionId":'
  payload=$payload$(json_string "$external_id")
  [ -n "$mode" ] && payload=$payload',"mode":'$(json_string "$mode")
  [ -n "$campaign" ] && payload=$payload',"campaignCode":'$(json_string "$campaign")
  [ -n "$referrer" ] && payload=$payload',"referrer":'$(json_string "$referrer")
  [ -n "$entry_url" ] && payload=$payload',"entryUrl":'$(json_string "$entry_url")
  [ "$test_data" -eq 1 ] && payload=$payload',"dataClassification":"TEST_DATA"'
  payload=$payload'}'
  printf '%s' "$payload"
}

message_payload() {
  text=$1
  mode=$2
  payload='{"message":'
  payload=$payload$(json_string "$text")
  [ -n "$mode" ] && payload=$payload',"mode":'$(json_string "$mode")
  payload=$payload'}'
  printf '%s' "$payload"
}

consent_payload() {
  company=$1
  contact_name=$2
  mobile=$3
  email=$4
  store=$5
  contact=$6
  printf '{"consentToStore":%s,"consentToContact":%s,"companyName":%s,"contactName":%s,"mobile":%s,"email":%s}' \
    "$store" "$contact" "$(json_string "$company")" "$(json_string "$contact_name")" "$(json_string "$mobile")" "$(json_string "$email")"
}

token_from_environment() {
  token=${ENTERPRISE_AI_LANDING_SESSION_TOKEN:-}
  [ -n "$token" ] || die '请在当前进程上下文设置ENTERPRISE_AI_LANDING_SESSION_TOKEN'
  printf '%s' "$token"
}

run_create() {
  external_id=
  mode=
  campaign=
  referrer=
  entry_url=
  test_data=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --external-session-id) require_value "$1" "${2:-}"; external_id=$2; shift 2 ;;
      --platform) require_value "$1" "${2:-}"; [ "$2" = CLAWHIVE ] || die 'ClawHive来源固定为CLAWHIVE'; shift 2 ;;
      --version) require_value "$1" "${2:-}"; [ "$2" = "$VERSION" ] || die "ClawHive版本固定为$VERSION"; shift 2 ;;
      --mode) require_value "$1" "${2:-}"; check_mode "$2"; mode=$2; shift 2 ;;
      --campaign) require_value "$1" "${2:-}"; campaign=$2; shift 2 ;;
      --referrer) require_value "$1" "${2:-}"; referrer=$2; shift 2 ;;
      --entry-url) require_value "$1" "${2:-}"; entry_url=$2; shift 2 ;;
      --test-data) test_data=1; shift ;;
      *) die "create不支持选项$1" ;;
    esac
  done
  [ -n "$external_id" ] || die '缺少--external-session-id'
  api_request POST /sessions "$(create_payload "$external_id" "$mode" "$campaign" "$referrer" "$entry_url" "$test_data")"
}

run_message() {
  session_id=
  text=
  mode=
  idem=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-id) require_value "$1" "${2:-}"; session_id=$2; shift 2 ;;
      --text) require_value "$1" "${2:-}"; text=$2; shift 2 ;;
      --mode) require_value "$1" "${2:-}"; check_mode "$2"; mode=$2; shift 2 ;;
      --idempotency-key) require_value "$1" "${2:-}"; idem=$2; shift 2 ;;
      *) die "message不支持选项$1" ;;
    esac
  done
  [ -n "$session_id" ] || die '缺少--session-id'
  [ -n "$text" ] || die '缺少--text'
  [ -n "$idem" ] || idem=$(new_key '' message)
  api_request POST "/sessions/$session_id/messages" "$(message_payload "$text" "$mode")" "$(token_from_environment)" "$idem"
}

run_generate() {
  session_id=
  idem=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-id) require_value "$1" "${2:-}"; session_id=$2; shift 2 ;;
      --idempotency-key) require_value "$1" "${2:-}"; idem=$2; shift 2 ;;
      *) die "generate不支持选项$1" ;;
    esac
  done
  [ -n "$session_id" ] || die '缺少--session-id'
  [ -n "$idem" ] || idem=$(new_key '' generate)
  api_request POST "/sessions/$session_id/generate-map" '{}' "$(token_from_environment)" "$idem"
}

run_map() {
  session_id=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-id) require_value "$1" "${2:-}"; session_id=$2; shift 2 ;;
      *) die "map不支持选项$1" ;;
    esac
  done
  [ -n "$session_id" ] || die '缺少--session-id'
  api_request GET "/sessions/$session_id/map" '' "$(token_from_environment)"
}

run_consent() {
  session_id=
  idem=
  store=false
  contact=false
  company=
  contact_name=
  mobile=
  email=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-id) require_value "$1" "${2:-}"; session_id=$2; shift 2 ;;
      --idempotency-key) require_value "$1" "${2:-}"; idem=$2; shift 2 ;;
      --store) store=true; shift ;;
      --contact) contact=true; shift ;;
      --company) require_value "$1" "${2:-}"; company=$2; shift 2 ;;
      --contact-name) require_value "$1" "${2:-}"; contact_name=$2; shift 2 ;;
      --mobile) require_value "$1" "${2:-}"; mobile=$2; shift 2 ;;
      --email) require_value "$1" "${2:-}"; email=$2; shift 2 ;;
      *) die "consent不支持选项$1" ;;
    esac
  done
  [ -n "$session_id" ] || die '缺少--session-id'
  [ -n "$idem" ] || idem=$(new_key '' consent)
  api_request POST "/sessions/$session_id/consent" "$(consent_payload "$company" "$contact_name" "$mobile" "$email" "$store" "$contact")" "$(token_from_environment)" "$idem"
}

run_convert() {
  session_id=
  idem=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-id) require_value "$1" "${2:-}"; session_id=$2; shift 2 ;;
      --idempotency-key) require_value "$1" "${2:-}"; idem=$2; shift 2 ;;
      *) die "convert不支持选项$1" ;;
    esac
  done
  [ -n "$session_id" ] || die '缺少--session-id'
  [ -n "$idem" ] || idem=$(new_key '' convert)
  api_request POST "/sessions/$session_id/convert" '{}' "$(token_from_environment)" "$idem"
}

run_request_review() {
  handle=
  store=false
  contact=false
  company=
  contact_name=
  mobile=
  email=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-handle) require_value "$1" "${2:-}"; handle=$2; shift 2 ;;
      --store) store=true; shift ;;
      --contact) contact=true; shift ;;
      --company) require_value "$1" "${2:-}"; company=$2; shift 2 ;;
      --contact-name) require_value "$1" "${2:-}"; contact_name=$2; shift 2 ;;
      --mobile) require_value "$1" "${2:-}"; mobile=$2; shift 2 ;;
      --email) require_value "$1" "${2:-}"; email=$2; shift 2 ;;
      *) die "request-review不支持选项$1" ;;
    esac
  done
  [ -n "$handle" ] || die '缺少--session-handle'
  [ "$store" = true ] || die 'request-review需要--store'
  [ -n "$company" ] || die 'request-review需要--company'
  if [ "$contact" = true ]; then
    [ -n "$contact_name$mobile$email" ] || die '同意联系时需要联系人、手机或邮箱'
  else
    contact_name=
    mobile=
    email=
  fi
  load_state "$handle"
  path=$(state_path "$handle")
  consent_response=$(api_request POST "/sessions/$session_id/consent" "$(consent_payload "$company" "$contact_name" "$mobile" "$email" "$store" "$contact")" "$session_token" "$(new_key "$handle" consent)") || exit 1
  convert_response=$(api_request POST "/sessions/$session_id/convert" '{}' "$session_token" "$(new_key "$handle" convert)") || exit 1
  rm -f "$path"
  printf '{"consent":%s,"convert":%s}\n' "$consent_response" "$convert_response"
}

run_delete() {
  session_id=
  handle=
  session_token=
  path=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --session-id) require_value "$1" "${2:-}"; session_id=$2; shift 2 ;;
      --session-handle) require_value "$1" "${2:-}"; handle=$2; shift 2 ;;
      *) die "delete不支持选项$1" ;;
    esac
  done
  if [ -n "$handle" ]; then
    load_state "$handle"
    path=$(state_path "$handle")
  fi
  [ -n "$session_id" ] || die '缺少--session-id'
  if [ -n "$session_token" ]; then
    api_request DELETE "/sessions/$session_id" '' "$session_token"
  else
    api_request DELETE "/sessions/$session_id" '' "$(token_from_environment)"
  fi
  [ -n "${path:-}" ] && rm -f "$path"
}

run_diagnose() {
  external_id=
  text=
  mode=
  campaign=
  referrer=
  entry_url=
  test_data=0
  base_key=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --external-session-id) require_value "$1" "${2:-}"; external_id=$2; shift 2 ;;
      --text) require_value "$1" "${2:-}"; text=$2; shift 2 ;;
      --mode) require_value "$1" "${2:-}"; check_mode "$2"; mode=$2; shift 2 ;;
      --campaign) require_value "$1" "${2:-}"; campaign=$2; shift 2 ;;
      --referrer) require_value "$1" "${2:-}"; referrer=$2; shift 2 ;;
      --entry-url) require_value "$1" "${2:-}"; entry_url=$2; shift 2 ;;
      --test-data) test_data=1; shift ;;
      --idempotency-key) require_value "$1" "${2:-}"; base_key=$2; shift 2 ;;
      *) die "diagnose不支持选项$1" ;;
    esac
  done
  [ -n "$external_id" ] || die '缺少--external-session-id'
  [ -n "$text" ] || die '缺少--text'
  [ -n "$mode" ] || die 'diagnose必须提供--mode'
  create_response=$(api_request POST /sessions "$(create_payload "$external_id" "$mode" "$campaign" "$referrer" "$entry_url" "$test_data")") || exit 1
  session_id=$(json_field sessionId "$create_response")
  session_token=$(json_field sessionToken "$create_response")
  [ -n "$session_id" ] && [ -n "$session_token" ] || die '创建会话响应缺少sessionId或sessionToken'
  message_response=$(api_request POST "/sessions/$session_id/messages" "$(message_payload "$text" "$mode")" "$session_token" "$(new_key "$base_key" message)") || exit 1
  map_response=$(api_request POST "/sessions/$session_id/generate-map" '{}' "$session_token" "$(new_key "$base_key" generate)") || exit 1
  handle=$(new_handle)
  write_state "$handle" "$session_id" "$session_token"
  printf '{"sessionHandle":%s,"sessionId":%s,"message":%s,"map":%s}\n' \
    "$(json_string "$handle")" "$(json_string "$session_id")" "$message_response" "$map_response"
}

command=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base-url) require_value "$1" "${2:-}"; BASE_URL=$2; shift 2 ;;
    --timeout) require_value "$1" "${2:-}"; TIMEOUT=$2; shift 2 ;;
    health|create|message|generate|map|consent|convert|request-review|delete|diagnose) command=$1; shift; break ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[ -n "$command" ] || usage

case "$command" in
  health) [ "$#" -eq 0 ] || die 'health不接受选项'; api_request GET /health '' ;;
  create) run_create "$@" ;;
  message) run_message "$@" ;;
  generate) run_generate "$@" ;;
  map) run_map "$@" ;;
  consent) run_consent "$@" ;;
  convert) run_convert "$@" ;;
  request-review) run_request_review "$@" ;;
  delete) run_delete "$@" ;;
  diagnose) run_diagnose "$@" ;;
esac
