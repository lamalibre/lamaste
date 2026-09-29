#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# certbot-shim.sh — Drop-in certbot replacement for E2E testing.
#
# Issues certificates from a persistent E2E test CA instead of hitting Let's
# Encrypt. The CA is created once at /etc/letsencrypt/e2e-ca/ and every leaf
# certificate is signed by it, so a client that trusts the CA (the agent and
# visitor VMs install it into their system trust store) verifies the host's
# certificates exactly as it would a real Let's Encrypt chain — hostname
# checks included, since every requested name lands in subjectAltName.
#
# Install by placing this script ahead of the real certbot in $PATH, or by
# copying it to /usr/bin/certbot.
#
# Supported commands — exactly the argument shapes the panel's root-owned
# wrapper (/usr/local/sbin/lamaste-certbot) and the operator CLI produce:
#   certonly --nginx --cert-name <name> -d <name> [-d <name> ...] \
#            --email <e> --agree-tos --non-interactive
#   renew [--cert-name <name>] [--force-renewal] [--no-random-sleep-on-renew]
#         [--non-interactive]
#   certificates [--non-interactive]
#   e2e-ca-init      (shim only) create the test CA if missing, print its path
#
# Any other flag makes the shim fail: the panel only reaches certbot through
# the wrapper, so an unexpected flag means the wrapper (or a caller bypassing
# it) changed, and a test should notice rather than have the shim shrug.
#
# Every certonly/renew/certificates call is appended, argv verbatim, to
# /etc/letsencrypt/e2e-certbot-calls.log so tests can assert the exact
# argument vectors (e.g. --cert-name on every issue, --no-random-sleep-on-renew
# on every renew, and the issue sequence of an alias change).
# -----------------------------------------------------------------------------

# CERTBOT_SHIM_ROOT exists only to exercise the shim outside a VM.
LE_ROOT="${CERTBOT_SHIM_ROOT:-/etc/letsencrypt}"
LIVE_DIR="${LE_ROOT}/live"
CA_DIR="${LE_ROOT}/e2e-ca"
CA_KEY="${CA_DIR}/ca.key"
CA_CERT="${CA_DIR}/ca.crt"
CA_LOCK="${LE_ROOT}/.e2e-ca.lock"
CALL_LOG="${LE_ROOT}/e2e-certbot-calls.log"

log() {
  echo "[certbot-shim] $*" >&2
}

# reject_flag <flag> <command> — fail on an argument shape the shim does not know
reject_flag() {
  log "ERROR: unexpected argument '$1' for '$2' (not a shape lamaste-certbot produces)"
  exit 1
}

# record_call <argv...> — append one invocation to the call log
record_call() {
  mkdir -p "${LE_ROOT}"
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "${CALL_LOG}"
}

# ---------------------------------------------------------------------------
# ensure_ca — create the E2E test CA once. Serialized with flock so concurrent
# certbot invocations never race to create two different CAs.
# ---------------------------------------------------------------------------
ensure_ca() {
  mkdir -p "${LE_ROOT}"
  exec 9> "${CA_LOCK}"
  flock 9

  if [[ ! -s "${CA_KEY}" || ! -s "${CA_CERT}" ]]; then
    log "Creating E2E test CA at ${CA_DIR}"
    mkdir -p "${CA_DIR}"
    chmod 755 "${CA_DIR}"

    local tmp
    tmp="$(mktemp -d)"
    (umask 077 && openssl genrsa -out "${tmp}/ca.key" 2048 2>/dev/null)
    openssl req -x509 -new -key "${tmp}/ca.key" \
      -out "${tmp}/ca.crt" \
      -days 3650 \
      -sha256 \
      -subj "/CN=Lamaste E2E Test CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -addext "subjectKeyIdentifier=hash" \
      2>/dev/null

    install -m 600 "${tmp}/ca.key" "${CA_KEY}"
    install -m 644 "${tmp}/ca.crt" "${CA_CERT}"
    rm -rf "${tmp}"
  fi

  flock -u 9
  exec 9>&-
}

# ---------------------------------------------------------------------------
# issue_cert <lineage-name> <name> [<name> ...]
#
# Writes /etc/letsencrypt/live/<lineage-name>/{privkey,cert,chain,fullchain}.pem
# with an RSA-2048 leaf signed by the E2E test CA, valid for 90 days, whose
# subjectAltName lists every given name. fullchain = leaf + CA, chain = CA.
# ---------------------------------------------------------------------------
issue_cert() {
  local lineage="$1"
  shift
  local names=("$@")
  local cert_dir="${LIVE_DIR}/${lineage}"

  ensure_ca

  local san="" name
  for name in "${names[@]}"; do
    san="${san:+${san},}DNS:${name}"
  done

  log "Issuing ${lineage} for ${names[*]} (signed by the E2E test CA)"

  local tmp
  tmp="$(mktemp -d)"

  cat > "${tmp}/leaf.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
subjectAltName=${san}
EXT

  (umask 077 && openssl genrsa -out "${tmp}/privkey.pem" 2048 2>/dev/null)
  openssl req -new -key "${tmp}/privkey.pem" \
    -out "${tmp}/leaf.csr" \
    -subj "/CN=${names[0]}" \
    2>/dev/null
  openssl x509 -req -in "${tmp}/leaf.csr" \
    -CA "${CA_CERT}" -CAkey "${CA_KEY}" \
    -set_serial "0x$(openssl rand -hex 16)" \
    -days 90 \
    -sha256 \
    -extfile "${tmp}/leaf.ext" \
    -out "${tmp}/cert.pem" \
    2>/dev/null

  cat "${tmp}/cert.pem" "${CA_CERT}" > "${tmp}/fullchain.pem"
  cp "${CA_CERT}" "${tmp}/chain.pem"

  mkdir -p "${cert_dir}"
  install -m 600 "${tmp}/privkey.pem" "${cert_dir}/privkey.pem"
  install -m 644 "${tmp}/cert.pem" "${cert_dir}/cert.pem"
  install -m 644 "${tmp}/chain.pem" "${cert_dir}/chain.pem"
  install -m 644 "${tmp}/fullchain.pem" "${cert_dir}/fullchain.pem"
  rm -rf "${tmp}"

  log "Certificates written to ${cert_dir}"
}

# ---------------------------------------------------------------------------
# lineage_names <lineage-name> — print the DNS names in an existing lineage's
# subjectAltName, space-separated (empty when the lineage does not exist).
# ---------------------------------------------------------------------------
lineage_names() {
  local fullchain="${LIVE_DIR}/$1/fullchain.pem"
  [[ -f "${fullchain}" ]] || return 0
  openssl x509 -noout -ext subjectAltName -in "${fullchain}" 2>/dev/null \
    | grep -o 'DNS:[^, ]*' | sed 's/^DNS://' | tr '\n' ' ' | sed 's/ $//'
}

# ---------------------------------------------------------------------------
# cmd_certonly — handle:
#   certonly --nginx [--cert-name <name>] -d <fqdn> [-d <alias> ...] --email <e> ...
# Like certbot, -d may repeat and may carry a comma-separated list. The lineage
# is named by --cert-name, else by the first -d.
# ---------------------------------------------------------------------------
cmd_certonly() {
  local cert_name=""
  local names=()
  local item

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d|--domain|--domains)
        IFS=',' read -r -a _split <<< "$2"
        for item in "${_split[@]}"; do
          [[ -n "${item}" ]] && names+=("${item}")
        done
        shift 2 ;;
      --cert-name) cert_name="$2"; shift 2 ;;
      --email)     shift 2 ;;   # ignored
      --agree-tos|--non-interactive|--nginx)
                   shift ;;
      *)           reject_flag "$1" certonly ;;
    esac
  done

  if [[ ${#names[@]} -eq 0 ]]; then
    log "ERROR: certonly called without -d <domain>"
    exit 1
  fi

  issue_cert "${cert_name:-${names[0]}}" "${names[@]}"
}

# ---------------------------------------------------------------------------
# cmd_certificates — list every cert under /etc/letsencrypt/live/
# ---------------------------------------------------------------------------
cmd_certificates() {
  if [[ ! -d "${LIVE_DIR}" ]]; then
    echo "No certificates found."
    return
  fi

  local found=0

  for cert_dir in "${LIVE_DIR}"/*/; do
    # Skip if the glob didn't match anything.
    [[ -d "${cert_dir}" ]] || continue

    local lineage
    lineage="$(basename "${cert_dir}")"
    local fullchain="${cert_dir}fullchain.pem"

    [[ -f "${fullchain}" ]] || continue

    if [[ ${found} -eq 0 ]]; then
      echo "Found the following certs:"
      found=1
    fi

    local domains
    domains="$(lineage_names "${lineage}")"
    [[ -n "${domains}" ]] || domains="${lineage}"

    # Read expiry from the certificate.
    local expiry_raw expiry_epoch now_epoch days_remaining expiry_date
    expiry_raw="$(openssl x509 -enddate -noout -in "${fullchain}" 2>/dev/null | sed 's/notAfter=//')"
    expiry_date="$(date -d "${expiry_raw}" '+%Y-%m-%d' 2>/dev/null || date -j -f '%b %d %T %Y %Z' "${expiry_raw}" '+%Y-%m-%d' 2>/dev/null || echo 'unknown')"

    # Compute days remaining (portable: try GNU date, then BSD date).
    if expiry_epoch="$(date -d "${expiry_raw}" '+%s' 2>/dev/null)"; then
      now_epoch="$(date '+%s')"
    elif expiry_epoch="$(date -j -f '%b %d %T %Y %Z' "${expiry_raw}" '+%s' 2>/dev/null)"; then
      now_epoch="$(date '+%s')"
    else
      expiry_epoch=0
      now_epoch=0
    fi

    if [[ ${expiry_epoch} -gt 0 ]]; then
      days_remaining=$(( (expiry_epoch - now_epoch) / 86400 ))
    else
      days_remaining="?"
    fi

    cat <<ENTRY
  Certificate Name: ${lineage}
    Domains: ${domains}
    Expiry Date: ${expiry_date} (VALID: ${days_remaining} days)
    Certificate Path: ${LIVE_DIR}/${lineage}/fullchain.pem
    Private Key Path: ${LIVE_DIR}/${lineage}/privkey.pem
ENTRY
  done

  if [[ ${found} -eq 0 ]]; then
    echo "No certificates found."
  fi
}

# ---------------------------------------------------------------------------
# cmd_renew — handle both targeted and blanket renewal
#   renew --cert-name <lineage> [--force-renewal]
#   renew  (no args — no-op)
# A targeted renewal keeps the lineage's current set of names.
# ---------------------------------------------------------------------------
cmd_renew() {
  local lineage=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cert-name)     lineage="$2"; shift 2 ;;
      --force-renewal|--no-random-sleep-on-renew|--non-interactive)
                       shift ;;
      *)               reject_flag "$1" renew ;;
    esac
  done

  if [[ -z "${lineage}" ]]; then
    log "Blanket renew requested — no-op in shim"
    return
  fi

  # Like certbot: renewing a lineage that does not exist is an error, not an
  # issuance.
  if [[ ! -f "${LIVE_DIR}/${lineage}/fullchain.pem" ]]; then
    echo "No certificate found with name ${lineage} (expected /etc/letsencrypt/renewal/${lineage}.conf)." >&2
    exit 1
  fi

  local names
  names="$(lineage_names "${lineage}")"
  [[ -n "${names}" ]] || names="${lineage}"

  log "Renewing certificate ${lineage}"
  # shellcheck disable=SC2086 # names is a space-separated list of hostnames
  issue_cert "${lineage}" ${names}
}

# ---------------------------------------------------------------------------
# cmd_e2e_ca_init — shim-only: make sure the test CA exists, print its path
# ---------------------------------------------------------------------------
cmd_e2e_ca_init() {
  ensure_ca
  echo "${CA_CERT}"
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------
if [[ $# -eq 0 ]]; then
  log "No command given"
  exit 0
fi

command="$1"
shift

case "${command}" in
  certonly|certificates|renew)
    record_call "${command}" "$@" ;;
esac

case "${command}" in
  certonly)      cmd_certonly "$@" ;;
  certificates)
    for arg in "$@"; do
      [[ "${arg}" == "--non-interactive" ]] || reject_flag "${arg}" certificates
    done
    cmd_certificates ;;
  renew)         cmd_renew "$@" ;;
  e2e-ca-init)   cmd_e2e_ca_init ;;
  *)
    echo "certbot-shim: unhandled command: ${command} $*" >&2
    exit 0
    ;;
esac
