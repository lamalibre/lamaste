# Lamaste E2E: 29 — Service Logs WebSocket (Three-VM)

> Started at `2026-11-04 13:39:12 UTC`


## Initialize variables for cleanup safety


## Pre-flight: verify onboarding is complete

✅ `13:39:13` Onboarding is COMPLETED before running logs WS tests  

## Install WS helper script on host


## Happy path: stream logs for nginx

✅ `13:39:13` WebSocket upgrade succeeds for nginx (opened: true)  
✅ `13:39:13` nginx logs stream closes with code 1000 (normal)  
✅ `13:39:13` nginx logs stream delivered at least one message (count > 0)  
✅ `13:39:13` First nginx log message has 'timestamp' and 'message' fields  

## Other allowed services accept WS upgrade

✅ `13:39:14` WebSocket upgrade succeeds for authelia (opened: true)  
✅ `13:39:14` authelia logs stream closes with code 1000 (normal)  
✅ `13:39:14` WebSocket upgrade succeeds for chisel (opened: true)  
✅ `13:39:14` chisel logs stream closes with code 1000 (normal)  
✅ `13:39:14` WebSocket upgrade succeeds for lamalibre-lamaste-serverd (opened: true)  
✅ `13:39:14` lamalibre-lamaste-serverd logs stream closes with code 1000 (normal)  

## Error path: unknown service rejected

✅ `13:39:14` Unknown service name closes WebSocket with code 1008 (policy violation)  
✅ `13:39:14` Unknown service close reason is the expected 'Unknown service'  
✅ `13:39:14` No log messages are streamed for an unknown service name  

## Error path: path injection rejected

✅ `13:39:15` Path traversal attempt (..%2Fetc%2Fpasswd) closes WebSocket with code 1008  
✅ `13:39:15` Path traversal attempt is rejected with 'Unknown service' close reason (allowlist guard)  
✅ `13:39:15` No log messages are streamed for a path traversal attempt  
✅ `13:39:15` Service not in allowlist (lamalibre-lamaste-gatekeeper) is rejected with close code 1008  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

