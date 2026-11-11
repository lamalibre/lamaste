# Lamaste E2E: 26 — Cert Upgrade Paths (Three-VM)

> Started at `2026-11-11 09:06:35 UTC`


## Pre-flight: verify onboarding is complete

✅ `09:06:35` Onboarding must be COMPLETED for cert upgrade path tests  

## Clear any stale test state from previous runs


## Create fixture site for allowed-sites scoping

✅ `09:06:36` Fixture site created (ok: true)  

## Create agent cert (p12) with tunnels:read

✅ `09:06:37` Agent cert creation returned ok: true  

## Agent upgrade-cert: generate new CSR, post with agent cert, assert new cert issued

✅ `09:06:39` upgrade-cert returned ok: true  
✅ `09:06:39` upgrade-cert returns a new certificate serial  
✅ `09:06:39` upgrade-cert issues a cert with a different serial than the old one  
✅ `09:06:39` upgrade-cert response contains a signed certificate PEM  
✅ `09:06:39` After upgrade-cert, agent registry shows enrollmentMethod=hardware-bound  
✅ `09:06:39` Old agent cert has been revoked during upgrade (revoked_certs grew)  

## enroll-delegated: validate role guards

✅ `09:06:39` enroll-delegated rejects admin cert with 403 (route requires agent role)  
✅ `09:06:40` New cert PEM successfully written to host  
✅ `09:06:40` enroll-delegated returns 4xx for agent without ticket scope/instance  
ℹ️ `09:06:40` enroll-delegated with agent cert (no ticket instance) returned HTTP 403  

## PATCH /certs/agent/:label/allowed-sites

✅ `09:06:40` PATCH allowed-sites=[] returned ok: true  
✅ `09:06:40` PATCH allowed-sites response echoes agent label  
✅ `09:06:40` PATCH allowed-sites=[cert-upgrade-site] returned ok: true  
✅ `09:06:40` PATCH allowed-sites response lists the fixture site  
✅ `09:06:40` allowedSites persists to agent registry after PATCH  
✅ `09:06:41` PATCH allowed-sites rejects uppercase site names with 400 (Zod regex validation)  
✅ `09:06:41` PATCH allowed-sites on unknown label returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `09:06:41` Cleaning up test resources...  
