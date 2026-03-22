# Portlama E2E: 06 — Service Control

> Started at `2026-03-22 18:24:45 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `18:24:45` GET /api/services returns 4 services  
✅ `18:24:45` Service 'nginx' is in the service list  
✅ `18:24:45` Service 'chisel' is in the service list  
✅ `18:24:45` Service 'authelia' is in the service list  
✅ `18:24:45` Service 'portlama-panel' is in the service list  
✅ `18:24:45` nginx status is 'active'  

## Restart nginx

✅ `18:24:50` nginx restart request accepted  
✅ `18:24:53` nginx is active after restart  

## Reload nginx

✅ `18:24:54` nginx reload returned ok: true  

## Cannot stop portlama-panel

✅ `18:24:54` Cannot stop portlama-panel (HTTP 400)  
✅ `18:24:54` Error message explains why panel cannot be stopped  

## Restart portlama-panel is allowed

✅ `18:24:54` portlama-panel restart request accepted  
✅ `18:24:57` Panel is responsive after restart  

## Invalid service name

✅ `18:24:57` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `18:24:57` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

