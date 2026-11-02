#!/usr/bin/env bash
# shellcheck disable=SC2034 # variables are read by the specs that source this file
# ============================================================================
# Delegated invitations' three-VM specs (53–55): shared helpers
# ============================================================================
# Sourced after ../e2e/helpers.sh, app-plugin-harness.sh and
# multi-domain-harness.sh (design: packages/core/docs/delegated-invitations-
# design.md). A spec sets PLUGIN, SERVER_PACKAGE, AGENT_PACKAGE and FQDN.
#
# The plugin is an app plugin on B, the second base domain, with its own
# restricted web surface: identity variant `inviting` of helpers.sh's
# fixtures — coordinator invites coordinator and viewer, viewer and editor
# invite nobody; web tree v1. The address's domain the policy allows is
# INV_MAIL.
#
# The inviter works on the domain's sign-in host, as Lamaste's page does:
# inv_api sends what a browser sends from that page (Origin of the sign-in
# host, Sec-Fetch-Site: same-origin). The invitee's side has no session:
# inv_lookup and inv_accept post the token in the body, as the invitation
# page does; the token never travels in a URL.
# ============================================================================

INV_MAIL="example.test"
SITE_ID=""

health_up() { [ "$(hosting_field "$1" '.hosting.health.state')" = "up" ]; }

# inv_install <plugin> <server package> <agent package> — installed, approved,
# on B, enabled and hosted on the agent; ready for its users. Asserts.
inv_install() {
  local plugin="$1" pkg="$2" digest resp op
  resp=$(host_api_post "plugins/install" "{\"packageName\":\"${pkg}@1.0.0\"}")
  assert_json_field "$resp" '.plugin.version' '1.0.0' "Installed ${pkg}@1.0.0" || true
  digest=$(json_get "$(host_api_get "plugins/${plugin}/hooks")" '.hooks.approval.digest // empty')
  resp=$(host_api_post "plugins/${plugin}/hooks/approve" "{\"digest\":\"${digest}\"}")
  assert_json_field "$resp" '.hooks.approval.state' 'approved' "…approved" || true
  resp=$(host_api_call PUT "plugins/${plugin}/domain" "{\"domain\":\"${DOMAIN_2}\"}")
  assert_eq "$(status_of "$resp")" "200" "…moved to B, before any surface" || true
  host_api_post "plugins/${plugin}/enable" '{}' > /dev/null
  op=$(host_plugin "${plugin}" 300 nudge)
  assert_json_field "$op" '.status' 'succeeded' "…hosted on ${HOST_AGENT_LABEL} ($(json_get "$op" '.error // .refused.error // ""'))" || true
  if wait_for 60 health_up "${plugin}"; then
    log_pass "…its hosting is up"
  else
    log_fail "…its hosting: $(hosting_field "${plugin}" '.hosting.health')"
  fi
  if wait_for 120 identity_ready "${plugin}"; then
    log_pass "…ready: its agent half's first complete sync ended at the head"
  else
    log_fail "…not ready: $(identity_view "${plugin}" | jq -c '.readiness')"
  fi
}

# inv_web_surface <variable> <plugin> <fqdn> <access mode> — the plugin's web
# surface, created and served; its site id into <variable>. Asserts.
inv_web_surface() {
  local resp id
  host_api_delete "plugins/$2/web-surface" > /dev/null 2>&1 || true
  resp=$(host_api_call POST "plugins/$2/web-surface" "{\"accessMode\":\"$4\"}")
  assert_eq "$(status_of "$resp")" "201" "POST /api/plugins/$2/web-surface {accessMode: $4}" || true
  id=$(json_get "$(body_of "$resp")" '.webSurface.site.id // empty')
  assert_json_field "$(body_of "$resp")" '"\(.webSurface.site.fqdn) \(.webSurface.site.accessMode)"' "$3 $4" "…the site $3, $4, on B" || true
  if wait_for 120 web_served "$2"; then
    log_pass "…served"
  else
    log_fail "…not served: $(web_surface "$2" | jq -c '{served, reason}')"
  fi
  printf -v "$1" '%s' "$id"
}

# inv_entitle <username> <role> [plugin] — the role, as the administrator gives it. Asserts.
inv_entitle() {
  local resp
  resp=$(host_api_call PUT "plugins/${3:-${PLUGIN}}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"$1\",\"roles\":[\"$2\"]}")
  assert_eq "$(status_of "$resp")" "200" "$1 entitled as $2" || true
}

# inv_in_audience <userId> <role> — the audience holds the user, active, with that role
inv_in_audience() {
  [ "$(audience_row "${PLUGIN}" "$1" | jq -r '"\(.change.kind) \(.change.member.status) \(.change.member.roles | join(","))"' 2>/dev/null)" = "upsert active $2" ]
}

# inv_wait_audience <userId> <role> <what> — until the audience holds them so
inv_wait_audience() {
  if wait_for 30 inv_in_audience "$1" "$2"; then
    log_pass "$3"
  else
    log_fail "$3: $(audience_row "${PLUGIN}" "$1")"
  fi
}

# inv_policy <json> — PUT the plugin's invitation policy; the response
inv_policy() { host_api_call PUT "plugins/${PLUGIN}/invitation-policy" "$1"; }

# inv_url [suffix] — the inviter's API of the plugin on B's sign-in host
inv_url() { echo "https://auth.${DOMAIN_2}/api/delegated-invitations/${PLUGIN}${1:-}"; }

# inv_api <jar> <method> [suffix] [json] — as Lamaste's page calls it, from the
# visitor, as visit prints it
inv_api() {
  local jar="$1" method="$2" suffix="${3:-}" body="${4:-}" args
  args=(-X "${method}" -H "Origin: https://auth.${DOMAIN_2}" -H 'Sec-Fetch-Site: same-origin' -H 'Accept: application/json')
  if [ -n "${body}" ]; then args+=(-H 'Content-Type: application/json' -d "${body}"); fi
  visit "${jar}" "${args[@]}" "$(inv_url "${suffix}")"
}

# inv_new <token variable> <id variable> <jar> <address> <role> [what] — an
# invitation made, asserted (201, a link with the token in its fragment);
# the token and the invitation's id into the variables. Never in a command
# substitution.
inv_new() {
  local resp url token id body
  body=$(jq -c -n --arg e "$4" --arg r "$5" '{email: $e, displayName: "E2E Invitee", role: $r}')
  resp=$(inv_api "$3" POST "" "${body}")
  url=$(json_get "$(visit_body "$resp")" '.inviteUrl // empty')
  id=$(json_get "$(visit_body "$resp")" '.invitation.id // empty')
  token="${url##*#}"
  assert_eq "$(visit_status "$resp")" "201" "${6:-An invitation for $4 as $5}: 201" || true
  if [[ "${url}" =~ ^https://auth\.[a-z0-9.-]+/invite#[0-9a-f]{64}$ ]]; then
    log_pass "…a link on the sign-in host, the token in its fragment"
  else
    log_fail "…no link with the token in its fragment"
  fi
  printf -v "$1" '%s' "${token}"
  printf -v "$2" '%s' "${id}"
}

# inv_lookup <token> [host] — POST /api/invite/lookup with no session, as visit prints it
inv_lookup() {
  visit - -X POST -H 'Content-Type: application/json' -d "{\"token\":\"$1\"}" "https://${2:-auth.${DOMAIN_2}}/api/invite/lookup"
}

# inv_accept <token> <username> <password> [host] — POST /api/invite/accept
# with no session, as visit prints it
inv_accept() {
  local body
  body=$(jq -c -n --arg t "$1" --arg u "$2" --arg p "$3" '{token: $t, username: $u, displayName: "E2E Invitee", password: $p}')
  visit - -X POST -H 'Content-Type: application/json' -d "${body}" "https://${4:-auth.${DOMAIN_2}}/api/invite/accept"
}

# inv_secret <accept response> — the TOTP secret of an accepted invitation
inv_secret() { visit_body "$1" | jq -r '.totpUri // empty' 2>/dev/null | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p'; }

# inv_row <invitation id> — the invitation as the administrator lists it ('null' when gone)
inv_row() {
  host_api_get "invitations?plugin=${PLUGIN}" 2>/dev/null | jq -c --arg id "$1" '[.invitations[]? | select(.id == $id)] | first // null' 2>/dev/null || echo "null"
}

# inv_ended_as <invitation id> <status> <reason> — the row says so
inv_ended_as() { [ "$(inv_row "$1" | jq -r '"\(.status) \(.revokedReason)"' 2>/dev/null)" = "$2 $3" ]; }

# inv_wait_ended <invitation id> <status> <reason> <what> — until the row says so
inv_wait_ended() {
  if wait_for 75 inv_ended_as "$1" "$2" "$3"; then
    log_pass "$4"
  else
    log_fail "$4: $(inv_row "$1" | jq -c '{status, revokedReason}')"
  fi
}

# inv_refused_off_portal <token> <url of a listener on the host VM> — the status
# of a lookup there, with a client's Host and X-Forwarded-Host naming auth.<B>
inv_refused_off_portal() {
  host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'Host: auth.${DOMAIN_2}' -H 'X-Forwarded-Host: auth.${DOMAIN_2}' -H 'Content-Type: application/json' -d '{\"token\":\"$1\"}' $2/api/invite/lookup" 2>/dev/null | tail -n 1 | tr -d '\r'
}

# inv_audit <action> — the plugin's audit entries of that action since the
# spec began, as a JSON array
inv_audit() {
  host_api_get "audit?action=$1&plugin=${PLUGIN}&limit=200" 2>/dev/null |
    jq -c --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]"
}

# inv_cleanup_users <username...> / inv_cleanup_ids <userId...> — what a
# spec's trap ends with for its people
inv_cleanup_users() {
  local u
  for u in "$@"; do host_api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
}
inv_cleanup_ids() {
  local id
  for id in "$@"; do host_api_post "identity/directory/${id}/erase" '{}' > /dev/null 2>&1 || true; done
}

# inv_drop_site_grants <site id> — revoke every grant on the site (an interrupted run's too)
inv_drop_site_grants() {
  local id
  for id in $(host_api_get "gatekeeper/grants?resourceType=site&resourceId=$1" 2>/dev/null | jq -r '.grants[]?.grantId // empty' 2>/dev/null || true); do
    host_api_delete "gatekeeper/grants/${id}" > /dev/null 2>&1 || true
  done
}
