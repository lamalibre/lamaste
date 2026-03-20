# Portlama E2E: 06 — Service Control

> Started at `2026-03-20 14:33:46 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `14:33:46` GET /api/services returns 4 services  
✅ `14:33:46` Service 'nginx' is in the service list  
✅ `14:33:46` Service 'chisel' is in the service list  
✅ `14:33:46` Service 'authelia' is in the service list  
✅ `14:33:46` Service 'portlama-panel' is in the service list  
✅ `14:33:46` nginx status is 'active'  

## Restart nginx

✅ `14:33:52` nginx restart request accepted  
✅ `14:33:55` nginx is active after restart  

## Reload nginx

✅ `14:33:55` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `14:33:55` Cannot stop portlama-panel (HTTP 400)  
✅ `14:33:55` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `14:33:55` portlama-panel restart request accepted  
✅ `14:33:58` Panel is responsive after restart  

## Invalid service name

✅ `14:33:58` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `14:33:58` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

