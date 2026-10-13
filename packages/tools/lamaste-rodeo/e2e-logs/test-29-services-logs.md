# Lamaste E2E: 29 — Service Logs WebSocket (Three-VM)

> Started at `2026-10-13 11:52:58 UTC`


## Initialize variables for cleanup safety


## Pre-flight: verify onboarding is complete

✅ `11:52:59` Onboarding is COMPLETED before running logs WS tests  

## Install WS helper script on host


## Happy path: stream logs for nginx

✅ `11:52:59` WebSocket upgrade succeeds for nginx (opened: true)  
✅ `11:52:59` nginx logs stream closes with code 1000 (normal)  
✅ `11:52:59` nginx logs stream delivered at least one message (count > 0)  
✅ `11:52:59` First nginx log message has 'timestamp' and 'message' fields  

## Other allowed services accept WS upgrade

✅ `11:52:59` WebSocket upgrade succeeds for authelia (opened: true)  
✅ `11:52:59` authelia logs stream closes with code 1000 (normal)  
✅ `11:52:59` WebSocket upgrade succeeds for chisel (opened: true)  
✅ `11:52:59` chisel logs stream closes with code 1000 (normal)  
✅ `11:52:59` WebSocket upgrade succeeds for lamalibre-lamaste-serverd (opened: true)  
✅ `11:52:59` lamalibre-lamaste-serverd logs stream closes with code 1000 (normal)  

## Error path: unknown service rejected

✅ `11:52:59` Unknown service name closes WebSocket with code 1008 (policy violation)  
✅ `11:52:59` Unknown service close reason is the expected 'Unknown service'  
✅ `11:53:00` No log messages are streamed for an unknown service name  

## Error path: path injection rejected

✅ `11:53:00` Path traversal attempt (..%2Fetc%2Fpasswd) closes WebSocket with code 1008  
✅ `11:53:00` Path traversal attempt is rejected with 'Unknown service' close reason (allowlist guard)  
✅ `11:53:00` No log messages are streamed for a path traversal attempt  
✅ `11:53:00` Service not in allowlist (lamalibre-lamaste-gatekeeper) is rejected with close code 1008  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

