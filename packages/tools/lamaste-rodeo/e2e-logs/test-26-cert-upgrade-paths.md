# Lamaste E2E: 26 — Cert Upgrade Paths (Three-VM)

> Started at `2026-04-30 09:10:34 UTC`


## Pre-flight: verify onboarding is complete

✅ `09:10:34` Onboarding must be COMPLETED for cert upgrade path tests  

## Clear any stale test state from previous runs


## Create fixture site for allowed-sites scoping

✅ `09:10:35` Fixture site created (ok: true)  

## Create agent cert (p12) with tunnels:read

✅ `09:10:36` Agent cert creation returned ok: true  

## Agent upgrade-cert: generate new CSR, post with agent cert, assert new cert issued

✅ `09:10:37` upgrade-cert returned ok: true  
✅ `09:10:37` upgrade-cert returns a new certificate serial  
✅ `09:10:37` upgrade-cert issues a cert with a different serial than the old one  
✅ `09:10:37` upgrade-cert response contains a signed certificate PEM  
✅ `09:10:37` After upgrade-cert, agent registry shows enrollmentMethod=hardware-bound  
✅ `09:10:37` Old agent cert has been revoked during upgrade (revoked.json count grew)  

## enroll-delegated: validate role guards

✅ `09:10:37` enroll-delegated rejects admin cert with 403 (route requires agent role)  
✅ `09:10:37` New cert PEM successfully written to host  
✅ `09:10:37` enroll-delegated returns 4xx for agent without ticket scope/instance  
ℹ️ `09:10:37` enroll-delegated with agent cert (no ticket instance) returned HTTP 403  

## PATCH /certs/agent/:label/allowed-sites

✅ `09:10:37` PATCH allowed-sites=[] returned ok: true  
✅ `09:10:37` PATCH allowed-sites response echoes agent label  
✅ `09:10:38` PATCH allowed-sites=[cert-upgrade-site] returned ok: true  
✅ `09:10:38` PATCH allowed-sites response lists the fixture site  
✅ `09:10:38` allowedSites persists to agent registry after PATCH  
✅ `09:10:38` PATCH allowed-sites rejects uppercase site names with 400 (Zod regex validation)  
✅ `09:10:38` PATCH allowed-sites on unknown label returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `09:10:38` Cleaning up test resources...  
