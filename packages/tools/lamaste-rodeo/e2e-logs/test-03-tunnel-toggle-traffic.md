# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-10-13 11:40:12 UTC`


## Pre-flight: verify onboarding is complete

✅ `11:40:12` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `11:40:15` HTTP server running on agent at port 18081  
✅ `11:40:15` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `11:40:16` Tunnel creation returned ok: true  
✅ `11:40:16` Tunnel has an ID  
✅ `11:40:16` Tunnel is owned by test-agent  
ℹ️ `11:40:16` Created tunnel ID: 9172138e-5c8d-40d2-9fc0-f07a0d390672  
✅ `11:40:16` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `11:40:21` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `11:40:21` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `11:40:22` Second tunnel creation returned ok: true  
✅ `11:40:22` Second grant hot-reloaded: chisel server not restarted  
✅ `11:40:56` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `11:40:56` First tunnel still serves alongside the second  
✅ `11:40:57` Agent chisel unit asks for the first tunnel's remote  
✅ `11:40:57` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `11:40:57` Tunnel disable returned ok: true  
✅ `11:40:57` Tunnel shows as disabled in list  
✅ `11:40:57` Chisel grant removed while the tunnel is disabled  
✅ `11:40:57` Second tunnel's grant untouched  
✅ `11:40:57` Revoked grant restarts the chisel server  
✅ `11:41:31` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `11:41:31` Agent chisel unit dropped the disabled tunnel's remote  
✅ `11:41:31` Agent chisel unit still asks for the second tunnel's remote  
✅ `11:41:31` Tunnel content not accessible after disable (vhost removed)  
✅ `11:41:31` Nginx vhost symlink removed after disable  
✅ `11:41:42` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `11:41:43` Tunnel re-enable returned ok: true  
✅ `11:41:43` Tunnel shows as enabled in list  
✅ `11:41:43` Chisel grant restored for the re-enabled tunnel  
✅ `11:41:43` Restored grant hot-reloaded: chisel server not restarted  
✅ `11:42:06` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `11:42:06` Second tunnel serves alongside the re-enabled one  
✅ `11:42:06` Traffic flows through re-enabled tunnel  
✅ `11:42:06` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `11:42:08` Second agent cert created (e2e-other-1791891612)  
✅ `11:42:08` Tunnel reassigned to e2e-other-1791891612  
✅ `11:42:08` Chisel grant moved to the new owner  
✅ `11:42:08` Chisel grant removed from test-agent  
✅ `11:42:08` test-agent's agent-config no longer lists the tunnel  
✅ `11:42:08` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `11:42:40` test-agent keeps serving its other tunnel after the reassignment  
✅ `11:42:41` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `11:42:52` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `11:42:52` Tunnel handed back to test-agent  
✅ `11:42:52` Chisel grant back with test-agent  
✅ `11:43:15` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `11:43:15` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `11:43:16` Second tunnel deleted  
✅ `11:43:50` Agent chisel unit dropped the deleted tunnel's remote  
✅ `11:43:50` First tunnel serves after the second was deleted  
✅ `11:44:01` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `11:44:01` TOTP reset returned otpauth URI  
✅ `11:44:02` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `11:44:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `11:44:32` Generated TOTP code: 333318  
✅ `11:44:32` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `11:44:32` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `11:44:32` Cleaning up test resources...  
