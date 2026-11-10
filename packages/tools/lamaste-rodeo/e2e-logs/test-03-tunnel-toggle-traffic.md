# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-10 12:55:18 UTC`


## Pre-flight: verify onboarding is complete

✅ `12:55:19` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `12:55:22` HTTP server running on agent at port 18081  
✅ `12:55:22` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `12:55:23` Tunnel creation returned ok: true  
✅ `12:55:23` Tunnel has an ID  
✅ `12:55:23` Tunnel is owned by test-agent  
ℹ️ `12:55:23` Created tunnel ID: 5e976ceb-26f0-4877-ae50-e7e0d9fc51a8  
✅ `12:55:23` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `12:55:27` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `12:55:28` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `12:55:28` Second tunnel creation returned ok: true  
✅ `12:55:28` Second grant hot-reloaded: chisel server not restarted  
✅ `12:56:00` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:56:01` First tunnel still serves alongside the second  
✅ `12:56:02` Agent chisel unit asks for the first tunnel's remote  
✅ `12:56:02` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `12:56:03` Tunnel disable returned ok: true  
✅ `12:56:03` Tunnel shows as disabled in list  
✅ `12:56:03` Chisel grant removed while the tunnel is disabled  
✅ `12:56:03` Second tunnel's grant untouched  
✅ `12:56:03` Revoked grant restarts the chisel server  
✅ `12:56:37` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `12:56:37` Agent chisel unit dropped the disabled tunnel's remote  
✅ `12:56:38` Agent chisel unit still asks for the second tunnel's remote  
✅ `12:56:38` Tunnel content not accessible after disable (vhost removed)  
✅ `12:56:38` Nginx vhost symlink removed after disable  
✅ `12:56:50` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `12:56:50` Tunnel re-enable returned ok: true  
✅ `12:56:50` Tunnel shows as enabled in list  
✅ `12:56:50` Chisel grant restored for the re-enabled tunnel  
✅ `12:56:50` Restored grant hot-reloaded: chisel server not restarted  
✅ `12:57:14` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:57:14` Second tunnel serves alongside the re-enabled one  
✅ `12:57:14` Traffic flows through re-enabled tunnel  
✅ `12:57:14` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `12:57:15` Second agent cert created (e2e-other-1794315318)  
✅ `12:57:15` Tunnel reassigned to e2e-other-1794315318  
✅ `12:57:15` Chisel grant moved to the new owner  
✅ `12:57:15` Chisel grant removed from test-agent  
✅ `12:57:15` test-agent's agent-config no longer lists the tunnel  
✅ `12:57:15` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `12:57:47` test-agent keeps serving its other tunnel after the reassignment  
✅ `12:57:48` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `12:57:59` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `12:57:59` Tunnel handed back to test-agent  
✅ `12:57:59` Chisel grant back with test-agent  
✅ `12:58:22` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:58:22` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `12:58:23` Second tunnel deleted  
✅ `12:58:57` Agent chisel unit dropped the deleted tunnel's remote  
✅ `12:58:57` First tunnel serves after the second was deleted  
✅ `12:59:09` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `12:59:09` TOTP reset returned otpauth URI  
✅ `12:59:09` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:59:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:59:33` Generated TOTP code: 452851  
✅ `12:59:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `12:59:33` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `12:59:33` Cleaning up test resources...  
