#!/usr/bin/env bash
# ============================================================================
# 40 — Lamaste's packages came from Feria, never npmjs (Single-VM)
# ============================================================================
# Since 4.14 every path that installs or checks Lamaste's own @lamalibre
# packages takes them from the hosted Feria, or from the registry npm's
# configuration names for @lamalibre — never npm's default registry, npmjs
# (packages/core/docs/05-operations/upgrades.md, "Where Lamaste's packages
# come from"). The VM names the development Feria for @lamalibre in every
# npmrc it has (tier node-ready). Run last; three-VM 63 is the same on three
# machines.
#
# 1. The rule, as 4.14's core resolves it: root and the lamaste account
#    follow the configuration (the development Feria); an npm with no
#    configuration resolves the hosted Feria (nothing is fetched); an npm
#    naming npmjs for @lamalibre is refused.
# 2. The evidence: npm's cache index and debug logs, of every user, hold
#    @lamalibre requests to the development Feria and none to a public
#    registry or to the hosted Feria.
# 3. The root helper runs the self-update's npx with --@lamalibre:registry=.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands node npm find grep sort

begin_test "40 — Lamaste's packages came from Feria, never npmjs (Single-VM)"

log_section "The rule, as the relay's core resolves it"

PROBE=$(sudo bash -c "$(lamalibre_registry_probe_script)")
log_info "$(printf '%s' "${PROBE}" | tr '\n' ';')"
probe() { printf '%s\n' "${PROBE}" | awk -v k="$1" '$1 == k { print $2 }'; }
assert_contains "$(probe root)" ":4873/" "root: the development Feria npm's configuration names ($(probe root))" || true
assert_contains "$(probe lamaste)" ":4873/" "the lamaste account: the same, from npm's global configuration ($(probe lamaste))" || true
assert_eq "$(probe unconfigured)" "https://feria.codelama.com.tr/" "npm with no configuration: the hosted Feria" || true
assert_eq "$(probe npmjs)" "refused:lamalibre_registry_refused" "npm naming npmjs for @lamalibre: refused" || true

log_section "The evidence: npm's caches and logs"

EVIDENCE=$(sudo bash -c "$(npm_fetch_evidence_script)")
PUBLIC=$(public_registry_fetches "${EVIDENCE}")
DEV=$(dev_feria_fetches "${EVIDENCE}")
log_info "$(printf '%s' "${EVIDENCE}" | grep -c . || true) @lamalibre URLs in npm's caches and logs, $(printf '%s' "${DEV}" | grep -c . || true) from the development Feria"
assert_not_eq "$(printf '%s' "${DEV}" | grep -c . || true)" "0" "npm's caches hold @lamalibre requests to the development Feria (the evidence is there to read)" || true
if [ -n "${PUBLIC}" ]; then
  log_fail "@lamalibre was asked of a public registry or the hosted Feria: $(printf '%s' "${PUBLIC}" | head -5 | tr '\n' ' ')"
else
  log_pass "No @lamalibre request to npmjs, its mirrors or the hosted Feria"
fi

log_section "The root helper's self-update names the registry"

ARGV=$(sudo node -e 'const p = require("/usr/local/sbin/lamaste-priv"); process.stdout.write(p.selfUpdateArgs("9.9.9", p.chooseLamalibreRegistry("undefined"), "u").join(" "))' 2>/dev/null || echo "")
assert_contains "${ARGV}" "/usr/bin/npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/create-lamaste@9.9.9 --yes" "lamaste-priv self-update: npx --@lamalibre:registry=<registry> create-lamaste@<version>" || true
REFUSED=$(sudo node -e 'const p = require("/usr/local/sbin/lamaste-priv"); try { p.chooseLamalibreRegistry("https://registry.npmjs.org/"); process.stdout.write("accepted"); } catch { process.stdout.write("refused"); }' 2>/dev/null || echo "")
assert_eq "${REFUSED}" "refused" "…and refuses a root npmrc naming npmjs" || true

end_test
