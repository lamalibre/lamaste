# Lamaste E2E: 26 — Cert Upgrade Paths (Three-VM)

> Started at `2026-11-02 15:54:04 UTC`


## Pre-flight: verify onboarding is complete

✅ `15:54:04` Onboarding must be COMPLETED for cert upgrade path tests  

## Clear any stale test state from previous runs


## Create fixture site for allowed-sites scoping

✅ `15:54:06` Fixture site created (ok: true)  

## Create agent cert (p12) with tunnels:read

✅ `15:54:07` Agent cert creation returned ok: true  

## Agent upgrade-cert: generate new CSR, post with agent cert, assert new cert issued

✅ `15:54:08` upgrade-cert returned ok: true  
✅ `15:54:09` upgrade-cert returns a new certificate serial  
✅ `15:54:09` upgrade-cert issues a cert with a different serial than the old one  
✅ `15:54:09` upgrade-cert response contains a signed certificate PEM  
✅ `15:54:09` After upgrade-cert, agent registry shows enrollmentMethod=hardware-bound  
✅ `15:54:09` Old agent cert has been revoked during upgrade (revoked_certs grew)  

## enroll-delegated: validate role guards

✅ `15:54:09` enroll-delegated rejects admin cert with 403 (route requires agent role)  
✅ `15:54:09` New cert PEM successfully written to host  
✅ `15:54:09` enroll-delegated returns 4xx for agent without ticket scope/instance  
ℹ️ `15:54:09` enroll-delegated with agent cert (no ticket instance) returned HTTP 403  

## PATCH /certs/agent/:label/allowed-sites

✅ `15:54:09` PATCH allowed-sites=[] returned ok: true  
✅ `15:54:09` PATCH allowed-sites response echoes agent label  
✅ `15:54:09` PATCH allowed-sites=[cert-upgrade-site] returned ok: true  
✅ `15:54:09` PATCH allowed-sites response lists the fixture site  
✅ `15:54:09` allowedSites persists to agent registry after PATCH  
✅ `15:54:10` PATCH allowed-sites rejects uppercase site names with 400 (Zod regex validation)  
✅ `15:54:10` PATCH allowed-sites on unknown label returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `15:54:10` Cleaning up test resources...  
