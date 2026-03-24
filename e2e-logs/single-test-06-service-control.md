# Portlama E2E: 06 — Service Control

> Started at `2026-03-24 09:37:33 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `09:37:33` GET /api/services returns 4 services  
✅ `09:37:33` Service 'nginx' is in the service list  
✅ `09:37:33` Service 'chisel' is in the service list  
✅ `09:37:33` Service 'authelia' is in the service list  
✅ `09:37:33` Service 'portlama-panel' is in the service list  
✅ `09:37:33` nginx status is 'active'  

## Restart nginx

✅ `09:37:39` nginx restart request accepted  
✅ `09:37:42` nginx is active after restart  

## Reload nginx

✅ `09:37:42` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `09:37:42` Cannot stop portlama-panel (HTTP 400)  
✅ `09:37:42` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `09:37:42` portlama-panel restart request accepted  
✅ `09:37:45` Panel is responsive after restart  

## Invalid service name

✅ `09:37:45` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `09:37:45` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

