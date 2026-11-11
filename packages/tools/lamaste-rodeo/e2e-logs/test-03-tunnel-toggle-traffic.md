# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-10 17:37:40 UTC`


## Pre-flight: verify onboarding is complete

✅ `17:37:41` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `17:37:44` HTTP server running on agent at port 18081  
✅ `17:37:44` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `17:37:45` Tunnel creation returned ok: true  
✅ `17:37:45` Tunnel has an ID  
✅ `17:37:45` Tunnel is owned by test-agent  
ℹ️ `17:37:45` Created tunnel ID: c5bbccf0-6519-4482-90d3-c8252effb701  
✅ `17:37:45` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `17:37:52` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `17:37:52` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `17:37:53` Second tunnel creation returned ok: true  
✅ `17:37:53` Second grant hot-reloaded: chisel server not restarted  
✅ `17:38:26` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:38:27` First tunnel still serves alongside the second  
✅ `17:38:27` Agent chisel unit asks for the first tunnel's remote  
✅ `17:38:27` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `17:38:28` Tunnel disable returned ok: true  
✅ `17:38:28` Tunnel shows as disabled in list  
✅ `17:38:28` Chisel grant removed while the tunnel is disabled  
✅ `17:38:28` Second tunnel's grant untouched  
✅ `17:38:28` Revoked grant restarts the chisel server  
✅ `17:39:02` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `17:39:02` Agent chisel unit dropped the disabled tunnel's remote  
✅ `17:39:02` Agent chisel unit still asks for the second tunnel's remote  
✅ `17:39:02` Tunnel content not accessible after disable (vhost removed)  
✅ `17:39:02` Nginx vhost symlink removed after disable  
✅ `17:39:13` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `17:39:14` Tunnel re-enable returned ok: true  
✅ `17:39:14` Tunnel shows as enabled in list  
✅ `17:39:14` Chisel grant restored for the re-enabled tunnel  
✅ `17:39:14` Restored grant hot-reloaded: chisel server not restarted  
✅ `17:39:37` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:39:37` Second tunnel serves alongside the re-enabled one  
✅ `17:39:37` Traffic flows through re-enabled tunnel  
✅ `17:39:37` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `17:39:38` Second agent cert created (e2e-other-1794332260)  
✅ `17:39:39` Tunnel reassigned to e2e-other-1794332260  
✅ `17:39:39` Chisel grant moved to the new owner  
✅ `17:39:39` Chisel grant removed from test-agent  
✅ `17:39:39` test-agent's agent-config no longer lists the tunnel  
✅ `17:39:39` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `17:40:13` test-agent keeps serving its other tunnel after the reassignment  
✅ `17:40:13` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `17:40:24` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `17:40:25` Tunnel handed back to test-agent  
✅ `17:40:25` Chisel grant back with test-agent  
✅ `17:40:47` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:40:48` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `17:40:48` Second tunnel deleted  
✅ `17:41:22` Agent chisel unit dropped the deleted tunnel's remote  
✅ `17:41:22` First tunnel serves after the second was deleted  
✅ `17:41:33` Deleted tunnel's port stays closed  

## A burst of revocations leaves chisel running

✅ `17:41:33` The chisel unit has no start rate limit  
✅ `17:41:45` Tunnel enabled after the burst  
ℹ️ `17:41:48` Chisel started 6 time(s) for twelve concurrent toggles  
✅ `17:41:48` Chisel is active after the burst  
✅ `17:41:49` Chisel is not in the failed state  
✅ `17:41:51` The tunnel serves again after the burst  

## A failed chisel is recovered by the panel

✅ `17:41:51` Chisel is forced into the failed state  
✅ `17:41:52` The failure is a start-limit hit  
✅ `17:41:58` The panel recovered chisel from the failed state within 75 seconds  
✅ `17:41:59` Administrators are notified of the recovery  
✅ `17:42:08` The tunnel serves again after the recovery  

## Reset TOTP before authentication

✅ `17:42:08` TOTP reset returned otpauth URI  
✅ `17:42:08` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `17:42:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `17:42:33` Generated TOTP code: 973006  
✅ `17:42:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `17:42:33` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `66` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `66` |

ℹ️ `17:42:33` Cleaning up test resources...  
