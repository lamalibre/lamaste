# Lamaste E2E: 29 — Service Logs WebSocket (Three-VM)

> Started at `2026-11-09 12:46:03 UTC`


## Initialize variables for cleanup safety


## Pre-flight: verify onboarding is complete

✅ `12:46:03` Onboarding is COMPLETED before running logs WS tests  

## Install WS helper script on host


## Happy path: stream logs for nginx

✅ `12:46:04` WebSocket upgrade succeeds for nginx (opened: true)  
✅ `12:46:04` nginx logs stream closes with code 1000 (normal)  
✅ `12:46:04` nginx logs stream delivered at least one message (count > 0)  
✅ `12:46:04` First nginx log message has 'timestamp' and 'message' fields  

## Other allowed services accept WS upgrade

✅ `12:46:04` WebSocket upgrade succeeds for authelia (opened: true)  
✅ `12:46:04` authelia logs stream closes with code 1000 (normal)  
✅ `12:46:04` WebSocket upgrade succeeds for chisel (opened: true)  
✅ `12:46:04` chisel logs stream closes with code 1000 (normal)  
✅ `12:46:04` WebSocket upgrade succeeds for lamalibre-lamaste-serverd (opened: true)  
✅ `12:46:04` lamalibre-lamaste-serverd logs stream closes with code 1000 (normal)  

## Error path: unknown service rejected

✅ `12:46:04` Unknown service name closes WebSocket with code 1008 (policy violation)  
✅ `12:46:04` Unknown service close reason is the expected 'Unknown service'  
✅ `12:46:04` No log messages are streamed for an unknown service name  

## Error path: path injection rejected

✅ `12:46:05` Path traversal attempt (..%2Fetc%2Fpasswd) closes WebSocket with code 1008  
✅ `12:46:05` Path traversal attempt is rejected with 'Unknown service' close reason (allowlist guard)  
✅ `12:46:05` No log messages are streamed for a path traversal attempt  
✅ `12:46:05` Service not in allowlist (lamalibre-lamaste-gatekeeper) is rejected with close code 1008  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

