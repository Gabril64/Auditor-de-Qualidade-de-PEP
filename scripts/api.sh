#!/usr/bin/env bash
# Manual client for the Producer API: logs in once, keeps the session cookie and the CSRF token in
# .api-session/, and attaches both to every later call.
#
#   scripts/api.sh login admin@auditor.local            # asks for the password (not kept in the history)
#   scripts/api.sh change-password                      # asks for the current and the new password
#   scripts/api.sh GET /api/audits
#   scripts/api.sh POST '/batches?source=upload' @/tmp/lote.json
#   scripts/api.sh PATCH /api/audits/1/revision '{"updated_at":null,"changes":[...]}'
#   scripts/api.sh logout
#
# API_PROFILE=maria keeps a second session beside the default one; API_URL overrides the address.
set -euo pipefail

URL="${API_URL:-http://localhost:3001}"
PROFILE="${API_PROFILE:-default}"
STATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/.api-session"
COOKIES="$STATE_DIR/$PROFILE.cookies"
CSRF_FILE="$STATE_DIR/$PROFILE.csrf"

json_field() {
  python3 -c "import sys,json; print(json.load(sys.stdin)$1)"
}

pretty() {
  python3 -c "
import sys, json
text = sys.stdin.read()
try:
    print(json.dumps(json.loads(text), indent=2, ensure_ascii=False))
except ValueError:
    print(text)
"
}

need_session() {
  if [[ ! -f "$COOKIES" || ! -f "$CSRF_FILE" ]]; then
    echo "No session for profile '$PROFILE'. Run: scripts/api.sh login <email>" >&2
    exit 1
  fi
}

call() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -b "$COOKIES" -H "X-CSRF-Token: $(cat "$CSRF_FILE")" -X "$method" -w $'\n%{http_code}')
  if [[ -n "$body" ]]; then
    args+=(-H 'content-type: application/json')
    if [[ "$body" == @* ]]; then args+=(--data-binary "$body"); else args+=(-d "$body"); fi
  fi
  local output status
  output="$(curl "${args[@]}" "$URL$path")"
  status="${output##*$'\n'}"
  printf '%s\n' "${output%$'\n'*}" | pretty
  echo "HTTP $status" >&2
}

command="${1:-}"
case "$command" in
  login)
    email="${2:?usage: api.sh login <email> [password]}"
    password="${3:-}"
    if [[ -z "$password" ]]; then read -r -s -p "Password: " password; echo >&2; fi
    mkdir -p "$STATE_DIR"
    response="$(curl -s -c "$COOKIES" -H 'content-type: application/json' -w $'\n%{http_code}' \
      -d "$(python3 -c "import json,sys; print(json.dumps({'email': sys.argv[1], 'password': sys.argv[2]}))" "$email" "$password")" \
      "$URL/api/auth/login")"
    status="${response##*$'\n'}"
    body="${response%$'\n'*}"
    if [[ "$status" != "200" ]]; then
      printf '%s\n' "$body" | pretty
      echo "HTTP $status" >&2
      rm -f "$COOKIES" "$CSRF_FILE"
      exit 1
    fi
    printf '%s' "$body" | json_field "['csrf_token']" > "$CSRF_FILE"
    chmod 600 "$COOKIES" "$CSRF_FILE"
    printf '%s\n' "$body" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['user'], indent=2, ensure_ascii=False))"
    echo "Logged in as profile '$PROFILE'." >&2
    ;;
  change-password)
    need_session
    read -r -s -p "Current password: " current; echo >&2
    read -r -s -p "New password (min. 10 characters): " new; echo >&2
    call POST /api/auth/change-password "$(python3 -c "import json,sys; print(json.dumps({'current_password': sys.argv[1], 'new_password': sys.argv[2]}))" "$current" "$new")"
    ;;
  logout)
    need_session
    call POST /api/auth/logout
    rm -f "$COOKIES" "$CSRF_FILE"
    ;;
  GET | POST | PATCH | PUT | DELETE)
    need_session
    call "$command" "${2:?usage: api.sh $command <path> [body | @file]}" "${3:-}"
    ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 1
    ;;
esac
