#!/usr/bin/env bash
# VM-side API helper — runs ON the VM, called via: multipass exec VM -- /tmp/vm-api-helper.sh METHOD path [b64body]
# Body is base64-encoded to avoid quoting issues through multipass exec.
set -euo pipefail

METHOD="$1"
PATH_ARG="$2"
B64_BODY="${3:-}"

BODY=""
if [ -n "${B64_BODY}" ]; then
  BODY=$(echo "${B64_BODY}" | base64 -d)
fi

CERT_ARGS="--cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt"
URL="https://127.0.0.1:9292/api/${PATH_ARG}"

if [ -n "${BODY}" ]; then
  exec curl -skf --max-time 30 ${CERT_ARGS} \
    -X "${METHOD}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "${BODY}" "${URL}"
else
  exec curl -skf --max-time 30 ${CERT_ARGS} \
    -X "${METHOD}" \
    -H 'Accept: application/json' "${URL}"
fi
