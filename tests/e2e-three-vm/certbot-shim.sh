#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# certbot-shim.sh — Drop-in certbot replacement for E2E testing.
#
# Generates self-signed certificates instead of hitting Let's Encrypt.
# Install by placing this script ahead of the real certbot in $PATH, or by
# symlinking /usr/bin/certbot to it.
# -----------------------------------------------------------------------------

log() {
  echo "[certbot-shim] $*" >&2
}

# ---------------------------------------------------------------------------
# generate_self_signed <fqdn>
#
# Creates /etc/letsencrypt/live/<fqdn>/{privkey,fullchain,chain}.pem with a
# self-signed RSA-2048 certificate valid for 90 days.
# ---------------------------------------------------------------------------
generate_self_signed() {
  local fqdn="$1"
  local cert_dir="/etc/letsencrypt/live/${fqdn}"

  log "Generating self-signed cert for ${fqdn}"

  mkdir -p "${cert_dir}"

  openssl req -x509 -newkey rsa:2048 \
    -keyout "${cert_dir}/privkey.pem" \
    -out "${cert_dir}/fullchain.pem" \
    -days 90 \
    -nodes \
    -subj "/CN=${fqdn}" \
    -addext "subjectAltName=DNS:${fqdn}" \
    2>/dev/null

  # For a self-signed cert the chain is the cert itself.
  cp "${cert_dir}/fullchain.pem" "${cert_dir}/chain.pem"

  chmod 600 "${cert_dir}/privkey.pem"
  chmod 644 "${cert_dir}/fullchain.pem"
  chmod 644 "${cert_dir}/chain.pem"

  log "Certificates written to ${cert_dir}"
}

# ---------------------------------------------------------------------------
# cmd_certonly — handle:  certonly --nginx -d <fqdn> --email <email> ...
# ---------------------------------------------------------------------------
cmd_certonly() {
  local fqdn=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d)         fqdn="$2"; shift 2 ;;
      --email)    shift 2 ;;   # ignored
      --agree-tos|--non-interactive|--nginx)
                  shift ;;
      *)          shift ;;
    esac
  done

  if [[ -z "${fqdn}" ]]; then
    log "ERROR: certonly called without -d <domain>"
    exit 1
  fi

  generate_self_signed "${fqdn}"
}

# ---------------------------------------------------------------------------
# cmd_certificates — list every cert under /etc/letsencrypt/live/
# ---------------------------------------------------------------------------
cmd_certificates() {
  local live_dir="/etc/letsencrypt/live"

  if [[ ! -d "${live_dir}" ]]; then
    echo "No certificates found."
    return
  fi

  local found=0

  for cert_dir in "${live_dir}"/*/; do
    # Skip if the glob didn't match anything.
    [[ -d "${cert_dir}" ]] || continue

    local fqdn
    fqdn="$(basename "${cert_dir}")"
    local fullchain="${cert_dir}fullchain.pem"

    [[ -f "${fullchain}" ]] || continue

    if [[ ${found} -eq 0 ]]; then
      echo "Found the following certs:"
      found=1
    fi

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
  Certificate Name: ${fqdn}
    Domains: ${fqdn}
    Expiry Date: ${expiry_date} (VALID: ${days_remaining} days)
    Certificate Path: /etc/letsencrypt/live/${fqdn}/fullchain.pem
    Private Key Path: /etc/letsencrypt/live/${fqdn}/privkey.pem
ENTRY
  done

  if [[ ${found} -eq 0 ]]; then
    echo "No certificates found."
  fi
}

# ---------------------------------------------------------------------------
# cmd_renew — handle both targeted and blanket renewal
#   renew --cert-name <domain> [--force-renewal]
#   renew  (no args — no-op)
# ---------------------------------------------------------------------------
cmd_renew() {
  local domain=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cert-name)     domain="$2"; shift 2 ;;
      --force-renewal) shift ;;
      *)               shift ;;
    esac
  done

  if [[ -z "${domain}" ]]; then
    log "Blanket renew requested — no-op in shim"
    return
  fi

  log "Renewing certificate for ${domain}"
  generate_self_signed "${domain}"
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
  certonly)      cmd_certonly "$@" ;;
  certificates)  cmd_certificates ;;
  renew)         cmd_renew "$@" ;;
  *)
    echo "certbot-shim: unhandled command: ${command} $*" >&2
    exit 0
    ;;
esac
