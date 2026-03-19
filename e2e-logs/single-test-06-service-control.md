# Portlama E2E: 06 — Service Control

> Started at `2026-03-19 12:17:17 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `12:17:17` GET /api/services returns 4 services  
✅ `12:17:17` Service 'nginx' is in the service list  
✅ `12:17:17` Service 'chisel' is in the service list  
✅ `12:17:17` Service 'authelia' is in the service list  
✅ `12:17:17` Service 'portlama-panel' is in the service list  
✅ `12:17:17` nginx status is 'active'  

## Restart nginx

✅ `12:17:22` nginx restart request accepted  
✅ `12:17:25` nginx is active after restart  

## Reload nginx

✅ `12:17:25` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `12:17:25` Cannot stop portlama-panel (HTTP 400)  
✅ `12:17:25` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `12:17:25` portlama-panel restart request accepted  
✅ `12:17:28` Panel is responsive after restart  

## Invalid service name

✅ `12:17:28` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `12:17:29` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

