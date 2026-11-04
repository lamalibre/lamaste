# Lamaste E2E: 26 — Cert Upgrade Paths (Three-VM)

> Started at `2026-11-04 13:38:36 UTC`


## Pre-flight: verify onboarding is complete

✅ `13:38:37` Onboarding must be COMPLETED for cert upgrade path tests  

## Clear any stale test state from previous runs


## Create fixture site for allowed-sites scoping

✅ `13:38:39` Fixture site created (ok: true)  

## Create agent cert (p12) with tunnels:read

✅ `13:38:41` Agent cert creation returned ok: true  

## Agent upgrade-cert: generate new CSR, post with agent cert, assert new cert issued

✅ `13:38:43` upgrade-cert returned ok: true  
✅ `13:38:43` upgrade-cert returns a new certificate serial  
✅ `13:38:43` upgrade-cert issues a cert with a different serial than the old one  
✅ `13:38:43` upgrade-cert response contains a signed certificate PEM  
✅ `13:38:43` After upgrade-cert, agent registry shows enrollmentMethod=hardware-bound  
✅ `13:38:43` Old agent cert has been revoked during upgrade (revoked_certs grew)  

## enroll-delegated: validate role guards

✅ `13:38:44` enroll-delegated rejects admin cert with 403 (route requires agent role)  
✅ `13:38:44` New cert PEM successfully written to host  
✅ `13:38:44` enroll-delegated returns 4xx for agent without ticket scope/instance  
ℹ️ `13:38:44` enroll-delegated with agent cert (no ticket instance) returned HTTP 403  

## PATCH /certs/agent/:label/allowed-sites

✅ `13:38:45` PATCH allowed-sites=[] returned ok: true  
✅ `13:38:45` PATCH allowed-sites response echoes agent label  
✅ `13:38:45` PATCH allowed-sites=[cert-upgrade-site] returned ok: true  
✅ `13:38:45` PATCH allowed-sites response lists the fixture site  
✅ `13:38:45` allowedSites persists to agent registry after PATCH  
✅ `13:38:45` PATCH allowed-sites rejects uppercase site names with 400 (Zod regex validation)  
✅ `13:38:45` PATCH allowed-sites on unknown label returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `13:38:45` Cleaning up test resources...  
