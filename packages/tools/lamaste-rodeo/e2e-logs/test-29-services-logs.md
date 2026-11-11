# Lamaste E2E: 29 — Service Logs WebSocket (Three-VM)

> Started at `2026-11-10 17:51:07 UTC`


## Initialize variables for cleanup safety


## Pre-flight: verify onboarding is complete

✅ `17:51:07` Onboarding is COMPLETED before running logs WS tests  

## Install WS helper script on host


## Happy path: stream logs for nginx

✅ `17:51:07` WebSocket upgrade succeeds for nginx (opened: true)  
✅ `17:51:07` nginx logs stream closes with code 1000 (normal)  
✅ `17:51:07` nginx logs stream delivered at least one message (count > 0)  
✅ `17:51:07` First nginx log message has 'timestamp' and 'message' fields  

## Other allowed services accept WS upgrade

✅ `17:51:07` WebSocket upgrade succeeds for authelia (opened: true)  
✅ `17:51:07` authelia logs stream closes with code 1000 (normal)  
✅ `17:51:08` WebSocket upgrade succeeds for chisel (opened: true)  
✅ `17:51:08` chisel logs stream closes with code 1000 (normal)  
✅ `17:51:08` WebSocket upgrade succeeds for lamalibre-lamaste-serverd (opened: true)  
✅ `17:51:08` lamalibre-lamaste-serverd logs stream closes with code 1000 (normal)  

## Error path: unknown service rejected

✅ `17:51:08` Unknown service name closes WebSocket with code 1008 (policy violation)  
✅ `17:51:08` Unknown service close reason is the expected 'Unknown service'  
✅ `17:51:08` No log messages are streamed for an unknown service name  

## Error path: path injection rejected

✅ `17:51:08` Path traversal attempt (..%2Fetc%2Fpasswd) closes WebSocket with code 1008  
✅ `17:51:08` Path traversal attempt is rejected with 'Unknown service' close reason (allowlist guard)  
✅ `17:51:08` No log messages are streamed for a path traversal attempt  
✅ `17:51:09` Service not in allowlist (lamalibre-lamaste-gatekeeper) is rejected with close code 1008  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

