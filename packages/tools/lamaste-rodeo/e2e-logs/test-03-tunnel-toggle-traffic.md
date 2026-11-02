# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-02 15:41:26 UTC`


## Pre-flight: verify onboarding is complete

✅ `15:41:26` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `15:41:29` HTTP server running on agent at port 18081  
✅ `15:41:29` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `15:41:30` Tunnel creation returned ok: true  
✅ `15:41:30` Tunnel has an ID  
✅ `15:41:30` Tunnel is owned by test-agent  
ℹ️ `15:41:30` Created tunnel ID: 64ff9234-6e34-4ab8-9d21-87084cb3ca13  
✅ `15:41:30` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `15:41:37` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `15:41:37` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `15:41:38` Second tunnel creation returned ok: true  
✅ `15:41:38` Second grant hot-reloaded: chisel server not restarted  
✅ `15:42:11` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `15:42:12` First tunnel still serves alongside the second  
✅ `15:42:12` Agent chisel unit asks for the first tunnel's remote  
✅ `15:42:12` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `15:42:12` Tunnel disable returned ok: true  
✅ `15:42:12` Tunnel shows as disabled in list  
✅ `15:42:12` Chisel grant removed while the tunnel is disabled  
✅ `15:42:12` Second tunnel's grant untouched  
✅ `15:42:12` Revoked grant restarts the chisel server  
✅ `15:42:47` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `15:42:47` Agent chisel unit dropped the disabled tunnel's remote  
✅ `15:42:47` Agent chisel unit still asks for the second tunnel's remote  
✅ `15:42:47` Tunnel content not accessible after disable (vhost removed)  
✅ `15:42:47` Nginx vhost symlink removed after disable  
✅ `15:42:58` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `15:42:58` Tunnel re-enable returned ok: true  
✅ `15:42:59` Tunnel shows as enabled in list  
✅ `15:42:59` Chisel grant restored for the re-enabled tunnel  
✅ `15:42:59` Restored grant hot-reloaded: chisel server not restarted  
✅ `15:43:21` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `15:43:21` Second tunnel serves alongside the re-enabled one  
✅ `15:43:22` Traffic flows through re-enabled tunnel  
✅ `15:43:22` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `15:43:23` Second agent cert created (e2e-other-1793634086)  
✅ `15:43:23` Tunnel reassigned to e2e-other-1793634086  
✅ `15:43:23` Chisel grant moved to the new owner  
✅ `15:43:23` Chisel grant removed from test-agent  
✅ `15:43:23` test-agent's agent-config no longer lists the tunnel  
✅ `15:43:23` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `15:43:55` test-agent keeps serving its other tunnel after the reassignment  
✅ `15:43:55` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `15:44:07` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `15:44:07` Tunnel handed back to test-agent  
✅ `15:44:07` Chisel grant back with test-agent  
✅ `15:44:31` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `15:44:31` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `15:44:32` Second tunnel deleted  
✅ `15:45:05` Agent chisel unit dropped the deleted tunnel's remote  
✅ `15:45:06` First tunnel serves after the second was deleted  
✅ `15:45:17` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `15:45:17` TOTP reset returned otpauth URI  
✅ `15:45:17` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `15:45:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `15:45:32` Generated TOTP code: 652142  
✅ `15:45:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `15:45:33` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `15:45:33` Cleaning up test resources...  
