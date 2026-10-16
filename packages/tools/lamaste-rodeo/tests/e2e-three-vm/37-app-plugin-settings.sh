#!/usr/bin/env bash
# ============================================================================
# 37 — App plugin settings and secrets (Three-VM)
# ============================================================================
# Slice 4's proof. An app plugin whose manifest declares settings — fixture
# @lamalibre/e2e-apphost-cfg-server with its bundled agent package
# (helpers.sh, write_app_install_fixture … v1, then v2: settings_block_json)
# — is hosted on the agent VM from the panel as in spec 34; then:
#
# 1. Before anything is configured the panel says so: GET settings (read
#    live from the agent half) lists the fields, configured false, apiKey
#    missing and not set; the plugin list says it needs configuration; the
#    agent half has no settings files yet (hosting takes no settings).
# 2. Values that do not suit their fields are refused by the panel (400, a
#    message per field that never repeats the value; a setting the schema
#    does not know is counted, never named) without a call to the agent
#    half; a pattern — which the panel never runs — is refused by the agent
#    half (422).
# 3. A secret set through the API — from a 0600 file on the host VM, never
#    an argument — reaches the agent half, which proves it holds it by the
#    digest of what it holds, and reads back as { set: true, setAt }. A
#    stale revision is 409; /api/<route>/settings through the forwarder is
#    404, reserved for Lamaste.
# 4. The same through `lamaste-server plugins configure --secrets-stdin`
#    (with --set and --clear; --set on a secret refused), while every
#    process's arguments and environment are sampled.
# 5. On the agent VM settings.json and secrets.json are 0600 and the
#    account's; the secret is in secrets.json and nowhere else.
# 6. An update to 2.0.0 previews the typed schema change (retries retyped
#    integer to string, endpoint added as a required string, no secret made
#    plain); after it the retyped value is dropped — the new default
#    applies, never a conversion — the plugin needs configuration until
#    endpoint is filled, and the secret stays.
# 7. Unhosting keeps the settings with the agent half's data; hosting again
#    brings them back as they were.
# 8. The test secrets are nowhere on the relay: not in state.db (dumped), in
#    any file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre,
#    /var/log, /tmp or /run, in the journal since the spec started, in any
#    API response it read (the audit log among them) or in a process
#    argument.
# 9. An update to 3.0.0 turns apiKey from a secret into a plain field: with
#    the plugin's auto-approve on, it is staged and waits all the same
#    (secretToPlain, auto-approve withheld and audited), 2.0.0 and the
#    secret stay; approved, it applies: the agent half drops the secret,
#    apiKey reads as a plain field without a value and the plugin needs
#    configuration, and the relay holds the old secret nowhere.
# 10. Uninstalling with purge removes the settings on both sides.
#
# A test secret exists only on the host VM (app-plugin-harness.sh,
# "Settings"); the spec compares digests and counts, and never prints one.
# The hosting agent going offline is spec 38.
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

PLUGIN="e2e-apphost-cfg"
SERVER_PACKAGE="@lamalibre/e2e-apphost-cfg-server"
AGENT_PACKAGE="@lamalibre/e2e-apphost-cfg-agent"
SERVICE_USER="lamaste-app-e2e-apphost-cfg"
UNIT="lamalibre-app-e2e-apphost-cfg.service"
ENDPOINT="https://upstream.example.test/v1"
POLICY_ID="e2e-apphost-37"
REMOTE_DIR="/var/tmp/e2e-37-app-plugin"
PRIV="${REMOTE_DIR}/private"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""

# health_up — the relay's health of the hosting is up
health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }

# half_settings_lines <epoch> <extended regex> — how many lines of the agent
# half's journal since then match (its settings calls and changes)
half_settings_lines() {
  unit_journal_since "${UNIT}" "$1" | grep -cE "$2" || true
}

begin_test "37 — App plugin settings and secrets (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  app_plugin_cleanup
}
trap cleanup EXIT

# The journal is scanned from here on.
SPEC_START=$(host_exec "date +%s" 2>/dev/null || echo "0")

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
log_info "Hosting agent: ${HOST_AGENT_LABEL} (local name ${AGENT_LABEL}), relay domain ${DOMAIN}"

# ===========================================================================
# 1. Fixtures, the stand-in Feria, the test secrets
# ===========================================================================

log_section "Fixtures, the stand-in Feria and the test secrets"

LOCAL_TMP=$(mktemp -d /tmp/e2e-37-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v1" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' v1 || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v2" "${PLUGIN}" 2.0.0 main "${BUILD}" '[]' v2 || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v3" "${PLUGIN}" 3.0.0 main "${BUILD}" '[]' v3 || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixtures built: ${SERVER_PACKAGE} 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages"
write_settings_call_script "${LOCAL_TMP}/ship/settings-call.sh"
write_cli_sampled_script "${LOCAL_TMP}/ship/cli-sampled.sh"
ship_agent_facts_probe
ship_settings_facts_probe
start_stand_in_feria fixtures/v1/server fixtures/v1/agent fixtures/v2/server fixtures/v2/agent fixtures/v3/server fixtures/v3/agent
prepare_settings_priv
assert_eq "$(make_test_secret a)" "48" "Test secret A: 48 hex characters, made on the host VM in a 0600 file" || true
assert_eq "$(make_test_secret b)" "48" "Test secret B, for the CLI" || true
DIGEST_A=$(secret_digest a)
DIGEST_B=$(secret_digest b)
assert_not_eq "${DIGEST_A}" "${DIGEST_B}" "Their digests are known; the secrets never leave the host VM" || true
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","update","uninstall"]' > /dev/null

# ===========================================================================
# 2. Install and host 1.0.0
# ===========================================================================

log_section "Install and host 1.0.0"

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0 and approved its agent half" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The relay's health of the hosting is up"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi

# ===========================================================================
# 3. Before anything is configured
# ===========================================================================

log_section "Before anything is configured"

RESP=$(settings_api GET "plugins/${PLUGIN}/settings")
assert_eq "$(status_of "$RESP")" "200" "GET /api/plugins/${PLUGIN}/settings answers" || true
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '.fields | map(.key) | join(",")' 'apiKey,schedule,retries,region,verbose' "It lists the manifest's fields" || true
assert_json_field "$VIEW" '.fields | map(.type) | join(",")' 'secret,string,integer,enum,boolean' "…with their types" || true
assert_json_field "$VIEW" '.source' 'live' "…read live from the agent half" || true
assert_json_field_not_empty "$VIEW" '.syncedAt' "…which the relay synced at $(json_get "$VIEW" '.syncedAt')" || true
assert_json_field "$VIEW" '"\(.configured) \(.missing | join(","))"' 'false apiKey' "Not configured: apiKey is missing" || true
assert_json_field "$VIEW" '.values.apiKey | "\(.set) \(.setAt // "none")"' 'false none' "apiKey: { set: false }" || true
assert_json_field "$VIEW" '.values | "\(.schedule) \(.retries) \(.verbose) \(.region // "unset")"' '06:00 3 false unset' "The other fields show their defaults (region has none)" || true
assert_json_field "$VIEW" '.revision' '0' "Revision 0" || true
assert_json_field "$VIEW" '.hosting | "\(.agentLabel) \(.state)"' "${HOST_AGENT_LABEL} up" "The hosting: ${HOST_AGENT_LABEL}, up" || true
SUMMARY=$(settings_summary "${PLUGIN}")
assert_json_field "$SUMMARY" '"\(.configured) \(.missing | join(","))"' 'false apiKey' "GET /api/plugins: ${PLUGIN} needs configuration (apiKey)" || true
assert_json_field "$(body_of "$(settings_api GET "plugins/${PLUGIN}")")" '.plugin.settings.configured' 'false' "GET /api/plugins/${PLUGIN} says the same" || true
PROBE=$(settings_probe "${PLUGIN}")
assert_json_field "$PROBE" '"\(.schemaVersion) \(.revision) \(.configured)"' '1 0 false' "The agent half: schema 1, revision 0, not configured" || true
assert_json_field "$PROBE" '.secretDigests | length' '0' "…and it holds no secret" || true
FACTS=$(settings_facts "${PLUGIN}")
assert_json_field "$FACTS" '"\(.dataDir.type) \(.settings) \(.secrets)"' 'dir null null' "No settings.json or secrets.json yet: hosting takes no settings" || true

# ===========================================================================
# 4. Values that do not suit their fields
# ===========================================================================

log_section "Values that do not suit their fields are refused"

EPOCH=$(agent_epoch)
RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"e2e-colour-6b1d":"e2e-unknown-7f3a","apiKey":"e2e-misplaced-9b2e","retries":987654321,"region":"e2e-region-3f8a"}}')
assert_eq "$(status_of "$RESP")" "400" "Four values that do not suit their fields: 400" || true
BODY=$(body_of "$RESP")
assert_json_field "$BODY" '.errors._' '1 unknown setting' "A setting the schema does not know is counted under _: 1 unknown setting" || true
assert_json_field "$BODY" '.errors | keys | join(",")' '_,apiKey,region,retries' "…never named: the errors are keyed by the schema's fields and _ alone" || true
assert_json_field "$BODY" '.errors.apiKey' 'Is a secret; send it in secrets' "apiKey in values: Is a secret; send it in secrets" || true
assert_json_field "$BODY" '.errors.retries' 'Must be at most 10' "retries 987654321: Must be at most 10" || true
assert_json_field "$BODY" '.errors.region' 'Must be one of the options' "region: Must be one of the options" || true
for value in e2e-colour-6b1d e2e-unknown-7f3a e2e-misplaced-9b2e 987654321 e2e-region-3f8a; do
  assert_not_contains "$BODY" "$value" "The answer never repeats ${value}" || true
done

RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"schedule":"e2e-schedule-4d2c"}}')
assert_eq "$(status_of "$RESP")" "422" "A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)" || true
assert_json_field "$(body_of "$RESP")" '.errors.schedule' 'Does not match the required format' "schedule: Does not match the required format" || true
assert_not_contains "$(body_of "$RESP")" "e2e-schedule-4d2c" "…without repeating the value" || true
assert_eq "$(half_settings_lines "$EPOCH" '^settings PUT /admin/settings 422$')" "1" "The agent half was asked once — for the pattern" || true
assert_eq "$(half_settings_lines "$EPOCH" '^settings PUT ')" "1" "…and never for the values the panel refused" || true
assert_json_field "$(settings_probe "${PLUGIN}")" '"\(.revision) \(.configured)"' '0 false' "Nothing changed in the agent half" || true

# ===========================================================================
# 5. A secret set through the API
# ===========================================================================

log_section "A secret set through the API reaches the agent half alone"

EPOCH=$(agent_epoch)
BODY_FILE=$(secret_put_body a 0 '{"region":"eu"}')
RESP=$(settings_api_file PUT "plugins/${PLUGIN}/settings" "${BODY_FILE}")
host_exec "rm -f ${BODY_FILE}" > /dev/null 2>&1 || true
assert_eq "$(status_of "$RESP")" "200" "PUT /api/plugins/${PLUGIN}/settings with secret A, from a 0600 file on the host VM: 200" || true
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '"\(.revision) \(.configured) \(.missing | length)"' '1 true 0' "Revision 1, configured, nothing missing" || true
assert_json_field "$VIEW" '.values.apiKey | keys | join(",")' 'set,setAt' "The answer says when apiKey was set, and nothing else about it" || true
SET_AT_A=$(json_get "$VIEW" '.values.apiKey.setAt // empty')
VIEW=$(settings_view "${PLUGIN}")
assert_json_field "$VIEW" '"\(.values.apiKey.set) \(.values.apiKey.setAt)"' "true ${SET_AT_A}" "GET: apiKey { set: true, setAt: ${SET_AT_A} }" || true
assert_json_field "$VIEW" '"\(.source) \(.configured) \(.values.region)"' 'live true eu' "GET: live, configured, region eu" || true
PROBE=$(settings_probe "${PLUGIN}")
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_A}" "The agent half holds secret A: the SHA-256 of what it holds is secret A's" || true
assert_json_field "$PROBE" '"\(.revision) \(.configured) \(.values.region) \(.values.retries)"' '1 true eu 3' "…at revision 1, configured, region eu, retries still the default" || true
assert_eq "$(half_settings_lines "$EPOCH" '^settings revision=1 configured=true missing=-$')" "1" "It saw the change (onChange), logged without a value" || true
SUMMARY=$(settings_summary "${PLUGIN}")
assert_json_field "$SUMMARY" '"\(.configured) \(.missing | length)"' 'true 0' "GET /api/plugins: configured" || true
assert_eq "$(audit_count "${PLUGIN}" plugin.settings.updated '((.secretsSet // []) | index("apiKey")) != null and ((.changed // []) | index("region")) != null')" "1" "Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)" || true

log_section "A stale revision is refused; /admin/settings is not forwarded"

RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "409" "An update edited at revision 0, now 1: 409" || true
assert_json_field "$(body_of "$RESP")" '"\(.code) \(.revision)"' 'revision_mismatch 1' "…revision_mismatch, with the current revision" || true
EPOCH=$(agent_epoch)
for reserved in settings settings/reload Settings %73ettings; do
  assert_eq "$(host_api_get_status "${PLUGIN}/${reserved}")" "404" "GET /api/${PLUGIN}/${reserved} through the forwarder: 404" || true
done
assert_eq "$(status_of "$(host_api_call PUT "${PLUGIN}/settings" '{"schemaVersion":1,"baseRevision":1,"values":{"verbose":true},"secrets":{}}')")" "404" "PUT /api/${PLUGIN}/settings: 404 — no admin writes around the panel's checks" || true
assert_eq "$(status_of "$(host_api_call POST "${PLUGIN}/settings/reload" '{}')")" "404" "POST /api/${PLUGIN}/settings/reload: 404" || true
assert_eq "$(half_settings_lines "$EPOCH" '/admin/(settings|Settings|%73ettings)(/reload)? (caller=|40[0-9])')" "0" "The agent half saw none of them" || true
assert_json_field "$(settings_probe "${PLUGIN}")" '"\(.revision) \(.values.verbose)"' '1 false' "…and nothing changed" || true

# ===========================================================================
# 6. The CLI
# ===========================================================================

log_section "lamaste-server plugins configure --secrets-stdin, its arguments sampled"

STDIN_FILE=$(secret_stdin_body b)
CLI=$(cli_sampled "${STDIN_FILE}" plugins configure "${PLUGIN}" --secrets-stdin --set retries=7 --set region=us)
assert_eq "$(echo "$CLI" | head -n 1)" "0" "plugins configure ${PLUGIN} --secrets-stdin --set retries=7 --set region=us, secret B on stdin ($(echo "$CLI" | tail -n +2 | tail -c 200))" || true
assert_not_contains "$CLI" "held a test secret" "Its output holds no secret" || true
host_exec "rm -f ${STDIN_FILE}" > /dev/null 2>&1 || true
VIEW=$(settings_view "${PLUGIN}")
SET_AT_B=$(json_get "$VIEW" '.values.apiKey.setAt // empty')
assert_not_eq "${SET_AT_B}" "${SET_AT_A}" "apiKey was set again (${SET_AT_B})" || true
assert_json_field "$VIEW" '"\(.revision) \(.values.retries) \(.values.region)"' '2 7 us' "…in one update with retries 7 and region us (revision 2)" || true
assert_json_field "$(settings_probe "${PLUGIN}")" '.secretDigests.apiKey' "${DIGEST_B}" "The agent half holds secret B" || true

CLI=$(cli_sampled - plugins configure "${PLUGIN}" --clear region)
assert_eq "$(echo "$CLI" | head -n 1)" "0" "plugins configure ${PLUGIN} --clear region ($(echo "$CLI" | tail -n +2 | tail -c 200))" || true
assert_json_field "$(settings_view "${PLUGIN}")" '"\(.revision) \(.values.region // "unset")"' '3 unset' "region is unset again, it has no default (revision 3)" || true

CLI=$(cli_sampled - plugins configure "${PLUGIN}" --set apiKey=e2e-not-on-a-command-line)
assert_not_eq "$(echo "$CLI" | head -n 1)" "0" "--set apiKey=… is refused: a secret is never taken from the command line" || true
assert_contains "$CLI" "secrets-stdin" "…the refusal points to --secrets-stdin" || true
assert_not_contains "$(echo "$CLI" | tail -n +2)" "e2e-not-on-a-command-line" "…without repeating the value" || true
assert_json_field "$(settings_view "${PLUGIN}")" '.revision' '3' "…and nothing changed" || true

CLI=$(cli_sampled - plugins settings "${PLUGIN}" --json)
assert_eq "$(echo "$CLI" | head -n 1)" "0" "plugins settings ${PLUGIN} --json" || true
CLI_JSON=$(echo "$CLI" | tail -n +2 | grep -E '^\{' | tail -n 1 || echo '{}')
assert_json_field "$CLI_JSON" 'first(.. | objects | select(has("apiKey")) | .apiKey | objects | .set) // null' 'true' "…shows apiKey set" || true
assert_not_contains "$CLI" "held a test secret" "…and no secret" || true

SAMPLES=$(cli_sample_report)
assert_json_field "$SAMPLES" '.samples >= 10' 'true' "Every process's arguments were sampled throughout ($(json_get "$SAMPLES" '.samples') samples)…" || true
assert_json_field "$SAMPLES" '.cli > 0' 'true' "…while lamaste-server configured the plugin ($(json_get "$SAMPLES" '.cli') lines)" || true
assert_json_field "$SAMPLES" '"\(.secretArgs) \(.secretCmdlines)"' '0 0' "No process had a test secret in its arguments — the CLI's curl included" || true
assert_json_field "$SAMPLES" '.secretEnv' '0' "…or in its environment" || true
assert_eq "$(audit_count "${PLUGIN}" plugin.settings.updated '((.secretsSet // []) | index("apiKey")) != null')" "2" "Audit: the CLI's update is recorded like the API's" || true

# ===========================================================================
# 7. On the agent VM
# ===========================================================================

log_section "On the agent VM: settings.json and secrets.json"

FACTS=$(settings_facts "${PLUGIN}")
assert_json_field "$FACTS" '.settings.file | "\(.mode) \(.user):\(.group) \(.type)"' "600 ${SERVICE_USER}:${SERVICE_USER} file" "settings.json: 0600, the account's" || true
assert_json_field "$FACTS" '.secrets.file | "\(.mode) \(.user):\(.group) \(.type)"' "600 ${SERVICE_USER}:${SERVICE_USER} file" "secrets.json: 0600, the account's" || true
assert_json_field "$FACTS" '.secrets.keys | join(",")' 'apiKey' "secrets.json holds apiKey…" || true
assert_json_field "$FACTS" '.secrets.digests.apiKey' "${DIGEST_B}" "…whose value is secret B (by digest)" || true
assert_json_field "$FACTS" '"\(.settings.revision) \(.settings.values | keys | join(","))"' '3 retries' "settings.json: revision 3, the values set — retries; region was cleared — and no apiKey" || true
assert_json_field "$FACTS" '.settings.values.retries | "\(.type) \(.value)"' 'integer 7' "…retries recorded with its type: integer 7" || true
assert_json_field "$FACTS" '"\(.secretElsewhere.settingsFile) \(.secretElsewhere.dataDir)"' '0 0' "The secret is in no other file of the data directory, settings.json included" || true
assert_json_field "$FACTS" '"\(.secretElsewhere.configDir) \(.secretElsewhere.codeDir)"' '0 0' "…nor in the agent half's config or code" || true
assert_json_field "$FACTS" '.secretElsewhere.agentDir' '0' "…nor in the agent's own state and logs: it never went through the agent's sync" || true
assert_json_field "$FACTS" '.secretElsewhere.journal' '0' "…nor in the agent VM's journal" || true

# ===========================================================================
# 8. Update to 2.0.0
# ===========================================================================

log_section "Update to 2.0.0: the schema change previewed, a retyped value dropped"

UPDATE=$(host_api_post "plugins/${PLUGIN}/update" '{"version":"2.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '2.0.0' "2.0.0 waits for approval: its agent half changed" || true
assert_json_field "$UPDATE" '.pendingUpdate.settings.retyped | map("\(.key):\(.from)->\(.to)") | join(",")' 'retries:integer->string' "Preview: retries is retyped, integer to string — its value will be dropped" || true
assert_json_field "$UPDATE" '.pendingUpdate.settings.newRequired | join(",")' 'endpoint' "Preview: endpoint becomes required" || true
assert_json_field "$UPDATE" '"\(.pendingUpdate.settings.added | map("\(.key):\(.type)") | join(",")) \(.pendingUpdate.settings.removed | length)"' 'endpoint:string 0' "Preview: endpoint added (a string), nothing removed" || true
assert_json_field "$UPDATE" '.pendingUpdate.settings.secretToPlain | length' '0' "Preview: no secret becomes a plain field" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.pendingUpdate.settings.retyped | map(.key) | join(",")' 'retries' "GET /api/plugins/${PLUGIN}/hooks shows the same preview" || true
APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$APPROVED" '.operation.id // empty')" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The update succeeded ($(json_get "$OP" '.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The hosting is up on 2.0.0"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
VIEW=$(settings_view "${PLUGIN}")
assert_json_field "$VIEW" '.fields | map(.key) | join(",")' 'apiKey,schedule,retries,region,verbose,endpoint' "GET: the fields of 2.0.0" || true
assert_json_field "$VIEW" '"\(.configured) \(.missing | join(","))"' 'false endpoint' "It needs configuration again: endpoint is missing" || true
assert_json_field "$VIEW" '.values.retries | "\(type) \(.)"' 'string 3' "retries is the string \"3\", 2.0.0's default: the stored 7 was dropped, not converted" || true
assert_json_field "$VIEW" '"\(.values.apiKey.set) \(.values.apiKey.setAt)"' "true ${SET_AT_B}" "The secret stays set, as it was" || true
assert_json_field "$(settings_summary "${PLUGIN}")" '"\(.configured) \(.missing | join(","))"' 'false endpoint' "GET /api/plugins: needs configuration (endpoint)" || true
PROBE=$(settings_probe "${PLUGIN}")
assert_json_field "$PROBE" '"\(.schemaVersion) \(.revision)"' '2 3' "The agent half: schema 2, revision 3 — the update changed no value an admin set" || true
assert_json_field "$PROBE" '.stored | has("retries")' 'false' "It dropped the retyped value from its store" || true
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_B}" "…and kept secret B" || true
FACTS=$(settings_facts "${PLUGIN}")
assert_json_field "$FACTS" '"\(.settings.schemaVersion) \(.settings.values | has("retries"))"' '2 false' "settings.json on the agent VM: schema 2, no retries" || true

REVISION=$(json_get "$VIEW" '.revision')
RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" "{\"revision\":${REVISION:-0},\"values\":{\"endpoint\":\"${ENDPOINT}\"}}")
assert_eq "$(status_of "$RESP")" "200" "endpoint filled in" || true
assert_json_field "$(body_of "$RESP")" '"\(.configured) \(.revision) \(.values.endpoint)"' "true 4 ${ENDPOINT}" "…configured again (revision 4)" || true

# ===========================================================================
# 9. Unhost keeps the settings; hosting again brings them back
# ===========================================================================

log_section "Unhosting keeps the settings; hosting again brings them back"

UNHOST=$(host_api_delete "plugins/${PLUGIN}/hosting")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNHOST" '.operation.id // empty')" 240 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Unhosted, the data kept ($(json_get "$OP" '.error // ""'))" || true
FACTS=$(settings_facts "${PLUGIN}")
assert_json_field "$FACTS" '"\(.settings.file.mode) \(.secrets.file.mode) \(.settings.revision)"' '600 600 4' "settings.json and secrets.json stay in the kept data directory" || true
assert_json_field "$FACTS" '.secrets.digests.apiKey' "${DIGEST_B}" "…secret B with them" || true
RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" '{"revision":4,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "503" "Not hosted: a change is refused (503)" || true
assert_json_field "$(body_of "$RESP")" '.code' 'hosting_offline' "…hosting_offline" || true

OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted again ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The hosting is up again"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
VIEW=$(settings_view "${PLUGIN}")
assert_json_field "$VIEW" '"\(.source) \(.revision) \(.configured)"' 'live 4 true' "Read live: revision 4, configured — the settings came back" || true
assert_json_field "$VIEW" '"\(.values.endpoint) \(.values.retries) \(.values.apiKey.setAt)"' "${ENDPOINT} 3 ${SET_AT_B}" "…the same values, the same secret" || true
assert_json_field "$(settings_probe "${PLUGIN}")" '.secretDigests.apiKey' "${DIGEST_B}" "The agent half holds secret B again" || true

# ===========================================================================
# 10. Nowhere on the relay
# ===========================================================================

log_section "The test secrets are nowhere on the relay"

settings_sweep "${PLUGIN}"
SCAN=$(relay_secret_scan "${PLUGIN}" "${SPEC_START}")
assert_json_field "$SCAN" '.files' '0' "No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one" || true
assert_json_field "$SCAN" '.filesControl > 0' 'true' "…a search that finds what is there ($(json_get "$SCAN" '.filesControl') files under /etc/lamalibre name the plugin)" || true
assert_json_field "$SCAN" '.stateDb' '0' "state.db, dumped, holds none" || true
assert_json_field "$SCAN" '"\(.stateDbLines > 0) \(.stateDbSettingsTable > 0)"' 'true true' "…a dump of $(json_get "$SCAN" '.stateDbLines') lines, plugin_settings in it" || true
assert_json_field "$SCAN" '.journal' '0' "The host's journal since the spec started holds none ($(json_get "$SCAN" '.journalLines') lines)" || true
assert_json_field "$SCAN" '.responses' '0' "No API answer the spec read holds one ($(json_get "$SCAN" '.responseCount') answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)" || true
ROW=$(settings_cache_row "${PLUGIN}")
assert_json_field "$ROW" '"\(.revision) \(.configured)"' '4 1' "The relay's cache (plugin_settings): revision 4, configured" || true
assert_json_field "$ROW" '"\(.secretKeys) \(.setAtTimestamps)"' 'apiKey 1' "…which keeps when apiKey was set, a timestamp" || true
assert_json_field "$ROW" '(.valueKeys // "") | split(",") | index("apiKey") == null' 'true' "…and no apiKey among its values" || true

# ===========================================================================
# 11. Update to 3.0.0: a secret becomes a plain field
# ===========================================================================

log_section "Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not"

AUTO=$(host_api_call PUT "plugins/${PLUGIN}/hooks/auto-approve" '{"enabled":true}')
assert_json_field "$(body_of "$AUTO")" '.autoApprove' 'true' "Auto-approve is on for ${PLUGIN}" || true
UPDATE=$(host_api_post "plugins/${PLUGIN}/update" '{"version":"3.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '3.0.0' "3.0.0 is staged and waits for approval, auto-approve on" || true
assert_json_field "$UPDATE" '.pendingUpdate.settings.secretToPlain | join(",")' 'apiKey' "Preview: apiKey turns from a secret into a plain field (secretToPlain)" || true
assert_json_field "$UPDATE" '.pendingUpdate.settings.retyped | map("\(.key):\(.from)->\(.to)") | join(",")' 'apiKey:secret->string' "…retyped secret to string" || true
assert_json_field "$UPDATE" '(.pendingUpdate.autoApproveWithheld // []) | length > 0' 'true' "Auto-approve withheld: $(json_get "$UPDATE" '(.pendingUpdate.autoApproveWithheld // []) | join("; ")')" || true
assert_eq "$(audit_count "${PLUGIN}" hooks.auto-approve.withheld '((.codes // []) | index("settings.secret-to-plain")) != null and .version == "3.0.0"')" "1" "Audit: hooks.auto-approve.withheld, settings.secret-to-plain" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.pendingUpdate.settings.secretToPlain | join(",")' 'apiKey' "GET /api/plugins/${PLUGIN}/hooks shows it pending" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.version' '2.0.0' "Until it is approved, 2.0.0 stays…" || true
assert_json_field "$(settings_probe "${PLUGIN}")" '"\(.schemaVersion) \(.secretDigests.apiKey)"' "2 ${DIGEST_B}" "…and the agent half holds secret B, schema 2" || true

APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$APPROVED" '.operation.id // empty')" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Approved by the admin, the update to 3.0.0 succeeded ($(json_get "$OP" '.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The hosting is up on 3.0.0"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
PROBE=$(settings_probe "${PLUGIN}")
assert_json_field "$PROBE" '"\(.schemaVersion) \(.secretDigests | has("apiKey")) \(.stored | has("apiKey"))"' '3 false false' "The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings" || true
FACTS=$(settings_facts "${PLUGIN}")
assert_json_field "$FACTS" '"\(.settings.schemaVersion) \(.settings.values | has("apiKey")) \((.secrets.keys // []) | index("apiKey") == null)"' '3 false true' "On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it" || true
VIEW=$(settings_view "${PLUGIN}")
assert_json_field "$VIEW" '.fields | map(select(.key == "apiKey") | .type) | join(",")' 'string' "GET settings: apiKey is a plain string field…" || true
assert_json_field "$VIEW" '.values.apiKey // "unset"' 'unset' "…without a value" || true
assert_json_field "$VIEW" '"\(.configured) \(.missing | join(","))"' 'false apiKey' "…and the plugin needs configuration: apiKey is missing" || true
assert_json_field "$(settings_summary "${PLUGIN}")" '"\(.configured) \(.missing | join(","))"' 'false apiKey' "GET /api/plugins: needs configuration (apiKey)" || true
ROW=$(settings_cache_row "${PLUGIN}")
assert_json_field "$ROW" '"\(.schemaVersion) \(.secretKeys // "none") \((.valueKeys // "") | split(",") | index("apiKey") == null)"' '3 none true' "The relay's cache: schema 3, no secret, no apiKey value" || true
settings_sweep "${PLUGIN}"
SCAN=$(relay_secret_scan "${PLUGIN}" "${SPEC_START}")
assert_json_field "$SCAN" '"\(.files) \(.stateDb) \(.journal) \(.responses)"' '0 0 0 0' "Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update" || true

# ===========================================================================
# 12. Purge
# ===========================================================================

log_section "Uninstalling with purge removes the settings on both sides"

host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null
UNINSTALL=$(host_api_delete "plugins/${PLUGIN}?purge=true")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNINSTALL" '.operation.id // empty')" 240 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Uninstalled with purge ($(json_get "$OP" '.error // ""'))" || true
assert_eq "$(host_api_get_status "plugins/${PLUGIN}/settings")" "404" "GET settings: 404, the plugin is gone" || true
assert_json_field "$(settings_cache_row "${PLUGIN}")" '.plugin // "none"' 'none' "No plugin_settings row left on the relay" || true
FACTS=$(settings_facts "${PLUGIN}")
assert_json_field "$FACTS" '"\(.dataDir) \(.settings) \(.secrets)"' 'null null null' "No data directory on the agent VM: settings.json and secrets.json are gone" || true

end_test
