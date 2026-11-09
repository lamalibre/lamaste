# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-11-09 12:33:17 UTC`


## Pre-flight: verify onboarding is complete

✅ `12:33:17` Host chisel server is the pinned release 1.12.0  

## Start HTTP servers on the agent

✅ `12:33:20` HTTP server running on agent at port 18081  
✅ `12:33:20` HTTP server running on agent at port 18082  

## Create the first tunnel — it serves with no manual update

✅ `12:33:21` Tunnel creation returned ok: true  
✅ `12:33:21` Tunnel has an ID  
✅ `12:33:21` Tunnel is owned by test-agent  
ℹ️ `12:33:21` Created tunnel ID: fb47defd-cbd6-4ae2-aff4-3aaf012c5be5  
✅ `12:33:21` New grant hot-reloaded: chisel server not restarted by the tunnel creation  
✅ `12:33:25` New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)  
✅ `12:33:25` Traffic flows through the first tunnel  

## Create a second tunnel on the same agent

✅ `12:33:26` Second tunnel creation returned ok: true  
✅ `12:33:26` Second grant hot-reloaded: chisel server not restarted  
✅ `12:34:01` Second tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:34:01` First tunnel still serves alongside the second  
✅ `12:34:02` Agent chisel unit asks for the first tunnel's remote  
✅ `12:34:02` Agent chisel unit asks for the second tunnel's remote  

## Disable the first tunnel — the second keeps serving

✅ `12:34:02` Tunnel disable returned ok: true  
✅ `12:34:02` Tunnel shows as disabled in list  
✅ `12:34:02` Chisel grant removed while the tunnel is disabled  
✅ `12:34:02` Second tunnel's grant untouched  
✅ `12:34:02` Revoked grant restarts the chisel server  
✅ `12:34:35` Second tunnel serves again within 60 seconds of disabling the first (no update)  
✅ `12:34:35` Agent chisel unit dropped the disabled tunnel's remote  
✅ `12:34:35` Agent chisel unit still asks for the second tunnel's remote  
✅ `12:34:35` Tunnel content not accessible after disable (vhost removed)  
✅ `12:34:35` Nginx vhost symlink removed after disable  
✅ `12:34:46` Disabled tunnel's port stays closed  

## Re-enable the first tunnel

✅ `12:34:46` Tunnel re-enable returned ok: true  
✅ `12:34:47` Tunnel shows as enabled in list  
✅ `12:34:47` Chisel grant restored for the re-enabled tunnel  
✅ `12:34:47` Restored grant hot-reloaded: chisel server not restarted  
✅ `12:35:09` Re-enabled tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:35:09` Second tunnel serves alongside the re-enabled one  
✅ `12:35:09` Traffic flows through re-enabled tunnel  
✅ `12:35:09` Nginx vhost restored after re-enable (HTTP 302)  

## Reassign the first tunnel to another agent

✅ `12:35:12` Second agent cert created (e2e-other-1794227597)  
✅ `12:35:12` Tunnel reassigned to e2e-other-1794227597  
✅ `12:35:12` Chisel grant moved to the new owner  
✅ `12:35:12` Chisel grant removed from test-agent  
✅ `12:35:12` test-agent's agent-config no longer lists the tunnel  
✅ `12:35:12` Reassignment (a revocation for the previous owner) restarts the chisel server  
✅ `12:35:45` test-agent keeps serving its other tunnel after the reassignment  
✅ `12:35:45` test-agent's chisel unit dropped the reassigned tunnel's remote  
✅ `12:35:56` Reassigned tunnel's port stays closed (its new owner runs no client)  

## Hand the first tunnel back

✅ `12:35:56` Tunnel handed back to test-agent  
✅ `12:35:57` Chisel grant back with test-agent  
✅ `12:36:21` Handed-back tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:36:21` Traffic flows through the tunnel after it was handed back  

## Delete the second tunnel — the first keeps serving

✅ `12:36:21` Second tunnel deleted  
✅ `12:36:54` Agent chisel unit dropped the deleted tunnel's remote  
✅ `12:36:54` First tunnel serves after the second was deleted  
✅ `12:37:05` Deleted tunnel's port stays closed  

## Reset TOTP before authentication

✅ `12:37:05` TOTP reset returned otpauth URI  
✅ `12:37:05` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:37:33` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:37:33` Generated TOTP code: 534255  
✅ `12:37:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `12:37:33` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `12:37:33` Cleaning up test resources...  
