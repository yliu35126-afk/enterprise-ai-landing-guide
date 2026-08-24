#!/bin/sh
# Local contract test for the ClawHive POSIX client. No network is used.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fde-client-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
FAKE="$TMP/fake-curl"
LOG="$TMP/calls.log"

cat >"$FAKE" <<'EOF'
#!/bin/sh
set -eu
out=
url=
next=
for arg in "$@"; do
  case "$arg" in
    -o) next=out ;;
    http://*|https://*) url=$arg ;;
    *) if [ "$next" = out ]; then out=$arg; next=; fi ;;
  esac
done
printf '%s\n' "$url" >>"$FAKE_CURL_LOG"
case "$url" in
  */sessions) body='{"sessionId":"sess-test","sessionToken":"TOKEN-SECRET"}'; status=201 ;;
  */sessions/sess-test/messages) body='{"messageId":"msg-test","message":"ok"}'; status=200 ;;
  */sessions/sess-test/generate-map) body='{"mapId":"map-test","result":"ok"}'; status=200 ;;
  */sessions/sess-test/consent)
    if [ "${FAKE_FAIL_CONSENT:-0}" = 1 ]; then body='{"code":"EXT-500","message":"mock failure"}'; status=500
    else body='{"consentToStore":true}'; status=200; fi ;;
  */sessions/sess-test/convert) body='{"conversionStatus":"PENDING_CONFIRMATION"}'; status=200 ;;
  */sessions/sess-test) body='{"deleted":true}'; status=200 ;;
  *) body='{"code":"EXT-404","message":"unexpected mock path"}'; status=404 ;;
esac
printf '%s' "$body" >"$out"
printf '%s' "$status"
EOF
chmod 700 "$FAKE"

export FAKE_CURL_LOG="$LOG"
export PATH="$TMP:$PATH"
ln -s "$FAKE" "$TMP/curl"
export TMPDIR="$TMP/runtime"
mkdir -p "$TMPDIR"

out=$(sh "$ROOT/scripts/fde_client.sh" --base-url http://mock diagnose \
  --external-session-id testdata-client --mode KNOWN_PROBLEM \
  --text 'TEST_DATA mock diagnosis' --test-data)
printf '%s\n' "$out" | grep -q 'sessionHandle'
if printf '%s\n' "$out" | grep -q 'TOKEN-SECRET\|sessionToken'; then
  echo 'diagnose leaked token' >&2; exit 1
fi
handle=$(printf '%s\n' "$out" | sed -n 's/.*"sessionHandle":"\([^"]*\)".*/\1/p')
[ -n "$handle" ]
state="$TMPDIR/enterprise-ai-landing-guide/$handle.state"
[ -f "$state" ]
mode=$(stat -c '%a' "$state" 2>/dev/null || stat -f '%Lp' "$state")
[ "$mode" = 600 ] || { echo "state mode $mode" >&2; exit 1; }

sh "$ROOT/scripts/fde_client.sh" --base-url http://mock request-review \
  --session-handle "$handle" --store --company TEST_DATA_MockCo >/dev/null
[ ! -e "$state" ]
grep -q '/consent' "$LOG"
grep -q '/convert' "$LOG"

before=$(wc -l <"$LOG")
out=$(sh "$ROOT/scripts/fde_client.sh" --base-url http://mock diagnose \
  --external-session-id testdata-failure --mode KNOWN_PROBLEM \
  --text 'TEST_DATA failure' --test-data)
handle=$(printf '%s\n' "$out" | sed -n 's/.*"sessionHandle":"\([^"]*\)".*/\1/p')
state="$TMPDIR/enterprise-ai-landing-guide/$handle.state"
set +e
FAKE_FAIL_CONSENT=1 sh "$ROOT/scripts/fde_client.sh" --base-url http://mock request-review \
  --session-handle "$handle" --store --company TEST_DATA_Failure >/dev/null 2>"$TMP/failure.err"
rc=$?
set -e
[ "$rc" -ne 0 ]
[ -f "$state" ]
after=$(wc -l <"$LOG")
[ "$after" -eq $((before + 4)) ] || { echo 'unexpected retry/diagnose call count' >&2; exit 1; }

# Expiry is rejected before curl is invoked.
sed -i.bak 's/^created_at=.*/created_at=1/' "$state"
before=$(wc -l <"$LOG")
set +e
sh "$ROOT/scripts/fde_client.sh" --base-url http://mock request-review \
  --session-handle "$handle" --store --company TEST_DATA_Expired >/dev/null 2>"$TMP/expired.err"
rc=$?
set -e
[ "$rc" -ne 0 ]
[ "$(wc -l <"$LOG")" -eq "$before" ]

echo 'fde_client.sh contract tests: PASS'
