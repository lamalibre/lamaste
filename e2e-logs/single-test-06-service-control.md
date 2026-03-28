# Portlama E2E: 06 — Service Control

> Started at `2026-03-28 16:08:18 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `16:08:18` GET /api/services returns 4 services  
✅ `16:08:18` Service 'nginx' is in the service list  
✅ `16:08:18` Service 'chisel' is in the service list  
✅ `16:08:18` Service 'authelia' is in the service list  
✅ `16:08:18` Service 'portlama-panel' is in the service list  
✅ `16:08:18` nginx status is 'active'  

## Restart nginx

✅ `16:08:23` nginx restart request accepted  
✅ `16:08:26` nginx is active after restart  

## Reload nginx

✅ `16:08:26` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `16:08:26` Cannot stop portlama-panel (HTTP 400)  
✅ `16:08:26` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `16:08:26` portlama-panel restart request accepted  
✅ `16:08:29` Panel is responsive after restart  

## Invalid service name

✅ `16:08:29` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `16:08:29` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

