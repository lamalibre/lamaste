# Portlama E2E: 06 — Service Control

> Started at `2026-03-26 10:46:23 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `10:46:23` GET /api/services returns 4 services  
✅ `10:46:23` Service 'nginx' is in the service list  
✅ `10:46:23` Service 'chisel' is in the service list  
✅ `10:46:23` Service 'authelia' is in the service list  
✅ `10:46:23` Service 'portlama-panel' is in the service list  
✅ `10:46:23` nginx status is 'active'  

## Restart nginx

✅ `10:46:28` nginx restart request accepted  
✅ `10:46:31` nginx is active after restart  

## Reload nginx

✅ `10:46:31` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `10:46:31` Cannot stop portlama-panel (HTTP 400)  
✅ `10:46:31` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `10:46:31` portlama-panel restart request accepted  
✅ `10:46:35` Panel is responsive after restart  

## Invalid service name

✅ `10:46:35` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `10:46:35` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

