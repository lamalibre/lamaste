#!/usr/bin/env bash
# ============================================================================
# 59 — A trusted publisher scope: an app plugin of a second scope (Three-VM)
# ============================================================================
# The proof of trusted publisher scopes (packages/core/docs/
# trusted-publisher-scopes-design.md). An invented agent-hosted app plugin of
# a second first-party scope — @example/e2e-scoped-server, with its bundled
# agent half @example/e2e-scoped-agent (helpers.sh, write_app_install_fixture
# with FIXTURE_SCOPE) — goes the whole way:
#
# 1. Published to the development Feria (which must host @example —
#    `feria-server scopes add @example --any-publisher` on the Mac, Feria
#    0.5+); a scope it does not host is not accepted. The host VM fetches
#    both packages from it through the read-only bridge and the stand-in
#    Feria (the panel's registry credential) serves those very bytes.
# 2. The relay does not trust @example: installing is refused
#    (`untrusted_scope`), nothing is installed. Trusting it is refused while
#    the registry does not host the scope (`registry_lacks_scope`), then
#    allowed (audited, announced). The agent's sync records the relay's list.
# 3. Installed, approved, hosted on the agent VM through the app host helper
#    (protocol 3 — the one that takes any scope): the relay pinned and signed
#    a package of @example, and the agent fetched it through the brokered
#    credential, which routes @example to the registry. The forwarded admin
#    API answers from the installed version.
# 4. While the plugin is installed the scope cannot stop being trusted
#    (`scope_in_use`) and the registry credential cannot be cleared
#    (`trusted_scopes_need_registry`). Uninstalled with purge, the scope is
#    removed (audited) and the package is refused again.
#
# @lamalibre plugins are unaffected: specs 34–36 run the same path with the
# built-in scope in the same campaign.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"

require_commands multipass curl jq node npm tar perl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCOPE="@example"
PLUGIN="e2e-scoped"
SERVER_PACKAGE="${SCOPE}/e2e-scoped-server"
AGENT_PACKAGE="${SCOPE}/e2e-scoped-agent"
SERVICE_USER="lamaste-app-e2e-scoped"
POLICY_ID="e2e-scoped-59"
REMOTE_DIR="/var/tmp/e2e-59-trusted-scope"
# The development Feria, from this machine (its loopback) — the VMs reach it
# through the read-only bridge their npm configuration names.
DEV_FERIA_URL="${DEV_FERIA_URL:-http://127.0.0.1:4873}"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
CLEAN_TRUSTED_SCOPES=""
PURGE_PACKAGES=""

begin_test "59 — A trusted publisher scope: an app plugin of a second scope (Three-VM)"

# drop_dev_feria_fixtures — remove this spec's fixture packages from the
# development Feria, so every run publishes its own 1.0.0 and none is left behind.
drop_dev_feria_fixtures() {
  local dir
  for dir in server agent; do
    curl -s --max-time 10 -o /dev/null -X DELETE -H "Authorization: Bearer feria-dev" \
      "${DEV_FERIA_URL}/api/packages/${SCOPE}/e2e-scoped-${dir}" || true
  done
}

cleanup() {
  log_info "Cleaning up test resources..."
  app_plugin_cleanup
  drop_dev_feria_fixtures
}
trap cleanup EXIT

trusted_scopes() { host_api_get "settings/trusted-scopes"; }
# scope_audit_count <action> — this run's audit entries of <action> for SCOPE
# (trust changes name no plugin)
scope_audit_count() {
  host_api_get "audit?action=$1&limit=200" | jq "[.entries[]? | select(.id > ${AUDIT_BASE}) | select(.details.scope == \"${SCOPE}\")] | length" 2>/dev/null || echo "0"
}
stub_config() {
  host_exec "curl -s --max-time 15 -X POST -H 'Authorization: Bearer ${STUB_ADMIN_TOKEN}' -H 'Content-Type: application/json' -d '$1' http://127.0.0.1:${STUB_PORT}/-/e2e/config"
}

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
BEFORE=$(trusted_scopes)
assert_json_field "$BEFORE" '.builtIn' '@lamalibre' "The built-in trusted scope is @lamalibre" || true
if [ "$(json_get "$BEFORE" ".additional | index(\"${SCOPE}\") != null")" = "true" ]; then
  log_fail "${SCOPE} is already trusted on this relay — a previous run left it behind"
  end_test
  exit $?
fi
log_pass "${SCOPE} is not trusted on this relay"

# ===========================================================================
# 1. Published to the development Feria; the stand-in serves those bytes
# ===========================================================================

log_section "Published to the development Feria"

DEV_SCOPES=$(curl -s --max-time 10 "${DEV_FERIA_URL}/-/feria/scopes" || echo '{}')
if [ "$(json_get "$DEV_SCOPES" "[.scopes[]? | select(.scope == \"${SCOPE}\" and (.retired // false) == false)] | length")" != "1" ]; then
  log_fail "The development Feria at ${DEV_FERIA_URL} does not host ${SCOPE} (feria-server scopes add ${SCOPE} --any-publisher, Feria 0.5+): ${DEV_SCOPES}"
  end_test
  exit $?
fi
log_pass "The development Feria hosts ${SCOPE} ($(json_get "$DEV_SCOPES" '[.scopes[].scope] | join(", ")'))"

LOCAL_TMP=$(mktemp -d /tmp/e2e-59-trusted-scope-XXXXXXXX)
if ! FIXTURE_SCOPE="${SCOPE}" write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v1" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]'; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} and its bundled agent half ${AGENT_PACKAGE} 1.0.0"

# An isolated userconfig naming only the development Feria: no other
# registry, and no token of this machine's own ~/.npmrc, is ever used.
printf '%s:registry=%s/\n@other-e2e:registry=%s/\n//%s/:_authToken=feria-dev\n' \
  "${SCOPE}" "${DEV_FERIA_URL}" "${DEV_FERIA_URL}" "${DEV_FERIA_URL#http://}" > "${LOCAL_TMP}/npmrc"
drop_dev_feria_fixtures
for dir in server agent; do
  OUT=$(NPM_CONFIG_USERCONFIG="${LOCAL_TMP}/npmrc" npm publish "${LOCAL_TMP}/ship/fixtures/v1/${dir}" --access public --ignore-scripts 2>&1 || true)
  assert_contains "$OUT" "+ ${SCOPE}/e2e-scoped-${dir}@1.0.0" "npm publish ${SCOPE}/e2e-scoped-${dir}@1.0.0 to the development Feria" || true
done
# A scope the registry does not host is not stored there (Feria proxies it).
mkdir -p "${LOCAL_TMP}/unhosted"
printf '{ "name": "@other-e2e/x", "version": "1.0.0" }\n' > "${LOCAL_TMP}/unhosted/package.json"
OUT=$(NPM_CONFIG_USERCONFIG="${LOCAL_TMP}/npmrc" npm publish "${LOCAL_TMP}/unhosted" --access public --ignore-scripts 2>&1 || true)
if echo "$OUT" | grep -q '+ @other-e2e/x@1.0.0'; then
  log_fail "The development Feria accepted a package of a scope it does not host"
else
  log_pass "A package of a scope the development Feria does not host is not accepted"
fi

# The probe that reads the agent half's unit and process on the agent VM.
ship_agent_facts_probe

# The bytes the stand-in serves are the ones published to Feria: fetched on
# the host VM through the bridge.
# shellcheck disable=SC2119 # no fixture directories: the packages come from Feria
start_stand_in_feria
VM_FERIA=$(host_exec "npm config get @lamalibre:registry 2>/dev/null" 2>/dev/null | tr -d '\r' | sed 's#/$##')
assert_contains "$VM_FERIA" "http" "The VMs reach the development Feria at ${VM_FERIA}" || true
for pkg in "${SERVER_PACKAGE}" "${AGENT_PACKAGE}"; do
  PACK=$(host_exec "mkdir -p ${REMOTE_DIR}/from-feria && cd ${REMOTE_DIR}/from-feria && npm pack ${pkg}@1.0.0 --${SCOPE}:registry=${VM_FERIA}/ --json 2>/dev/null" 2>/dev/null || echo '[]')
  FILE=$(json_get "$PACK" '.[0].filename')
  FROM_FERIA=$(json_get "$PACK" '.[0].integrity')
  PUT=$(host_exec "curl -s --max-time 30 -X PUT -H 'Authorization: Bearer ${STUB_ADMIN_TOKEN}' --data-binary @${REMOTE_DIR}/from-feria/${FILE} http://127.0.0.1:${STUB_PORT}/-/e2e/packages")
  assert_json_field "$PUT" '.name' "${pkg}" "${pkg}@1.0.0 fetched from the development Feria and served by the stand-in" || true
  assert_json_field "$PUT" '.integrity' "${FROM_FERIA}" "…byte for byte (integrity ${FROM_FERIA:0:20}…)" || true
done
PINNED=$(feria_integrity "${AGENT_PACKAGE}" 1.0.0)

# ===========================================================================
# 2. Not trusted: refused. Trusted only while the registry hosts the scope.
# ===========================================================================

log_section "Not trusted: the install is refused"

REFUSED=$(host_api_call POST "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_eq "$(status_of "$REFUSED")" "400" "Installing ${SERVER_PACKAGE} on a relay that does not trust ${SCOPE} is refused (400)" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'untrusted_scope' "…untrusted_scope" || true
assert_eq "$(host_api_get_status "plugins/${PLUGIN}")" "404" "…and nothing is installed" || true
for lookalike in '@lamalibre-evil/e2e-scoped-server' '@LamaLibre/e2e-scoped-server'; do
  REFUSED=$(host_api_call POST "plugins/install" "{\"packageName\":\"${lookalike}\"}")
  assert_eq "$(status_of "$REFUSED")" "400" "A look-alike of the built-in scope (${lookalike}) is refused" || true
done

log_section "Trusting the scope: only while the registry hosts it"

stub_config '{"hostedScopes":["@lamalibre"]}' > /dev/null
REFUSED=$(host_api_call POST "settings/trusted-scopes" "{\"scope\":\"${SCOPE}\"}")
assert_eq "$(status_of "$REFUSED")" "409" "Trusting ${SCOPE} while the registry does not host it is refused (409)" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'registry_lacks_scope' "…registry_lacks_scope" || true

stub_config "{\"hostedScopes\":[\"@lamalibre\",\"${SCOPE}\"]}" > /dev/null
# Notifications outlive a run: count only those after this one.
NOTE_BASE=$(host_api_get "notifications?limit=1" | jq ".notifications[0].id // 0" 2>/dev/null || echo "0")
ADD_OUT=$(timed_exec 60 multipass exec "${HOST_VM}" -- sudo bash -c "lamaste-server trusted-scopes add ${SCOPE} --json 2>&1")
CLEAN_TRUSTED_SCOPES="${SCOPE}"
ADD_JSON=$(echo "$ADD_OUT" | grep -E '^\{' | tail -n 1 || echo '{}')
assert_json_field "$ADD_JSON" '.effective | join(",")' "@lamalibre,${SCOPE}" "lamaste-server trusted-scopes add ${SCOPE} ($(echo "$ADD_OUT" | tail -c 160))" || true
assert_json_field "$(trusted_scopes)" '.additional | join(",")' "${SCOPE}" "GET /api/settings/trusted-scopes lists it" || true
assert_eq "$(scope_audit_count settings.trusted-scope.added)" "1" "Audit: settings.trusted-scope.added" || true
NOTE=$(host_api_get "notifications" | jq -c "[.notifications[]? | select(.id > ${NOTE_BASE}) | select(.message | contains(\"${SCOPE} is now a trusted publisher scope\"))] | length" 2>/dev/null || echo 0)
assert_eq "$NOTE" "1" "The administrators are told" || true

agent_trusts_scope() {
  nudge_sync
  [ "$(agent_exec "jq -r '(.trustedScopes // []) | join(\",\")' ${AGENT_DIR}/config.json" 2>/dev/null)" = "@lamalibre,${SCOPE}" ]
}
if wait_for 120 agent_trusts_scope; then
  log_pass "The agent's sync recorded the relay's list: @lamalibre,${SCOPE}"
else
  log_fail "The agent did not record ${SCOPE}: $(agent_exec "jq -c '.trustedScopes' ${AGENT_DIR}/config.json" 2>/dev/null)"
fi

# ===========================================================================
# 3. Installed, approved and hosted on the agent VM
# ===========================================================================

log_section "Installed from the trusted scope; the agent half pinned"

host_exec "rm -rf /etc/lamalibre/lamaste/.npm/_cacache" > /dev/null 2>&1 || true
INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.packageName' "${SERVER_PACKAGE}" "Installed ${SERVER_PACKAGE}@1.0.0" || true
assert_json_field "$INSTALL" '.plugin.name' "${PLUGIN}" "…the plugin ${PLUGIN}, named by its route" || true
assert_json_field "$INSTALL" '.hooks.agentHalf.package' "${AGENT_PACKAGE}" "Its agent half is ${AGENT_PACKAGE}" || true
assert_json_field "$INSTALL" '.hooks.agentHalf.integrity' "${PINNED}" "…pinned at the integrity the registry publishes" || true
DIGEST=$(json_get "$INSTALL" '.hooks.approval.digest // empty')
APPROVE=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVE" '.hooks.approval.state' 'approved' "Approved" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null

log_section "Hosted through the app host helper (protocol 3)"

ensure_app_host_helper
assert_json_field "$(agent_host_facts)" '.apphost.version' '3' "Host facts: the helper speaks protocol 3 (any trusted scope)" || true
ELIGIBILITY=$(host_api_get "plugins/${PLUGIN}/hosting/eligibility" | jq -c ".agents[]? | select(.label == \"${HOST_AGENT_LABEL}\")" 2>/dev/null || echo '{}')
assert_json_field "$ELIGIBILITY" '"\(.eligible) \(.reasons | length)"' 'true 0' "Eligibility: ${HOST_AGENT_LABEL} can host it" || true

open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'
assert_json_field "${PUSH_WINDOW_RESPONSE}" '.pushInstallPolicy' "${POLICY_ID}" "The agent's window is open, under a policy naming ${AGENT_PACKAGE}" || true
HOSTED=$(host_api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
OP_ID=$(json_get "$HOSTED" '.operation.id // empty')
if [ -z "$OP_ID" ]; then
  log_fail "Hosting did not start: ${HOSTED}"
  end_test
  exit $?
fi
OP=$(wait_operation "${PLUGIN}" "${OP_ID}" 360 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The hosting operation succeeded ($(json_get "$OP" '.error // ""'))" || true
assert_eq "$(step_status "$OP" 'install the agent half')" "done" "Step: install the agent half" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.unit.props.ActiveState' 'active' "The agent half runs on the agent VM" || true
assert_json_field "$FACTS" '.unit.processUser' "${SERVICE_USER}" "…as ${SERVICE_USER}" || true
OWNER=$(agent_exec "cat /var/lib/lamalibre/apps/.owners/${PLUGIN}.json" 2>/dev/null || echo '{}')
assert_json_field "$OWNER" '.package' "${AGENT_PACKAGE}" "The app host helper records ${AGENT_PACKAGE} as the route's owner" || true
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '"\(.pong) \(.version) \(.user)"' "true 1.0.0 ${SERVICE_USER}" "GET /api/${PLUGIN}/ping reaches the installed version through the tunnel" || true

REQUESTS=$(stub_get "-/e2e/requests" | jq -r "[.requests[]? | select(.method == \"GET\" and (.path | endswith(\"/e2e-scoped-agent-1.0.0.tgz\")) and .status == 200) | .owner] | unique | join(\",\")" 2>/dev/null || echo "")
assert_eq "$REQUESTS" "agent:${HOST_AGENT_LABEL}" "The agent pulled ${AGENT_PACKAGE} from the relay's registry with its brokered token (${SCOPE} routed there)" || true

# ===========================================================================
# 4. In use: not removable; uninstalled: removed, refused again
# ===========================================================================

log_section "In use: the scope stays trusted, the registry stays configured"

REFUSED=$(host_api_call DELETE "settings/trusted-scopes/%40${SCOPE#@}")
assert_eq "$(status_of "$REFUSED")" "409" "Removing ${SCOPE} while its plugin is installed is refused (409)" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'scope_in_use' "…scope_in_use" || true
assert_json_field "$(body_of "$REFUSED")" '.plugins | join(",")' "${SERVER_PACKAGE}" "…naming ${SERVER_PACKAGE}" || true
REFUSED=$(host_api_call DELETE "registry-credential")
assert_eq "$(status_of "$REFUSED")" "409" "Clearing the registry credential while ${SCOPE} is trusted is refused (409)" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'trusted_scopes_need_registry' "…trusted_scopes_need_registry" || true

log_section "Uninstalled with purge; the scope removed and refused again"

host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null
UNINSTALL=$(host_api_delete "plugins/${PLUGIN}?purge=true")
UNINSTALL_ID=$(json_get "$UNINSTALL" '.operation.id // empty')
if [ -n "$UNINSTALL_ID" ]; then
  OP=$(wait_operation "${PLUGIN}" "${UNINSTALL_ID}" 300 nudge)
  assert_json_field "$OP" '.status' 'succeeded' "Uninstalled with purge ($(json_get "$OP" '.error // ""'))" || true
fi
gone() { [ "$(host_api_get_status "plugins/${PLUGIN}")" = "404" ]; }
if wait_for 60 gone; then
  log_pass "${PLUGIN} is gone from the relay"
else
  log_fail "${PLUGIN} is still installed"
fi
host_api_delete "plugins/push-install/policies/${POLICY_ID}" > /dev/null 2>&1 || true
PUSH_POLICY=""

REMOVED=$(host_api_call DELETE "settings/trusted-scopes/%40${SCOPE#@}")
assert_eq "$(status_of "$REMOVED")" "200" "${SCOPE} is no longer trusted" || true
assert_json_field "$(body_of "$REMOVED")" '.effective | join(",")' '@lamalibre' "…@lamalibre alone again" || true
CLEAN_TRUSTED_SCOPES=""
assert_eq "$(scope_audit_count settings.trusted-scope.removed)" "1" "Audit: settings.trusted-scope.removed" || true
REFUSED=$(host_api_call POST "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$(body_of "$REFUSED")" '.code' 'untrusted_scope' "Installing ${SERVER_PACKAGE} is refused again (untrusted_scope)" || true
agent_dropped_scope() {
  nudge_sync
  [ "$(agent_exec "jq -r '(.trustedScopes // []) | join(\",\")' ${AGENT_DIR}/config.json" 2>/dev/null)" = "@lamalibre" ]
}
if wait_for 120 agent_dropped_scope; then
  log_pass "The agent's sync dropped ${SCOPE}"
else
  log_fail "The agent still trusts ${SCOPE}: $(agent_exec "jq -c '.trustedScopes' ${AGENT_DIR}/config.json" 2>/dev/null)"
fi

end_test
