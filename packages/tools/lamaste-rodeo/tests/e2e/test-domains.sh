#!/usr/bin/env bash
# ============================================================================
# The base domains of the multi-domain relay's specs
# ============================================================================
# Sourced by setup-host.sh (both suites), setup-visitor.sh and helpers.sh (beside it, or from /tmp/e2e on the single-VM suite's VM) —
# the one place the specs' second and third base domains are derived.
# A tier ships it to the VMs (tiers/provisioned.json `assets`).
# ============================================================================

# test_domain_n <primary> <label> — a base domain beside <primary> with a
# registrable domain of its own (the relay refuses two domains under one
# registrable domain — they would share cookies on it): the label below the
# primary's suffix gets -<label> (test.lamaste.local, second →
# lamaste-second.local). Never under, over or beside <primary>.
test_domain_n() {
  local rest="${1#*.}"
  printf '%s-%s.%s\n' "${rest%%.*}" "$2" "${rest#*.}"
}
