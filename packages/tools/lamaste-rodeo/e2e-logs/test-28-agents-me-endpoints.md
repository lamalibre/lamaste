# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-11-09 12:45:57 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `12:45:57` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `12:46:00` POST /certs/agent returned ok: true  
✅ `12:46:00` Response label matches agent label  
✅ `12:46:00` Response carries a p12Password  
✅ `12:46:01` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `12:46:01` /me/capabilities returns role=agent for an agent cert  
✅ `12:46:01` /me/capabilities response contains tunnels:read  
✅ `12:46:01` /me/capabilities response contains sites:read  
✅ `12:46:01` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `12:46:01` /me/capabilities allowedSites includes site-alpha  
✅ `12:46:01` /me/capabilities allowedSites includes site-beta  
✅ `12:46:01` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `12:46:01` /me/chisel-credential returns a non-empty user  
✅ `12:46:01` /me/chisel-credential returns a non-empty password  
✅ `12:46:01` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `12:46:01` Rotate returned ok: true  
✅ `12:46:01` Rotate response label matches the agent  
✅ `12:46:01` Rotate response carries a non-empty new password  
✅ `12:46:01` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `12:46:01` Agent's /me/chisel-credential returns the rotated password  
✅ `12:46:01` Post-rotate /me/chisel-credential differs from the pre-rotation value  

## 7. Credential issue time: /me/chisel-credential and agent-config

✅ `12:46:01` /me/chisel-credential returns createdAt  
✅ `12:46:01` Admin rotation's createdAt matches /me/chisel-credential  
✅ `12:46:01` agent-config reports chiselCredentialIssuedAt = the credential's createdAt  
✅ `12:46:01` agent-config never carries the chisel password  

## 8. Self-rotation is refused while the credential is fresh (429)

✅ `12:46:02` Agent self-rotation within 10 minutes of issue returns 429  
✅ `12:46:02` 429 response names when the current credential was issued  
✅ `12:46:02` Refused self-rotation left the credential unchanged  

## 9. Self-rotation of a credential older than 10 minutes

✅ `12:46:02` Credential backdated by 11 minutes in the panel's store  
✅ `12:46:02` Self-rotation returns a new password  
✅ `12:46:02` Self-rotation returns the agent's chisel user  
✅ `12:46:02` Self-rotation returns the new createdAt  
✅ `12:46:02` Self-rotated password differs from the previous one  
✅ `12:46:02` /me/chisel-credential returns the self-rotated password  
✅ `12:46:02` agent-config reports the new credential's issue time  
✅ `12:46:02` Chisel authfile holds the self-rotated password and not the replaced one  

## 10. An immediate second self-rotation is refused

✅ `12:46:03` Repeating the self-rotation right away returns 429  
✅ `12:46:03` Refused repeat left the self-rotated credential in place  
✅ `12:46:03` Agent cert cannot use the admin rotation route (403)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `12:46:03` Cleaning up test resources...  
