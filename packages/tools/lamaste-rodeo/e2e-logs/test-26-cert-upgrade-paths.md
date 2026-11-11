# Lamaste E2E: 26 — Cert Upgrade Paths (Three-VM)

> Started at `2026-11-10 17:50:35 UTC`


## Pre-flight: verify onboarding is complete

✅ `17:50:35` Onboarding must be COMPLETED for cert upgrade path tests  

## Clear any stale test state from previous runs


## Create fixture site for allowed-sites scoping

✅ `17:50:36` Fixture site created (ok: true)  

## Create agent cert (p12) with tunnels:read

✅ `17:50:38` Agent cert creation returned ok: true  

## Agent upgrade-cert: generate new CSR, post with agent cert, assert new cert issued

✅ `17:50:40` upgrade-cert returned ok: true  
✅ `17:50:40` upgrade-cert returns a new certificate serial  
✅ `17:50:40` upgrade-cert issues a cert with a different serial than the old one  
✅ `17:50:40` upgrade-cert response contains a signed certificate PEM  
✅ `17:50:40` After upgrade-cert, agent registry shows enrollmentMethod=hardware-bound  
✅ `17:50:40` Old agent cert has been revoked during upgrade (revoked_certs grew)  

## enroll-delegated: validate role guards

✅ `17:50:40` enroll-delegated rejects admin cert with 403 (route requires agent role)  
✅ `17:50:40` New cert PEM successfully written to host  
✅ `17:50:40` enroll-delegated returns 4xx for agent without ticket scope/instance  
ℹ️ `17:50:40` enroll-delegated with agent cert (no ticket instance) returned HTTP 403  

## PATCH /certs/agent/:label/allowed-sites

✅ `17:50:41` PATCH allowed-sites=[] returned ok: true  
✅ `17:50:41` PATCH allowed-sites response echoes agent label  
✅ `17:50:41` PATCH allowed-sites=[cert-upgrade-site] returned ok: true  
✅ `17:50:41` PATCH allowed-sites response lists the fixture site  
✅ `17:50:41` allowedSites persists to agent registry after PATCH  
✅ `17:50:41` PATCH allowed-sites rejects uppercase site names with 400 (Zod regex validation)  
✅ `17:50:41` PATCH allowed-sites on unknown label returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `17:50:41` Cleaning up test resources...  
