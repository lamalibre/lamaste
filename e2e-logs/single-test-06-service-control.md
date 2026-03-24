# Portlama E2E: 06 — Service Control

> Started at `2026-03-24 08:10:39 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `08:10:40` GET /api/services returns 4 services  
✅ `08:10:40` Service 'nginx' is in the service list  
✅ `08:10:40` Service 'chisel' is in the service list  
✅ `08:10:40` Service 'authelia' is in the service list  
✅ `08:10:40` Service 'portlama-panel' is in the service list  
✅ `08:10:40` nginx status is 'active'  

## Restart nginx

✅ `08:10:45` nginx restart request accepted  
✅ `08:10:48` nginx is active after restart  

## Reload nginx

✅ `08:10:48` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `08:10:48` Cannot stop portlama-panel (HTTP 400)  
✅ `08:10:48` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `08:10:48` portlama-panel restart request accepted  
✅ `08:10:51` Panel is responsive after restart  

## Invalid service name

✅ `08:10:51` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `08:10:51` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

