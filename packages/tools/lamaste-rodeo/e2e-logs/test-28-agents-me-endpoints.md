# Lamaste E2E: 28 — Agents Me Endpoints (Three-VM)

> Started at `2026-11-02 15:54:26 UTC`


## 1. Pre-flight — verify onboarding is complete

✅ `15:54:26` Onboarding status is COMPLETED  

## 2. Create agent cert with known capabilities + allowedSites

✅ `15:54:27` POST /certs/agent returned ok: true  
✅ `15:54:27` Response label matches agent label  
✅ `15:54:27` Response carries a p12Password  
✅ `15:54:27` Extracted PEM cert and key from .p12  

## 3. GET /agents/me/capabilities with agent cert

✅ `15:54:27` /me/capabilities returns role=agent for an agent cert  
✅ `15:54:27` /me/capabilities response contains tunnels:read  
✅ `15:54:27` /me/capabilities response contains sites:read  
✅ `15:54:27` /me/capabilities returns exactly 2 capabilities (the set admin provided)  
✅ `15:54:27` /me/capabilities allowedSites includes site-alpha  
✅ `15:54:27` /me/capabilities allowedSites includes site-beta  
✅ `15:54:27` /me/capabilities returns exactly 2 allowedSites (the set admin provided)  

## 4. GET /agents/me/chisel-credential with agent cert

✅ `15:54:27` /me/chisel-credential returns a non-empty user  
✅ `15:54:27` /me/chisel-credential returns a non-empty password  
✅ `15:54:27` /me/chisel-credential user references the agent label  

## 5. POST /agents/:label/chisel-credential/rotate (admin)

✅ `15:54:27` Rotate returned ok: true  
✅ `15:54:27` Rotate response label matches the agent  
✅ `15:54:27` Rotate response carries a non-empty new password  
✅ `15:54:27` Rotated chisel password differs from pre-rotation password  

## 6. Agent re-fetches /me/chisel-credential — sees rotated password

✅ `15:54:27` Agent's /me/chisel-credential returns the rotated password  
✅ `15:54:27` Post-rotate /me/chisel-credential differs from the pre-rotation value  

## 7. Credential issue time: /me/chisel-credential and agent-config

✅ `15:54:27` /me/chisel-credential returns createdAt  
✅ `15:54:27` Admin rotation's createdAt matches /me/chisel-credential  
✅ `15:54:27` agent-config reports chiselCredentialIssuedAt = the credential's createdAt  
✅ `15:54:27` agent-config never carries the chisel password  

## 8. Self-rotation is refused while the credential is fresh (429)

✅ `15:54:28` Agent self-rotation within 10 minutes of issue returns 429  
✅ `15:54:28` 429 response names when the current credential was issued  
✅ `15:54:28` Refused self-rotation left the credential unchanged  

## 9. Self-rotation of a credential older than 10 minutes

✅ `15:54:28` Credential backdated by 11 minutes in the panel's store  
✅ `15:54:28` Self-rotation returns a new password  
✅ `15:54:28` Self-rotation returns the agent's chisel user  
✅ `15:54:28` Self-rotation returns the new createdAt  
✅ `15:54:28` Self-rotated password differs from the previous one  
✅ `15:54:28` /me/chisel-credential returns the self-rotated password  
✅ `15:54:28` agent-config reports the new credential's issue time  
✅ `15:54:28` Chisel authfile holds the self-rotated password and not the replaced one  

## 10. An immediate second self-rotation is refused

✅ `15:54:29` Repeating the self-rotation right away returns 429  
✅ `15:54:29` Refused repeat left the self-rotated credential in place  
✅ `15:54:29` Agent cert cannot use the admin rotation route (403)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `15:54:29` Cleaning up test resources...  
