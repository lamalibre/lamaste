# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-04-30 09:10:54 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `09:10:54` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `09:10:56` POST /certs/agent returned ok: true  
✅ `09:10:56` Response label matches agent label  
✅ `09:10:56` Response carries a p12Password  
✅ `09:10:56` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `09:10:56` /me/capabilities returns role=agent for an agent cert  
✅ `09:10:56` /me/capabilities response contains tunnels:read  
✅ `09:10:56` /me/capabilities response contains sites:read  
✅ `09:10:56` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `09:10:56` /me/capabilities allowedSites includes site-alpha  
✅ `09:10:56` /me/capabilities allowedSites includes site-beta  
✅ `09:10:56` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `09:10:56` /me/chisel-credential returns a non-empty user  
✅ `09:10:56` /me/chisel-credential returns a non-empty password  
✅ `09:10:56` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `09:10:56` Rotate returned ok: true  
✅ `09:10:56` Rotate response label matches the agent  
✅ `09:10:56` Rotate response carries a non-empty new password  
✅ `09:10:56` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `09:10:57` Agent's /me/chisel-credential returns the rotated password  
✅ `09:10:57` Post-rotate /me/chisel-credential differs from the pre-rotation value  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `09:10:57` Cleaning up test resources...  
