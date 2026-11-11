# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-11 10:51:14 UTC`


## Pre-flight: verify onboarding is complete

✅ `10:51:14` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `10:51:18` HTTP server running on agent at port 18081  
✅ `10:51:18` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `10:51:21` Tunnel creation returned ok: true  
✅ `10:51:21` Tunnel has an ID  
✅ `10:51:21` Tunnel is owned by test-agent  
ℹ️ `10:51:21` Created tunnel ID: 78cf9241-187e-4779-b16e-b99254a1311c  
✅ `10:51:21` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `10:51:46` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `10:51:46` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `10:51:49` Second tunnel creation returned ok: true  
✅ `10:51:49` Second grant hot-reloaded: chisel server not restarted  
✅ `10:52:22` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `10:52:22` First tunnel still serves alongside the second  
✅ `10:52:22` Agent chisel unit asks for the first tunnel's remote  
✅ `10:52:22` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `10:52:23` Tunnel disable returned ok: true  
✅ `10:52:23` Tunnel shows as disabled in list  
✅ `10:52:23` Chisel grant removed while the tunnel is disabled  
✅ `10:52:23` Second tunnel's grant untouched  
✅ `10:52:24` Revoked grant restarts the chisel server  
✅ `10:52:56` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `10:52:56` Agent chisel unit dropped the disabled tunnel's remote  
✅ `10:52:56` Agent chisel unit still asks for the second tunnel's remote  
✅ `10:52:56` Tunnel content not accessible after disable (vhost removed)  
✅ `10:52:56` Nginx vhost symlink removed after disable  
✅ `10:53:08` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `10:53:08` Tunnel re-enable returned ok: true  
✅ `10:53:08` Tunnel shows as enabled in list  
✅ `10:53:08` Chisel grant restored for the re-enabled tunnel  
✅ `10:53:08` Restored grant hot-reloaded: chisel server not restarted  
✅ `10:53:32` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `10:53:33` Second tunnel serves alongside the re-enabled one  
✅ `10:53:33` Traffic flows through re-enabled tunnel  
✅ `10:53:33` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `10:53:34` Second agent cert created (e2e-other-1794394274)  
✅ `10:53:37` Tunnel reassigned to e2e-other-1794394274  
✅ `10:53:43` Chisel grant moved to the new owner  
✅ `10:53:46` Chisel grant removed from test-agent  
✅ `10:53:58` test-agent's agent-config no longer lists the tunnel  
✅ `10:54:01` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `10:54:06` test-agent keeps serving its other tunnel after the reassignment  
✅ `10:54:06` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `10:54:17` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `10:54:18` Tunnel handed back to test-agent  
✅ `10:54:18` Chisel grant back with test-agent  
✅ `10:54:41` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `10:54:41` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `10:54:42` Second tunnel deleted  
✅ `10:55:16` Agent chisel unit dropped the deleted tunnel's remote  
✅ `10:55:16` First tunnel serves after the second was deleted  
✅ `10:55:28` Deleted tunnel's port stays closed  

## A burst of revocations leaves chisel running

✅ `10:55:28` The chisel unit has no start rate limit  
✅ `10:55:33` Tunnel enabled after the burst  
ℹ️ `10:55:36` Chisel started 3 time(s) for twelve concurrent toggles  
✅ `10:55:37` Chisel is active after the burst  
✅ `10:55:37` Chisel is not in the failed state  
✅ `10:55:37` The tunnel serves again after the burst  

## A failed chisel is recovered by the panel

✅ `10:55:37` Chisel is forced into the failed state  
✅ `10:55:38` The failure is a start-limit hit  
✅ `10:55:58` The panel recovered chisel from the failed state within 75 seconds  
✅ `10:56:00` Administrators are notified of the recovery  
✅ `10:56:03` The tunnel serves again after the recovery  

## Reset TOTP before authentication

✅ `10:56:03` TOTP reset returned otpauth URI  
✅ `10:56:03` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `10:56:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `10:56:33` Generated TOTP code: 833323  
✅ `10:56:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `10:56:33` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `66` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `66` |

ℹ️ `10:56:33` Cleaning up test resources...  
