#!/usr/bin/env bash
# shellcheck disable=SC2034 # variables are read by the specs that source this file
# ============================================================================
# Mail's three-VM specs (58, 59): shared helpers
# ============================================================================
# Sourced after ../e2e/helpers.sh, app-plugin-harness.sh and
# multi-domain-harness.sh (design: packages/core/docs/mail-design.md §8).
# The SMTP stand-in (helpers.sh write_smtp_sink) runs on the host VM, where
# the panel delivers to it on 127.0.0.1:MAIL_SINK_PORT over implicit TLS with
# a certificate from a private CA the transports trust through caPem. A
# spec sets MAIL_SPEC before sourcing this file.
# ============================================================================

MAIL_SINK_PORT=2467
MAIL_SINK_USER="relay"
MAIL_DIR="/var/tmp/e2e-mail-${MAIL_SPEC}"
MAIL_DOMAIN="e2e-mail.example.com"

# mail_sink_start — the sink on the host VM: its CA, certificate, password
# and script made there (helpers.sh's functions shipped as a script), then
# started detached. Asserts.
mail_sink_start() {
  local local_script
  local_script=$(mktemp /tmp/e2e-mail-sink-XXXXXXXX)
  {
    declare -f write_smtp_sink mail_sink_certificates
    echo 'set -e; mkdir -p "$1/mails"; [ -s "$1/password" ] || openssl rand -hex 16 > "$1/password"'
    echo '[ -s "$1/ca.pem" ] || mail_sink_certificates "$1"; write_smtp_sink "$1/smtp-sink.mjs"'
  } > "${local_script}"
  host_exec "mkdir -p ${MAIL_DIR}" > /dev/null 2>&1 || true
  # multipass transfer writes as the VM's login user: into /tmp, then moved
  multipass transfer "${local_script}" "${HOST_VM}:/tmp/e2e-mail-${MAIL_SPEC}-setup.sh"
  rm -f "${local_script}"
  host_exec "mv /tmp/e2e-mail-${MAIL_SPEC}-setup.sh ${MAIL_DIR}/setup.sh && bash ${MAIL_DIR}/setup.sh ${MAIL_DIR}" > /dev/null 2>&1 || true
  mail_sink_stop
  host_exec "nohup node ${MAIL_DIR}/smtp-sink.mjs --port ${MAIL_SINK_PORT} --cert ${MAIL_DIR}/server.pem --key ${MAIL_DIR}/server.key --dir ${MAIL_DIR}/mails --username ${MAIL_SINK_USER} --password-file ${MAIL_DIR}/password &>/dev/null & exit" > /dev/null 2>&1 || true
  if wait_for 30 mail_sink_up; then
    log_pass "The SMTP sink answers on the host VM's 127.0.0.1:${MAIL_SINK_PORT}"
  else
    log_fail "The SMTP sink does not start on the host VM"
  fi
}

mail_sink_up() {
  [ "$(host_exec "echo QUIT | timeout 5 openssl s_client -quiet -connect 127.0.0.1:${MAIL_SINK_PORT} 2>/dev/null | head -c 3" 2>/dev/null | tail -n 1 | tr -d '\r')" = "220" ]
}

mail_sink_stop() { host_exec "pkill -f '[s]mtp-sink.mjs' || true" > /dev/null 2>&1 || true; }

# mail_transport_put <api path> <sender address> [sender name] — PUT an smtp
# transport to the sink at <api path> (settings/mail or domains/<d>/mail),
# its body built on the host VM (the password and CA never cross this
# machine); the response, then the status
mail_transport_put() {
  host_exec "jq -c -n --arg pw \"\$(cat ${MAIL_DIR}/password)\" --arg ca \"\$(cat ${MAIL_DIR}/ca.pem)\" --argjson p ${MAIL_SINK_PORT} --arg u ${MAIL_SINK_USER} --arg s '$2' --arg n '${3:-E2E Relay}' '{host: \"127.0.0.1\", port: \$p, security: \"tls\", username: \$u, password: \$pw, caPem: \$ca, senderAddress: \$s, senderName: \$n}' > ${MAIL_DIR}/body.json" > /dev/null 2>&1 || true
  API_TIMEOUT=60 host_api_call_file PUT "$1" "${MAIL_DIR}/body.json"
}

# mail_to <address> — the sink's mails to <address>, oldest first, as a JSON array
mail_to() {
  host_exec "for f in \$(ls -1 ${MAIL_DIR}/mails 2>/dev/null | sort); do cat ${MAIL_DIR}/mails/\$f; echo; done" 2>/dev/null |
    jq -s -c --arg a "$1" '[.[] | select(type == "object" and (.to | index($a) != null))]' 2>/dev/null || echo '[]'
}
mail_count_to() { mail_to "$1" | jq 'length' 2>/dev/null || echo 0; }
mail_last_to() { mail_to "$1" | jq -c 'last' 2>/dev/null || echo null; }
mail_holds() { [ "$(mail_count_to "$1")" -ge "$2" ]; }

# mail_wait <address> <n> <what> — until the sink holds <n> mails for <address>. Asserts.
mail_wait() {
  if wait_for 45 mail_holds "$1" "$2"; then log_pass "$3"; else log_fail "$3: the sink holds $(mail_count_to "$1")"; fi
}

# mail_link_in <mail json> <path> — the first https link to <path> in its text
mail_link_in() {
  printf '%s' "$1" | jq -r '.text // ""' | grep -o "https://[^[:space:]\"<>]*$2[^[:space:]\"<>]*" | head -n 1 || true
}

# portal_index_reset <domain> — the reset link attribute of the domain's sign-in page, from the visitor
portal_index_reset() {
  visit_body "$(visit - "https://auth.$1/")" | grep -o 'data-resetpasswordcustomurl="[^"]*"' | head -n 1 || true
}
portal_links_reset() { [ "$(portal_index_reset "$1")" = "data-resetpasswordcustomurl=\"$2\"" ]; }

# mail_portal_post <domain> <path> <json> — a POST from the domain's
# sign-in page, from the visitor, as visit prints it
mail_portal_post() {
  visit - -X POST -H 'Content-Type: application/json' -H "Origin: https://auth.$1" -H 'Sec-Fetch-Site: same-origin' -d "$3" "https://auth.$1$2"
}

# mail_user <username> <domains, a JSON array> <password> — a user with a
# deliverable address (<username>@MAIL_DOMAIN), member of those domains. Asserts.
mail_user() {
  local resp
  host_api_delete "users/$1?erase=true" > /dev/null 2>&1 || true
  resp=$(users_call POST "users" "{\"username\":\"$1\",\"displayname\":\"E2E $1\",\"email\":\"$1@${MAIL_DOMAIN}\",\"password\":\"$3\",\"groups\":[],\"domains\":$2}")
  assert_eq "$(status_of "$resp")" "201" "User $1 <$1@${MAIL_DOMAIN}>, member of $(echo "$2" | jq -r 'join(" and ")')" || true
}

# mail_cleanup — no transport anywhere this spec set one, the sink stopped, its directory gone
mail_cleanup() {
  local d
  host_api_delete "settings/mail" > /dev/null 2>&1 || true
  for d in "${DOMAIN:-}" "${DOMAIN_2:-}" "${DOMAIN_3:-}"; do
    [ -n "$d" ] && host_api_delete "domains/${d}/mail" > /dev/null 2>&1 || true
  done
  mail_sink_stop
  host_exec "rm -rf ${MAIL_DIR}" > /dev/null 2>&1 || true
}
