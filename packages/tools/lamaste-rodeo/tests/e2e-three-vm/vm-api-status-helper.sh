#!/usr/bin/env bash
# VM-side API status helper — returns only HTTP status code.
# Body is base64-encoded to avoid quoting issues through multipass exec.
set -euo pipefail

METHOD="$1"
PATH_ARG="$2"
B64_BODY="${3:-}"

BODY=""
if [ -n "${B64_BODY}" ]; then
  BODY=$(echo "${B64_BODY}" | base64 -d)
fi

CERT_ARGS="--cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt"
URL="https://127.0.0.1:9292/api/${PATH_ARG}"

if [ -n "${BODY}" ]; then
  exec curl -sk --max-time 30 ${CERT_ARGS} \
    -X "${METHOD}" \
    -H 'Content-Type: application/json' \
    -o /dev/null -w '%{http_code}' \
    -d "${BODY}" "${URL}"
else
  exec curl -sk --max-time 30 ${CERT_ARGS} \
    -X "${METHOD}" \
    -o /dev/null -w '%{http_code}' "${URL}"
fi
