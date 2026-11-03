# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-11-03 09:33:56 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `09:33:56` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `09:33:57` POST /certs/agent returned ok: true  
✅ `09:33:57` Response label matches agent label  
✅ `09:33:57` Response carries a p12Password  
✅ `09:33:58` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `09:33:58` /me/capabilities returns role=agent for an agent cert  
✅ `09:33:58` /me/capabilities response contains tunnels:read  
✅ `09:33:58` /me/capabilities response contains sites:read  
✅ `09:33:58` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `09:33:58` /me/capabilities allowedSites includes site-alpha  
✅ `09:33:58` /me/capabilities allowedSites includes site-beta  
✅ `09:33:58` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `09:33:58` /me/chisel-credential returns a non-empty user  
✅ `09:33:58` /me/chisel-credential returns a non-empty password  
✅ `09:33:58` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `09:33:58` Rotate returned ok: true  
✅ `09:33:58` Rotate response label matches the agent  
✅ `09:33:58` Rotate response carries a non-empty new password  
✅ `09:33:58` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `09:33:58` Agent's /me/chisel-credential returns the rotated password  
✅ `09:33:58` Post-rotate /me/chisel-credential differs from the pre-rotation value  

## 7. Credential issue time: /me/chisel-credential and agent-config

✅ `09:33:58` /me/chisel-credential returns createdAt  
✅ `09:33:58` Admin rotation's createdAt matches /me/chisel-credential  
✅ `09:33:58` agent-config reports chiselCredentialIssuedAt = the credential's createdAt  
✅ `09:33:58` agent-config never carries the chisel password  

## 8. Self-rotation is refused while the credential is fresh (429)

✅ `09:33:58` Agent self-rotation within 10 minutes of issue returns 429  
✅ `09:33:58` 429 response names when the current credential was issued  
✅ `09:33:59` Refused self-rotation left the credential unchanged  

## 9. Self-rotation of a credential older than 10 minutes

✅ `09:33:59` Credential backdated by 11 minutes in the panel's store  
✅ `09:33:59` Self-rotation returns a new password  
✅ `09:33:59` Self-rotation returns the agent's chisel user  
✅ `09:33:59` Self-rotation returns the new createdAt  
✅ `09:33:59` Self-rotated password differs from the previous one  
✅ `09:33:59` /me/chisel-credential returns the self-rotated password  
✅ `09:33:59` agent-config reports the new credential's issue time  
✅ `09:33:59` Chisel authfile holds the self-rotated password and not the replaced one  

## 10. An immediate second self-rotation is refused

✅ `09:33:59` Repeating the self-rotation right away returns 429  
✅ `09:34:00` Refused repeat left the self-rotated credential in place  
✅ `09:34:00` Agent cert cannot use the admin rotation route (403)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `09:34:00` Cleaning up test resources...  
