#!/usr/bin/env bash
# ============================================================================
# 04 — Tunnel Lifecycle
# ============================================================================
# Verifies tunnel CRUD operations and tunnel ownership:
# - Every tunnel is carried by an owning agent: an admin POST /api/tunnels
#   must name an enrolled, non-revoked agent in agentLabel
# - Create a tunnel via POST /api/tunnels; the owner and the default request
#   body limit are echoed back
# - Verify tunnel appears in GET /api/tunnels
# - Verify nginx vhost is created (with client_max_body_size) and nginx -t passes
# - GET /api/tunnels/agent-config?agent=<label> returns the owner's chisel
#   config; without ?agent= an admin gets only the domain and chisel URL
# - The chisel authfile grants the owner exactly the tunnel's anchored reverse
#   remote and always carries the no-grants sentinel user
# - Reconfigure the request body limit and access mode via PATCH (vhost
#   rewritten in place; a disabled tunnel stays disabled)
# - Enable/disable tunnel via PATCH /api/tunnels/:id (the chisel grant follows)
# - Reassign the tunnel via PATCH {"agentLabel"} (the chisel grant moves)
# - Change owner, access mode, body limit and enabled in ONE PATCH (one
#   locked workflow: owner, then vhost settings, then enabled)
# - Grant additions are hot-reloaded by chisel (no restart); revocations
#   (disable, reassign, revoke) restart it
# - Revoking the owning agent's certificate releases the tunnel: it keeps its
#   hostname but loses its owner and its chisel grant (dark)
# - Delete tunnel via DELETE /api/tunnels/:id (the chisel grant is removed)
# - Verify cleanup (tunnel removed from list, vhost removed, nginx -t passes)
# - Test validation (owner, reserved subdomains, duplicate names, invalid ports,
#   body limit bounds)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

TEST_SUBDOMAIN="e2etest-$(date +%s)"
TEST_PORT=18080
TEST_DESCRIPTION="E2E test tunnel"
OWNER_LABEL="tunnel-owner-$(date +%s)"
OTHER_LABEL="tunnel-other-$(date +%s)"
UNKNOWN_LABEL="no-such-agent-$(date +%s)"
TUNNEL_ID=""
FAKE_ID="00000000-0000-0000-0000-000000000000"
CHISEL_USERS="/etc/lamalibre/lamaste/chisel-users"
# The anchored reverse remote chisel must grant the owner for TEST_PORT
GRANT_PATTERN="^R:127\\.0\\.0\\.1:${TEST_PORT}\$"

# chisel_grants <label> — print the reverse remotes the chisel authfile grants
# the chisel user agent-<label>, one per line. The authfile is JSON of the form
# {"<user>:<password>": [<regex>, ...]}; only the user half of each key is
# matched and only the grants are printed, never a password.
chisel_grants() {
  sudo cat "$CHISEL_USERS" 2>/dev/null \
    | jq -r --arg u "agent-$1:" 'to_entries[] | select(.key | startswith($u)) | .value[]' 2>/dev/null \
    || true
}

# chisel_user_count <prefix> — number of authfile users whose name starts with <prefix>
chisel_user_count() {
  sudo cat "$CHISEL_USERS" 2>/dev/null \
    | jq -r --arg p "$1" '[keys[] | select(startswith($p))] | length' 2>/dev/null \
    || echo "0"
}

# chisel_grant_holders <pattern> — number of authfile users granted <pattern>
chisel_grant_holders() {
  sudo cat "$CHISEL_USERS" 2>/dev/null \
    | jq -r --arg g "$1" '[to_entries[] | select(any(.value[]; . == $g))] | length' 2>/dev/null \
    || echo "0"
}

# chisel_pid — MainPID of the chisel server
chisel_pid() {
  systemctl show -p MainPID --value chisel 2>/dev/null || echo "0"
}

# chisel_restarted_since <pid> — succeed once chisel's MainPID differs from
# <pid> (polled for up to 15 seconds: the restart is part of the request, but
# systemd may report the new PID a moment later)
chisel_restarted_since() {
  local deadline=$((SECONDS + 15)) now
  while [ "$SECONDS" -lt "$deadline" ]; do
    now=$(chisel_pid)
    if [ -n "$now" ] && [ "$now" != "0" ] && [ "$now" != "$1" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

begin_test "04 — Tunnel Lifecycle"

# Cleanup function — always runs on exit. The tunnel goes first so that
# revoking its owner never leaves a tunnel behind.
cleanup() {
  if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    api_delete "tunnels/${TUNNEL_ID}" > /dev/null 2>&1 || true
  fi
  api_delete "certs/agent/${OWNER_LABEL}" > /dev/null 2>&1 || true
  api_delete "certs/agent/${OTHER_LABEL}" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_info "Onboarding not completed (status: $ONBOARDING_STATUS). Tunnel creation requires onboarding."
  log_skip "Skipping tunnel lifecycle tests — onboarding not complete"
  end_test
  exit $?
fi

# The restart-vs-reload checks assume the pinned chisel release, which reloads
# its authfile for new grants without a restart
SERVER_CHISEL_VERSION=$(/usr/local/bin/chisel --version 2>/dev/null | sed 's/^v//' || echo "")
assert_eq "$SERVER_CHISEL_VERSION" "1.12.0" "Chisel server (/usr/local/bin/chisel) is the pinned release 1.12.0" || true
PINNED_CHISEL=false
if [ "$SERVER_CHISEL_VERSION" = "1.12.0" ] && [ "$(systemctl is-active chisel 2>/dev/null || true)" = "active" ]; then
  PINNED_CHISEL=true
else
  log_skip "Chisel is not the running pinned release — restart-vs-reload checks are skipped"
fi

# ---------------------------------------------------------------------------
log_section "Enroll owning agents"
# ---------------------------------------------------------------------------

# Two agents: the tunnel is created for the first and later reassigned to the
# second. Neither runs a chisel client — this test checks what the server
# grants, not traffic (traffic is covered by the three-VM suite).
OWNER_RESPONSE=$(api_post "certs/agent" '{"label":"'"${OWNER_LABEL}"'","capabilities":["tunnels:read"]}')
assert_json_field "$OWNER_RESPONSE" '.ok' 'true' "Owning agent cert created (${OWNER_LABEL})" || true

OTHER_RESPONSE=$(api_post "certs/agent" '{"label":"'"${OTHER_LABEL}"'","capabilities":["tunnels:read"]}')
assert_json_field "$OTHER_RESPONSE" '.ok' 'true' "Second agent cert created (${OTHER_LABEL})" || true

OWNER_USERS=$(chisel_user_count "agent-${OWNER_LABEL}:")
assert_eq "$OWNER_USERS" "1" "Chisel authfile has a user for the owning agent" || true

OWNER_GRANTS_BEFORE=$(chisel_grants "$OWNER_LABEL")
assert_eq "$OWNER_GRANTS_BEFORE" "" "Agent with no tunnels is granted no reverse remote" || true

SENTINEL_USERS=$(chisel_user_count "lamaste-no-grants:")
assert_eq "$SENTINEL_USERS" "1" "Chisel authfile carries the lamaste-no-grants sentinel user" || true

SENTINEL_GRANTS=$(sudo cat "$CHISEL_USERS" 2>/dev/null | jq -r '[to_entries[] | select(.key | startswith("lamaste-no-grants:")) | .value[]] | length' 2>/dev/null || echo "unknown")
assert_eq "$SENTINEL_GRANTS" "0" "Sentinel user is granted no reverse remote" || true

# ---------------------------------------------------------------------------
log_section "Validation: tunnel owner"
# ---------------------------------------------------------------------------

NO_OWNER_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2enoowner","port":19997,"description":"no owner"}')
assert_eq "$NO_OWNER_STATUS" "400" "Admin POST without agentLabel rejected (HTTP 400)" || true

NO_OWNER_RESPONSE=$(api_post "tunnels" '{"subdomain":"e2enoowner","port":19997,"description":"no owner"}')
assert_contains "$(echo "$NO_OWNER_RESPONSE" | jq -r '.error' 2>/dev/null || echo "")" "agentLabel is required" "Missing agentLabel error names the field" || true

UNKNOWN_OWNER_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"e2enoowner\",\"port\":19997,\"description\":\"unknown owner\",\"agentLabel\":\"${UNKNOWN_LABEL}\"}")
assert_eq "$UNKNOWN_OWNER_STATUS" "400" "Admin POST naming an unknown agent rejected (HTTP 400)" || true

UNKNOWN_OWNER_RESPONSE=$(api_post "tunnels" "{\"subdomain\":\"e2enoowner\",\"port\":19997,\"description\":\"unknown owner\",\"agentLabel\":\"${UNKNOWN_LABEL}\"}")
assert_contains "$(echo "$UNKNOWN_OWNER_RESPONSE" | jq -r '.details' 2>/dev/null || echo "")" "is not enrolled or has been revoked" "Unknown agent error explains the owner is not enrolled" || true

BAD_LABEL_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2enoowner","port":19997,"description":"bad owner","agentLabel":"Not_A_Label"}')
assert_eq "$BAD_LABEL_STATUS" "400" "Admin POST with malformed agentLabel rejected (HTTP 400)" || true

NO_OWNER_LEFT=$(api_get "tunnels" | jq '[.tunnels[] | select(.subdomain == "e2enoowner")] | length' 2>/dev/null || echo "unknown")
assert_eq "$NO_OWNER_LEFT" "0" "Rejected creates left no tunnel behind" || true

# ---------------------------------------------------------------------------
log_section "Create tunnel"
# ---------------------------------------------------------------------------

CREATE_BODY=$(cat <<EOF
{
  "subdomain": "$TEST_SUBDOMAIN",
  "port": $TEST_PORT,
  "description": "$TEST_DESCRIPTION",
  "agentLabel": "$OWNER_LABEL"
}
EOF
)

PID_BEFORE_CREATE=$(chisel_pid)
CREATE_RESPONSE=$(api_post "tunnels" "$CREATE_BODY")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true
if [ "$PINNED_CHISEL" = "true" ]; then
  assert_eq "$(chisel_pid)" "$PID_BEFORE_CREATE" "New grant hot-reloaded: chisel not restarted by the tunnel creation" || true
fi

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field "$CREATE_RESPONSE" '.tunnel.subdomain' "$TEST_SUBDOMAIN" "Tunnel subdomain matches" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.port' "$TEST_PORT" "Tunnel port matches" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.agentLabel' "$OWNER_LABEL" "Tunnel agentLabel echoes the owning agent" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.maxBodySizeMb' "10" "Tunnel request body limit defaults to 10 MB" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.fqdn' "Tunnel has an FQDN" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.createdAt' "Tunnel has a createdAt timestamp" || true

log_info "Created tunnel ID: $TUNNEL_ID"

# ---------------------------------------------------------------------------
log_section "Verify tunnel in list"
# ---------------------------------------------------------------------------

LIST_RESPONSE=$(api_get "tunnels")
FOUND=$(echo "$LIST_RESPONSE" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .subdomain' 2>/dev/null || echo "")
assert_eq "$FOUND" "$TEST_SUBDOMAIN" "Tunnel appears in GET /api/tunnels" || true

FOUND_OWNER=$(echo "$LIST_RESPONSE" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .agentLabel' 2>/dev/null || echo "")
assert_eq "$FOUND_OWNER" "$OWNER_LABEL" "Tunnel listing shows the owning agent" || true

# ---------------------------------------------------------------------------
log_section "Verify nginx configuration"
# ---------------------------------------------------------------------------

# Check vhost file exists
DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "unknown")
VHOST_NAME="lamalibre-lamaste-app-${TEST_SUBDOMAIN}"
VHOST_PATH="/etc/nginx/sites-enabled/${VHOST_NAME}"
VHOST_AVAILABLE="/etc/nginx/sites-available/${VHOST_NAME}"

if [ -f "$VHOST_PATH" ] || [ -L "$VHOST_PATH" ]; then
  log_pass "Nginx vhost exists at $VHOST_PATH"
else
  VHOST_ALT="/etc/nginx/sites-available/${VHOST_NAME}"
  if [ -f "$VHOST_ALT" ]; then
    log_pass "Nginx vhost exists at $VHOST_ALT"
  else
    log_fail "Nginx vhost not found at $VHOST_PATH"
  fi
fi

# Verify nginx config is still valid
NGINX_TEST=$(sudo nginx -t 2>&1 || true)
assert_contains "$NGINX_TEST" "syntax is ok" "nginx -t passes after tunnel creation" || true

# The vhost carries the tunnel's request body limit (nginx would otherwise
# apply its built-in 1 MB default) and, in the default restricted mode, an
# auth_request gate
VHOST_CONTENT=$(sudo cat "$VHOST_AVAILABLE" 2>/dev/null || echo "")
assert_contains "$VHOST_CONTENT" "client_max_body_size 10m;" "Vhost sets client_max_body_size 10m" || true
assert_contains "$VHOST_CONTENT" "auth_request" "Restricted tunnel vhost has an auth_request gate" || true

# ---------------------------------------------------------------------------
log_section "Agent config follows ownership"
# ---------------------------------------------------------------------------

OWNER_CONFIG=$(api_get "tunnels/agent-config?agent=${OWNER_LABEL}")
assert_json_field "$OWNER_CONFIG" '.agentLabel' "$OWNER_LABEL" "agent-config?agent=<owner> is the owner's config" || true
OWNER_CONFIG_PORT=$(echo "$OWNER_CONFIG" | jq -r --arg sd "$TEST_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
assert_eq "$OWNER_CONFIG_PORT" "$TEST_PORT" "agent-config?agent=<owner> lists the tunnel" || true
OWNER_CHISEL_ARGS=$(echo "$OWNER_CONFIG" | jq -r '.chiselArgs[]?' 2>/dev/null || echo "")
assert_contains "$OWNER_CHISEL_ARGS" "R:127.0.0.1:${TEST_PORT}:127.0.0.1:${TEST_PORT}" "Owner's chiselArgs carry the tunnel's reverse remote" || true
# Agents verify the chisel server's certificate: the args are
# ["client", "https://tunnel.<domain>:443", ...remotes] with no skip-verify flag
assert_not_contains "$OWNER_CHISEL_ARGS" "tls-skip-verify" "Owner's chiselArgs do not skip TLS verification" || true
OWNER_CHISEL_SERVER=$(echo "$OWNER_CONFIG" | jq -r '.chiselArgs[1] // empty' 2>/dev/null || echo "")
assert_eq "$OWNER_CHISEL_SERVER" "https://tunnel.${DOMAIN}:443" "chiselArgs[1] is the chisel server URL" || true

OTHER_CONFIG=$(api_get "tunnels/agent-config?agent=${OTHER_LABEL}")
OTHER_CONFIG_PORT=$(echo "$OTHER_CONFIG" | jq -r --arg sd "$TEST_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
assert_eq "$OTHER_CONFIG_PORT" "" "agent-config for another agent does not list the tunnel" || true

ADMIN_CONFIG=$(api_get "tunnels/agent-config")
assert_json_field_not_empty "$ADMIN_CONFIG" '.domain' "Admin agent-config without ?agent= returns the domain" || true
assert_json_field_not_empty "$ADMIN_CONFIG" '.chiselServerUrl' "Admin agent-config without ?agent= returns the chisel server URL" || true
ADMIN_HAS_ARGS=$(echo "$ADMIN_CONFIG" | jq -r 'has("chiselArgs") or has("tunnels")' 2>/dev/null || echo "unknown")
assert_eq "$ADMIN_HAS_ARGS" "false" "Admin agent-config without ?agent= carries no chiselArgs or tunnels" || true

BAD_AGENT_QUERY_STATUS=$(api_get_status "tunnels/agent-config?agent=Not_A_Label")
assert_eq "$BAD_AGENT_QUERY_STATUS" "400" "agent-config with a malformed ?agent= returns 400" || true

# ---------------------------------------------------------------------------
log_section "Chisel grant for the owner"
# ---------------------------------------------------------------------------

OWNER_GRANTS=$(chisel_grants "$OWNER_LABEL")
assert_contains "$OWNER_GRANTS" "$GRANT_PATTERN" "Chisel authfile grants the owner ${GRANT_PATTERN}" || true

OTHER_GRANTS=$(chisel_grants "$OTHER_LABEL")
assert_not_contains "$OTHER_GRANTS" "$GRANT_PATTERN" "Chisel authfile does not grant the port to another agent" || true

GRANT_HOLDERS=$(chisel_grant_holders "$GRANT_PATTERN")
assert_eq "$GRANT_HOLDERS" "1" "Exactly one chisel user holds the grant for the port" || true

# ---------------------------------------------------------------------------
log_section "Validation: reserved subdomain"
# ---------------------------------------------------------------------------

RESERVED_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"panel\",\"port\":19999,\"description\":\"reserved test\",\"agentLabel\":\"${OWNER_LABEL}\"}")
assert_eq "$RESERVED_STATUS" "400" "Reserved subdomain 'panel' rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Validation: duplicate subdomain"
# ---------------------------------------------------------------------------

DUP_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"$TEST_SUBDOMAIN\",\"port\":19998,\"description\":\"dup test\",\"agentLabel\":\"${OWNER_LABEL}\"}")
assert_eq "$DUP_STATUS" "400" "Duplicate subdomain rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Validation: duplicate port"
# ---------------------------------------------------------------------------

DUP_PORT_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"e2edup-port\",\"port\":$TEST_PORT,\"description\":\"dup port test\",\"agentLabel\":\"${OTHER_LABEL}\"}")
assert_eq "$DUP_PORT_STATUS" "400" "Duplicate port rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Validation: invalid port"
# ---------------------------------------------------------------------------

LOW_PORT_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"e2elow\",\"port\":80,\"description\":\"low port\",\"agentLabel\":\"${OWNER_LABEL}\"}")
if [ "$LOW_PORT_STATUS" = "400" ] || [ "$LOW_PORT_STATUS" = "422" ]; then
  log_pass "Port below 1024 rejected (HTTP $LOW_PORT_STATUS)"
else
  log_fail "Port below 1024 should be rejected (got HTTP $LOW_PORT_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Reconfigure: request body limit"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  BODY_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"maxBodySizeMb": 100}')
  assert_json_field "$BODY_RESPONSE" '.ok' 'true' "Body limit change returned ok: true" || true
  assert_json_field "$BODY_RESPONSE" '.tunnel.maxBodySizeMb' "100" "Tunnel request body limit is now 100 MB" || true

  VHOST_BODY=$(sudo cat "$VHOST_AVAILABLE" 2>/dev/null || echo "")
  assert_contains "$VHOST_BODY" "client_max_body_size 100m;" "Vhost rewritten with client_max_body_size 100m" || true
  assert_not_contains "$VHOST_BODY" "client_max_body_size 10m;" "Previous body limit removed from vhost" || true

  NGINX_TEST_BODY=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_BODY" "syntax is ok" "nginx -t passes after body limit change" || true

  BODY_ZERO_STATUS=$(api_patch_status "tunnels/$TUNNEL_ID" '{"maxBodySizeMb": 0}')
  assert_eq "$BODY_ZERO_STATUS" "400" "Body limit 0 rejected (HTTP 400)" || true

  BODY_HIGH_STATUS=$(api_patch_status "tunnels/$TUNNEL_ID" '{"maxBodySizeMb": 10241}')
  assert_eq "$BODY_HIGH_STATUS" "400" "Body limit 10241 rejected (HTTP 400)" || true

  BODY_FRACTION_STATUS=$(api_patch_status "tunnels/$TUNNEL_ID" '{"maxBodySizeMb": 1.5}')
  assert_eq "$BODY_FRACTION_STATUS" "400" "Fractional body limit rejected (HTTP 400)" || true

  BODY_AFTER_REJECT=$(api_get "tunnels" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .maxBodySizeMb' 2>/dev/null || echo "")
  assert_eq "$BODY_AFTER_REJECT" "100" "Rejected body limits left the tunnel unchanged" || true
else
  log_skip "Cannot reconfigure — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Reconfigure: access mode"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  MODE_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"accessMode": "public"}')
  assert_json_field "$MODE_RESPONSE" '.ok' 'true' "Access mode change returned ok: true" || true
  assert_json_field "$MODE_RESPONSE" '.tunnel.accessMode' "public" "Tunnel access mode is now public" || true

  VHOST_PUBLIC=$(sudo cat "$VHOST_AVAILABLE" 2>/dev/null || echo "")
  assert_not_contains "$VHOST_PUBLIC" "auth_request" "Public tunnel vhost has no auth_request gate" || true
  assert_contains "$VHOST_PUBLIC" "client_max_body_size 100m;" "Body limit kept across the access mode change" || true

  NGINX_TEST_MODE=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_MODE" "syntax is ok" "nginx -t passes after access mode change" || true

  BAD_MODE_STATUS=$(api_patch_status "tunnels/$TUNNEL_ID" '{"accessMode": "open"}')
  assert_eq "$BAD_MODE_STATUS" "400" "Unknown access mode rejected (HTTP 400)" || true
else
  log_skip "Cannot reconfigure — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Disable tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  PID_BEFORE_DISABLE=$(chisel_pid)
  TOGGLE_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"enabled": false}')
  assert_json_field "$TOGGLE_RESPONSE" '.ok' 'true' "Tunnel disable returned ok: true" || true
  if [ "$PINNED_CHISEL" = "true" ]; then
    if chisel_restarted_since "$PID_BEFORE_DISABLE"; then
      log_pass "Revoked grant (disable) restarted chisel"
    else
      log_fail "Chisel not restarted after a grant was revoked by disabling the tunnel"
    fi
  fi

  # Verify tunnel shows as disabled in list
  LIST_DISABLED=$(api_get "tunnels")
  ENABLED_STATE=$(echo "$LIST_DISABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
  assert_eq "$ENABLED_STATE" "false" "Tunnel shows as disabled in list" || true

  # Verify nginx vhost symlink removed (disabled = no symlink in sites-enabled)
  if [ ! -L "$VHOST_PATH" ] && [ ! -f "$VHOST_PATH" ]; then
    log_pass "Nginx sites-enabled symlink removed for disabled tunnel"
  else
    log_fail "Nginx sites-enabled symlink still exists for disabled tunnel"
  fi

  # Verify nginx config still valid
  NGINX_TEST_DISABLED=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_DISABLED" "syntax is ok" "nginx -t passes after tunnel disable" || true

  # A disabled tunnel grants its port to nobody and is absent from the owner's config
  DISABLED_GRANTS=$(chisel_grants "$OWNER_LABEL")
  assert_not_contains "$DISABLED_GRANTS" "$GRANT_PATTERN" "Chisel grant removed while the tunnel is disabled" || true

  DISABLED_CONFIG_PORT=$(api_get "tunnels/agent-config?agent=${OWNER_LABEL}" | jq -r --arg sd "$TEST_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
  assert_eq "$DISABLED_CONFIG_PORT" "" "Disabled tunnel is not in the owner's agent-config" || true

  # Reconfiguring a disabled tunnel rewrites its vhost but keeps it disabled
  DISABLED_BODY_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"maxBodySizeMb": 50}')
  assert_json_field "$DISABLED_BODY_RESPONSE" '.tunnel.maxBodySizeMb' "50" "Body limit changed on a disabled tunnel" || true
  assert_json_field "$DISABLED_BODY_RESPONSE" '.tunnel.enabled' "false" "Tunnel stays disabled after reconfiguration" || true
  VHOST_DISABLED_BODY=$(sudo cat "$VHOST_AVAILABLE" 2>/dev/null || echo "")
  assert_contains "$VHOST_DISABLED_BODY" "client_max_body_size 50m;" "Disabled tunnel's vhost rewritten with 50m" || true
  if [ ! -L "$VHOST_PATH" ] && [ ! -f "$VHOST_PATH" ]; then
    log_pass "Reconfiguration did not re-enable the disabled tunnel's vhost"
  else
    log_fail "Reconfiguration re-enabled the disabled tunnel's vhost"
  fi
else
  log_skip "Cannot disable — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Re-enable tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  PID_BEFORE_ENABLE=$(chisel_pid)
  ENABLE_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"enabled": true}')
  assert_json_field "$ENABLE_RESPONSE" '.ok' 'true' "Tunnel re-enable returned ok: true" || true
  if [ "$PINNED_CHISEL" = "true" ]; then
    assert_eq "$(chisel_pid)" "$PID_BEFORE_ENABLE" "Restored grant hot-reloaded: chisel not restarted by the re-enable" || true
  fi

  # Verify tunnel shows as enabled in list
  LIST_ENABLED=$(api_get "tunnels")
  ENABLED_STATE2=$(echo "$LIST_ENABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
  assert_eq "$ENABLED_STATE2" "true" "Tunnel shows as enabled in list" || true

  # Verify nginx vhost symlink restored
  if [ -L "$VHOST_PATH" ] || [ -f "$VHOST_PATH" ]; then
    log_pass "Nginx vhost restored for re-enabled tunnel"
  else
    log_fail "Nginx vhost not restored for re-enabled tunnel"
  fi

  # Verify nginx config still valid
  NGINX_TEST_ENABLED=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_ENABLED" "syntax is ok" "nginx -t passes after tunnel re-enable" || true

  # Verify the owner's chisel grant is back
  ENABLED_GRANTS=$(chisel_grants "$OWNER_LABEL")
  assert_contains "$ENABLED_GRANTS" "$GRANT_PATTERN" "Chisel grant restored for the re-enabled tunnel" || true
else
  log_skip "Cannot re-enable — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Reassign tunnel to another agent"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  PID_BEFORE_REASSIGN=$(chisel_pid)
  REASSIGN_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" "{\"agentLabel\": \"${OTHER_LABEL}\"}")
  assert_json_field "$REASSIGN_RESPONSE" '.ok' 'true' "Tunnel reassignment returned ok: true" || true
  if [ "$PINNED_CHISEL" = "true" ]; then
    if chisel_restarted_since "$PID_BEFORE_REASSIGN"; then
      log_pass "Reassignment (a revocation for the previous owner) restarted chisel"
    else
      log_fail "Chisel not restarted after the tunnel moved to another agent"
    fi
  fi
  assert_json_field "$REASSIGN_RESPONSE" '.tunnel.agentLabel' "$OTHER_LABEL" "Tunnel is now owned by the second agent" || true

  # The grant moves with the tunnel in the same chisel sync
  MOVED_TO=$(chisel_grants "$OTHER_LABEL")
  assert_contains "$MOVED_TO" "$GRANT_PATTERN" "Chisel grant moved to the new owner" || true
  MOVED_FROM=$(chisel_grants "$OWNER_LABEL")
  assert_not_contains "$MOVED_FROM" "$GRANT_PATTERN" "Chisel grant removed from the previous owner" || true
  MOVED_HOLDERS=$(chisel_grant_holders "$GRANT_PATTERN")
  assert_eq "$MOVED_HOLDERS" "1" "Still exactly one chisel user holds the grant" || true

  NEW_OWNER_PORT=$(api_get "tunnels/agent-config?agent=${OTHER_LABEL}" | jq -r --arg sd "$TEST_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
  assert_eq "$NEW_OWNER_PORT" "$TEST_PORT" "New owner's agent-config lists the tunnel" || true
  OLD_OWNER_PORT=$(api_get "tunnels/agent-config?agent=${OWNER_LABEL}" | jq -r --arg sd "$TEST_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
  assert_eq "$OLD_OWNER_PORT" "" "Previous owner's agent-config no longer lists the tunnel" || true

  # Reassigning to an agent that is not enrolled is rejected and changes nothing
  REASSIGN_UNKNOWN_STATUS=$(api_patch_status "tunnels/$TUNNEL_ID" "{\"agentLabel\": \"${UNKNOWN_LABEL}\"}")
  assert_eq "$REASSIGN_UNKNOWN_STATUS" "400" "Reassignment to an unknown agent rejected (HTTP 400)" || true
  OWNER_AFTER_REJECT=$(api_get "tunnels" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .agentLabel' 2>/dev/null || echo "")
  assert_eq "$OWNER_AFTER_REJECT" "$OTHER_LABEL" "Rejected reassignment left the owner unchanged" || true
else
  log_skip "Cannot reassign — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "One PATCH: owner, access mode, body limit and enabled together"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  # Applied as one workflow under the tunnel lock: the owner first, then the
  # vhost settings, then enabled
  COMBINED_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" "{\"agentLabel\": \"${OWNER_LABEL}\", \"accessMode\": \"authenticated\", \"maxBodySizeMb\": 25, \"enabled\": false}")
  assert_json_field "$COMBINED_RESPONSE" '.ok' 'true' "Combined PATCH returned ok: true" || true
  assert_json_field "$COMBINED_RESPONSE" '.tunnel.agentLabel' "$OWNER_LABEL" "Combined PATCH moved the tunnel back to ${OWNER_LABEL}" || true
  assert_json_field "$COMBINED_RESPONSE" '.tunnel.accessMode' "authenticated" "Combined PATCH set the access mode" || true
  assert_json_field "$COMBINED_RESPONSE" '.tunnel.maxBodySizeMb' "25" "Combined PATCH set the body limit" || true
  assert_json_field "$COMBINED_RESPONSE" '.tunnel.enabled' "false" "Combined PATCH disabled the tunnel" || true

  COMBINED_VHOST=$(sudo cat "$VHOST_AVAILABLE" 2>/dev/null || echo "")
  assert_contains "$COMBINED_VHOST" "client_max_body_size 25m;" "Vhost rewritten with the new body limit" || true
  assert_contains "$COMBINED_VHOST" "auth_request" "Vhost rewritten for the authenticated access mode" || true
  if [ ! -L "$VHOST_PATH" ] && [ ! -f "$VHOST_PATH" ]; then
    log_pass "Combined PATCH left the vhost disabled"
  else
    log_fail "Combined PATCH left the vhost enabled although it disabled the tunnel"
  fi
  COMBINED_HOLDERS=$(chisel_grant_holders "$GRANT_PATTERN")
  assert_eq "$COMBINED_HOLDERS" "0" "Disabled tunnel's port granted to nobody after the combined PATCH" || true

  NGINX_TEST_COMBINED=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_COMBINED" "syntax is ok" "nginx -t passes after the combined PATCH" || true

  REENABLE_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"enabled": true}')
  assert_json_field "$REENABLE_RESPONSE" '.tunnel.enabled' "true" "Tunnel re-enabled after the combined PATCH" || true
  REENABLED_GRANTS=$(chisel_grants "$OWNER_LABEL")
  assert_contains "$REENABLED_GRANTS" "$GRANT_PATTERN" "Owner granted the port again" || true
else
  log_skip "Cannot run the combined PATCH — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Revoking the owning agent releases the tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  REVOKE_RESPONSE=$(api_delete "certs/agent/${OWNER_LABEL}")
  assert_json_field "$REVOKE_RESPONSE" '.ok' 'true' "Owning agent ${OWNER_LABEL} revoked" || true

  # The tunnel keeps its hostname (reserved, dark) but has no owner, so a later
  # enrollment reusing the label inherits nothing
  RELEASED=$(api_get "tunnels" | jq -c --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id)' 2>/dev/null || echo "")
  assert_json_field "$RELEASED" '.subdomain' "$TEST_SUBDOMAIN" "Released tunnel still exists" || true
  assert_json_field "$RELEASED" '.agentLabel // "none"' "none" "Released tunnel has no owning agent" || true
  RELEASED_HOLDERS=$(chisel_grant_holders "$GRANT_PATTERN")
  assert_eq "$RELEASED_HOLDERS" "0" "Released tunnel's port is granted to no chisel user" || true
  REVOKED_USERS=$(chisel_user_count "agent-${OWNER_LABEL}:")
  assert_eq "$REVOKED_USERS" "0" "Revoked agent's chisel user removed from the authfile" || true
else
  log_skip "Cannot check tunnel release — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Toggle nonexistent tunnel"
# ---------------------------------------------------------------------------

FAKE_TOGGLE_STATUS=$(api_patch_status "tunnels/$FAKE_ID" '{"enabled": false}')
assert_eq "$FAKE_TOGGLE_STATUS" "404" "Toggle nonexistent tunnel returns 404" || true

# ---------------------------------------------------------------------------
log_section "Delete tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  DELETE_RESPONSE=$(api_delete "tunnels/$TUNNEL_ID")
  assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Tunnel deletion returned ok: true" || true

  # Verify tunnel is gone from list
  LIST_AFTER=$(api_get "tunnels")
  FOUND_AFTER=$(echo "$LIST_AFTER" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .id' 2>/dev/null || echo "")
  assert_eq "$FOUND_AFTER" "" "Tunnel no longer in list after deletion" || true

  # Verify vhost removed
  if [ ! -f "$VHOST_PATH" ]; then
    log_pass "Nginx vhost removed after tunnel deletion"
  else
    log_fail "Nginx vhost still exists after tunnel deletion"
  fi

  # Verify nginx config still valid
  NGINX_TEST_AFTER=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_AFTER" "syntax is ok" "nginx -t passes after tunnel deletion" || true

  # Verify no chisel user is granted the deleted tunnel's port
  DELETED_HOLDERS=$(chisel_grant_holders "$GRANT_PATTERN")
  assert_eq "$DELETED_HOLDERS" "0" "Chisel grant removed after tunnel deletion" || true

  TUNNEL_ID=""
else
  log_skip "Cannot delete — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Delete nonexistent tunnel"
# ---------------------------------------------------------------------------

NOT_FOUND_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X DELETE \
  "${BASE_URL}/api/tunnels/$FAKE_ID" 2>/dev/null || echo "000")
assert_eq "$NOT_FOUND_STATUS" "404" "Delete nonexistent tunnel returns 404" || true

end_test
