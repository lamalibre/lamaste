# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-11-04 13:39:05 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `13:39:05` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `13:39:07` POST /certs/agent returned ok: true  
✅ `13:39:07` Response label matches agent label  
✅ `13:39:07` Response carries a p12Password  
✅ `13:39:08` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `13:39:08` /me/capabilities returns role=agent for an agent cert  
✅ `13:39:08` /me/capabilities response contains tunnels:read  
✅ `13:39:08` /me/capabilities response contains sites:read  
✅ `13:39:08` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `13:39:08` /me/capabilities allowedSites includes site-alpha  
✅ `13:39:08` /me/capabilities allowedSites includes site-beta  
✅ `13:39:08` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `13:39:08` /me/chisel-credential returns a non-empty user  
✅ `13:39:08` /me/chisel-credential returns a non-empty password  
✅ `13:39:08` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `13:39:09` Rotate returned ok: true  
✅ `13:39:09` Rotate response label matches the agent  
✅ `13:39:09` Rotate response carries a non-empty new password  
✅ `13:39:09` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `13:39:09` Agent's /me/chisel-credential returns the rotated password  
✅ `13:39:09` Post-rotate /me/chisel-credential differs from the pre-rotation value  

## 7. Credential issue time: /me/chisel-credential and agent-config

✅ `13:39:09` /me/chisel-credential returns createdAt  
✅ `13:39:09` Admin rotation's createdAt matches /me/chisel-credential  
✅ `13:39:09` agent-config reports chiselCredentialIssuedAt = the credential's createdAt  
✅ `13:39:09` agent-config never carries the chisel password  

## 8. Self-rotation is refused while the credential is fresh (429)

✅ `13:39:10` Agent self-rotation within 10 minutes of issue returns 429  
✅ `13:39:10` 429 response names when the current credential was issued  
✅ `13:39:10` Refused self-rotation left the credential unchanged  

## 9. Self-rotation of a credential older than 10 minutes

✅ `13:39:10` Credential backdated by 11 minutes in the panel's store  
✅ `13:39:10` Self-rotation returns a new password  
✅ `13:39:10` Self-rotation returns the agent's chisel user  
✅ `13:39:10` Self-rotation returns the new createdAt  
✅ `13:39:10` Self-rotated password differs from the previous one  
✅ `13:39:11` /me/chisel-credential returns the self-rotated password  
✅ `13:39:11` agent-config reports the new credential's issue time  
✅ `13:39:11` Chisel authfile holds the self-rotated password and not the replaced one  

## 10. An immediate second self-rotation is refused

✅ `13:39:11` Repeating the self-rotation right away returns 429  
✅ `13:39:12` Refused repeat left the self-rotated credential in place  
✅ `13:39:12` Agent cert cannot use the admin rotation route (403)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `13:39:12` Cleaning up test resources...  
