# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-11-10 17:51:00 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `17:51:00` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `17:51:01` POST /certs/agent returned ok: true  
✅ `17:51:01` Response label matches agent label  
✅ `17:51:01` Response carries a p12Password  
✅ `17:51:01` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `17:51:01` /me/capabilities returns role=agent for an agent cert  
✅ `17:51:01` /me/capabilities response contains tunnels:read  
✅ `17:51:01` /me/capabilities response contains sites:read  
✅ `17:51:01` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `17:51:01` /me/capabilities allowedSites includes site-alpha  
✅ `17:51:01` /me/capabilities allowedSites includes site-beta  
✅ `17:51:01` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `17:51:02` /me/chisel-credential returns a non-empty user  
✅ `17:51:02` /me/chisel-credential returns a non-empty password  
✅ `17:51:02` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `17:51:02` Rotate returned ok: true  
✅ `17:51:02` Rotate response label matches the agent  
✅ `17:51:02` Rotate response carries a non-empty new password  
✅ `17:51:02` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `17:51:03` Agent's /me/chisel-credential returns the rotated password  
✅ `17:51:03` Post-rotate /me/chisel-credential differs from the pre-rotation value  

## 7. Credential issue time: /me/chisel-credential and agent-config

✅ `17:51:03` /me/chisel-credential returns createdAt  
✅ `17:51:03` Admin rotation's createdAt matches /me/chisel-credential  
✅ `17:51:03` agent-config reports chiselCredentialIssuedAt = the credential's createdAt  
✅ `17:51:03` agent-config never carries the chisel password  

## 8. Self-rotation is refused while the credential is fresh (429)

✅ `17:51:03` Agent self-rotation within 10 minutes of issue returns 429  
✅ `17:51:03` 429 response names when the current credential was issued  
✅ `17:51:03` Refused self-rotation left the credential unchanged  

## 9. Self-rotation of a credential older than 10 minutes

✅ `17:51:03` Credential backdated by 11 minutes in the panel's store  
✅ `17:51:04` Self-rotation returns a new password  
✅ `17:51:04` Self-rotation returns the agent's chisel user  
✅ `17:51:04` Self-rotation returns the new createdAt  
✅ `17:51:04` Self-rotated password differs from the previous one  
✅ `17:51:05` /me/chisel-credential returns the self-rotated password  
✅ `17:51:05` agent-config reports the new credential's issue time  
✅ `17:51:05` Chisel authfile holds the self-rotated password and not the replaced one  

## 10. An immediate second self-rotation is refused

✅ `17:51:05` Repeating the self-rotation right away returns 429  
✅ `17:51:05` Refused repeat left the self-rotated credential in place  
✅ `17:51:05` Agent cert cannot use the admin rotation route (403)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `17:51:05` Cleaning up test resources...  
