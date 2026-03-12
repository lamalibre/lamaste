# Portlama E2E: 06 — Service Control

> Started at `2026-03-16 17:21:34 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `17:21:34` GET /api/services returns 4 services  
✅ `17:21:34` Service 'nginx' is in the service list  
✅ `17:21:34` Service 'chisel' is in the service list  
✅ `17:21:34` Service 'authelia' is in the service list  
✅ `17:21:34` Service 'portlama-panel' is in the service list  
✅ `17:21:34` nginx status is 'active'  

## Restart nginx

✅ `17:21:39` nginx restart request accepted  
✅ `17:21:42` nginx is active after restart  

## Reload nginx

✅ `17:21:42` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `17:21:42` Cannot stop portlama-panel (HTTP 400)  
✅ `17:21:42` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `17:21:42` portlama-panel restart request accepted  
✅ `17:21:46` Panel is responsive after restart  

## Invalid service name

✅ `17:21:46` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `17:21:46` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

