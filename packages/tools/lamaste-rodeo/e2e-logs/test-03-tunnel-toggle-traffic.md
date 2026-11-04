# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-04 13:25:42 UTC`


## Pre-flight: verify onboarding is complete

✅ `13:25:42` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `13:25:45` HTTP server running on agent at port 18081  
✅ `13:25:45` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `13:25:46` Tunnel creation returned ok: true  
✅ `13:25:46` Tunnel has an ID  
✅ `13:25:46` Tunnel is owned by test-agent  
ℹ️ `13:25:46` Created tunnel ID: acfeee70-1f10-4c70-8f0d-3b4926e02aca  
✅ `13:25:46` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `13:25:49` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `13:25:49` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `13:25:50` Second tunnel creation returned ok: true  
✅ `13:25:50` Second grant hot-reloaded: chisel server not restarted  
✅ `13:26:25` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `13:26:25` First tunnel still serves alongside the second  
✅ `13:26:25` Agent chisel unit asks for the first tunnel's remote  
✅ `13:26:26` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `13:26:26` Tunnel disable returned ok: true  
✅ `13:26:26` Tunnel shows as disabled in list  
✅ `13:26:26` Chisel grant removed while the tunnel is disabled  
✅ `13:26:26` Second tunnel's grant untouched  
✅ `13:26:26` Revoked grant restarts the chisel server  
✅ `13:27:00` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `13:27:00` Agent chisel unit dropped the disabled tunnel's remote  
✅ `13:27:00` Agent chisel unit still asks for the second tunnel's remote  
✅ `13:27:00` Tunnel content not accessible after disable (vhost removed)  
✅ `13:27:00` Nginx vhost symlink removed after disable  
✅ `13:27:11` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `13:27:11` Tunnel re-enable returned ok: true  
✅ `13:27:11` Tunnel shows as enabled in list  
✅ `13:27:12` Chisel grant restored for the re-enabled tunnel  
✅ `13:27:12` Restored grant hot-reloaded: chisel server not restarted  
✅ `13:27:34` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `13:27:34` Second tunnel serves alongside the re-enabled one  
✅ `13:27:34` Traffic flows through re-enabled tunnel  
✅ `13:27:34` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `13:27:35` Second agent cert created (e2e-other-1793798742)  
✅ `13:27:36` Tunnel reassigned to e2e-other-1793798742  
✅ `13:27:36` Chisel grant moved to the new owner  
✅ `13:27:36` Chisel grant removed from test-agent  
✅ `13:27:36` test-agent's agent-config no longer lists the tunnel  
✅ `13:27:36` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `13:28:09` test-agent keeps serving its other tunnel after the reassignment  
✅ `13:28:09` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `13:28:20` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `13:28:20` Tunnel handed back to test-agent  
✅ `13:28:21` Chisel grant back with test-agent  
✅ `13:28:45` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `13:28:45` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `13:28:45` Second tunnel deleted  
✅ `13:29:18` Agent chisel unit dropped the deleted tunnel's remote  
✅ `13:29:18` First tunnel serves after the second was deleted  
✅ `13:29:29` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `13:29:31` TOTP reset returned otpauth URI  
✅ `13:29:31` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `13:30:03` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `13:30:03` Generated TOTP code: 767070  
✅ `13:30:03` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `13:30:03` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `13:30:03` Cleaning up test resources...  
