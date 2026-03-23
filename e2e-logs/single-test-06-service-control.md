# Portlama E2E: 06 — Service Control

> Started at `2026-03-23 12:09:12 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `12:09:12` GET /api/services returns 4 services  
✅ `12:09:12` Service 'nginx' is in the service list  
✅ `12:09:12` Service 'chisel' is in the service list  
✅ `12:09:12` Service 'authelia' is in the service list  
✅ `12:09:12` Service 'portlama-panel' is in the service list  
✅ `12:09:12` nginx status is 'active'  

## Restart nginx

✅ `12:09:17` nginx restart request accepted  
✅ `12:09:20` nginx is active after restart  

## Reload nginx

✅ `12:09:20` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `12:09:20` Cannot stop portlama-panel (HTTP 400)  
✅ `12:09:20` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `12:09:20` portlama-panel restart request accepted  
✅ `12:09:23` Panel is responsive after restart  

## Invalid service name

✅ `12:09:23` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `12:09:23` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

