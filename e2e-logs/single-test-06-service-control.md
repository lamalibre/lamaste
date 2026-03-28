# Portlama E2E: 06 — Service Control

> Started at `2026-03-28 22:38:40 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `22:38:40` GET /api/services returns 4 services  
✅ `22:38:40` Service 'nginx' is in the service list  
✅ `22:38:40` Service 'chisel' is in the service list  
✅ `22:38:40` Service 'authelia' is in the service list  
✅ `22:38:40` Service 'portlama-panel' is in the service list  
✅ `22:38:40` nginx status is 'active'  

## Restart nginx

✅ `22:38:45` nginx restart request accepted  
✅ `22:38:48` nginx is active after restart  

## Reload nginx

✅ `22:38:48` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `22:38:48` Cannot stop portlama-panel (HTTP 400)  
✅ `22:38:48` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `22:38:48` portlama-panel restart request accepted  
✅ `22:38:51` Panel is responsive after restart  

## Invalid service name

✅ `22:38:51` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `22:38:51` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

