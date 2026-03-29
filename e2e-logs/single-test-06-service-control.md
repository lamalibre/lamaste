# Portlama E2E: 06 — Service Control

> Started at `2026-03-29 09:08:04 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `09:08:04` GET /api/services returns 4 services  
✅ `09:08:04` Service 'nginx' is in the service list  
✅ `09:08:04` Service 'chisel' is in the service list  
✅ `09:08:04` Service 'authelia' is in the service list  
✅ `09:08:04` Service 'portlama-panel' is in the service list  
✅ `09:08:04` nginx status is 'active'  

## Restart nginx

✅ `09:08:09` nginx restart request accepted  
✅ `09:08:12` nginx is active after restart  

## Reload nginx

✅ `09:08:12` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `09:08:12` Cannot stop portlama-panel (HTTP 400)  
✅ `09:08:12` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `09:08:12` portlama-panel restart request accepted  
✅ `09:08:15` Panel is responsive after restart  

## Invalid service name

✅ `09:08:15` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `09:08:15` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

