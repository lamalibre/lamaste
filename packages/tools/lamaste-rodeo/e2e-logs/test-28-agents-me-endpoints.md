# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-10-13 11:52:55 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `11:52:55` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `11:52:56` POST /certs/agent returned ok: true  
✅ `11:52:56` Response label matches agent label  
✅ `11:52:56` Response carries a p12Password  
✅ `11:52:56` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `11:52:56` /me/capabilities returns role=agent for an agent cert  
✅ `11:52:56` /me/capabilities response contains tunnels:read  
✅ `11:52:56` /me/capabilities response contains sites:read  
✅ `11:52:56` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `11:52:56` /me/capabilities allowedSites includes site-alpha  
✅ `11:52:56` /me/capabilities allowedSites includes site-beta  
✅ `11:52:56` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `11:52:57` /me/chisel-credential returns a non-empty user  
✅ `11:52:57` /me/chisel-credential returns a non-empty password  
✅ `11:52:57` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `11:52:57` Rotate returned ok: true  
✅ `11:52:57` Rotate response label matches the agent  
✅ `11:52:57` Rotate response carries a non-empty new password  
✅ `11:52:57` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `11:52:57` Agent's /me/chisel-credential returns the rotated password  
✅ `11:52:57` Post-rotate /me/chisel-credential differs from the pre-rotation value  

## 7. Credential issue time: /me/chisel-credential and agent-config

✅ `11:52:57` /me/chisel-credential returns createdAt  
✅ `11:52:57` Admin rotation's createdAt matches /me/chisel-credential  
✅ `11:52:57` agent-config reports chiselCredentialIssuedAt = the credential's createdAt  
✅ `11:52:57` agent-config never carries the chisel password  

## 8. Self-rotation is refused while the credential is fresh (429)

✅ `11:52:57` Agent self-rotation within 10 minutes of issue returns 429  
✅ `11:52:57` 429 response names when the current credential was issued  
✅ `11:52:57` Refused self-rotation left the credential unchanged  

## 9. Self-rotation of a credential older than 10 minutes

✅ `11:52:57` Credential backdated by 11 minutes in the panel's store  
✅ `11:52:58` Self-rotation returns a new password  
✅ `11:52:58` Self-rotation returns the agent's chisel user  
✅ `11:52:58` Self-rotation returns the new createdAt  
✅ `11:52:58` Self-rotated password differs from the previous one  
✅ `11:52:58` /me/chisel-credential returns the self-rotated password  
✅ `11:52:58` agent-config reports the new credential's issue time  
✅ `11:52:58` Chisel authfile holds the self-rotated password and not the replaced one  

## 10. An immediate second self-rotation is refused

✅ `11:52:58` Repeating the self-rotation right away returns 429  
✅ `11:52:58` Refused repeat left the self-rotated credential in place  
✅ `11:52:58` Agent cert cannot use the admin rotation route (403)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `11:52:58` Cleaning up test resources...  
