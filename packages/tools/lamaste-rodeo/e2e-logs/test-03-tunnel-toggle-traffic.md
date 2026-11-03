# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-03 09:21:41 UTC`


## Pre-flight: verify onboarding is complete

✅ `09:21:41` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `09:21:44` HTTP server running on agent at port 18081  
✅ `09:21:44` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `09:21:44` Tunnel creation returned ok: true  
✅ `09:21:44` Tunnel has an ID  
✅ `09:21:44` Tunnel is owned by test-agent  
ℹ️ `09:21:44` Created tunnel ID: d75b6df1-35d4-446c-8e25-2bb0b2ad0ac5  
✅ `09:21:45` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `09:21:51` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `09:21:51` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `09:21:52` Second tunnel creation returned ok: true  
✅ `09:21:52` Second grant hot-reloaded: chisel server not restarted  
✅ `09:22:23` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `09:22:23` First tunnel still serves alongside the second  
✅ `09:22:23` Agent chisel unit asks for the first tunnel's remote  
✅ `09:22:23` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `09:22:24` Tunnel disable returned ok: true  
✅ `09:22:24` Tunnel shows as disabled in list  
✅ `09:22:24` Chisel grant removed while the tunnel is disabled  
✅ `09:22:24` Second tunnel's grant untouched  
✅ `09:22:24` Revoked grant restarts the chisel server  
✅ `09:22:57` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `09:22:57` Agent chisel unit dropped the disabled tunnel's remote  
✅ `09:22:57` Agent chisel unit still asks for the second tunnel's remote  
✅ `09:22:57` Tunnel content not accessible after disable (vhost removed)  
✅ `09:22:57` Nginx vhost symlink removed after disable  
✅ `09:23:08` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `09:23:09` Tunnel re-enable returned ok: true  
✅ `09:23:09` Tunnel shows as enabled in list  
✅ `09:23:09` Chisel grant restored for the re-enabled tunnel  
✅ `09:23:09` Restored grant hot-reloaded: chisel server not restarted  
✅ `09:23:33` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `09:23:33` Second tunnel serves alongside the re-enabled one  
✅ `09:23:33` Traffic flows through re-enabled tunnel  
✅ `09:23:34` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `09:23:35` Second agent cert created (e2e-other-1793697701)  
✅ `09:23:35` Tunnel reassigned to e2e-other-1793697701  
✅ `09:23:35` Chisel grant moved to the new owner  
✅ `09:23:35` Chisel grant removed from test-agent  
✅ `09:23:36` test-agent's agent-config no longer lists the tunnel  
✅ `09:23:36` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `09:24:09` test-agent keeps serving its other tunnel after the reassignment  
✅ `09:24:09` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `09:24:20` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `09:24:20` Tunnel handed back to test-agent  
✅ `09:24:20` Chisel grant back with test-agent  
✅ `09:24:42` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `09:24:43` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `09:24:43` Second tunnel deleted  
✅ `09:25:18` Agent chisel unit dropped the deleted tunnel's remote  
✅ `09:25:18` First tunnel serves after the second was deleted  
✅ `09:25:29` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `09:25:29` TOTP reset returned otpauth URI  
✅ `09:25:29` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `09:25:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `09:25:33` Generated TOTP code: 763097  
✅ `09:25:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `09:25:33` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `09:25:33` Cleaning up test resources...  
