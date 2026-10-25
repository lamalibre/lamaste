#!/usr/bin/env bash
# ============================================================================
# The base domains of the multi-domain relay's specs
# ============================================================================
# Sourced by setup-host.sh (both suites), setup-visitor.sh and helpers.sh —
# the one place the specs' second and third base domains are derived.
# A tier ships it to the VMs (tiers/provisioned.json `assets`).
# ============================================================================

# test_domain_n <primary> <label> — a base domain beside <primary>: its first
# label replaced by <label> (test.lamaste.local, second → second.lamaste.local).
# Never under or over <primary>, so one relay may hold both.
test_domain_n() {
  printf '%s.%s\n' "$2" "${1#*.}"
}
