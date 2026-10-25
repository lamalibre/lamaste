# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-10-25 17:14:51 UTC`


## Pre-flight: verify onboarding is complete

✅ `17:14:51` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `17:14:54` HTTP server running on agent at port 18081  
✅ `17:14:54` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `17:14:55` Tunnel creation returned ok: true  
✅ `17:14:55` Tunnel has an ID  
✅ `17:14:55` Tunnel is owned by test-agent  
ℹ️ `17:14:55` Created tunnel ID: f4f14a7c-2409-455a-ba38-b7372e815f4b  
✅ `17:14:55` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `17:15:08` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `17:15:09` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `17:15:09` Second tunnel creation returned ok: true  
✅ `17:15:09` Second grant hot-reloaded: chisel server not restarted  
✅ `17:15:43` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:15:43` First tunnel still serves alongside the second  
✅ `17:15:44` Agent chisel unit asks for the first tunnel's remote  
✅ `17:15:44` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `17:15:44` Tunnel disable returned ok: true  
✅ `17:15:44` Tunnel shows as disabled in list  
✅ `17:15:44` Chisel grant removed while the tunnel is disabled  
✅ `17:15:44` Second tunnel's grant untouched  
✅ `17:15:44` Revoked grant restarts the chisel server  
✅ `17:16:18` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `17:16:19` Agent chisel unit dropped the disabled tunnel's remote  
✅ `17:16:19` Agent chisel unit still asks for the second tunnel's remote  
✅ `17:16:19` Tunnel content not accessible after disable (vhost removed)  
✅ `17:16:19` Nginx vhost symlink removed after disable  
✅ `17:16:30` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `17:16:30` Tunnel re-enable returned ok: true  
✅ `17:16:31` Tunnel shows as enabled in list  
✅ `17:16:31` Chisel grant restored for the re-enabled tunnel  
✅ `17:16:31` Restored grant hot-reloaded: chisel server not restarted  
✅ `17:16:54` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:16:54` Second tunnel serves alongside the re-enabled one  
✅ `17:16:54` Traffic flows through re-enabled tunnel  
✅ `17:16:54` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `17:16:55` Second agent cert created (e2e-other-1792948491)  
✅ `17:16:55` Tunnel reassigned to e2e-other-1792948491  
✅ `17:16:55` Chisel grant moved to the new owner  
✅ `17:16:55` Chisel grant removed from test-agent  
✅ `17:16:55` test-agent's agent-config no longer lists the tunnel  
✅ `17:16:56` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `17:17:30` test-agent keeps serving its other tunnel after the reassignment  
✅ `17:17:30` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `17:17:42` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `17:17:42` Tunnel handed back to test-agent  
✅ `17:17:42` Chisel grant back with test-agent  
✅ `17:18:05` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:18:05` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `17:18:05` Second tunnel deleted  
✅ `17:18:39` Agent chisel unit dropped the deleted tunnel's remote  
✅ `17:18:39` First tunnel serves after the second was deleted  
✅ `17:18:49` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `17:18:49` TOTP reset returned otpauth URI  
✅ `17:18:49` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `17:19:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `17:19:02` Generated TOTP code: 525577  
✅ `17:19:02` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `17:19:03` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `17:19:03` Cleaning up test resources...  
