# Lamaste E2E: 06 — Service Control

> Started at `2026-03-30 13:06:33 UTC`


## Pre-flight: check onboarding is complete


## List services

✅ `13:06:34` GET /api/services returns 4 services  
✅ `13:06:34` Service 'nginx' is in the service list  
✅ `13:06:34` Service 'chisel' is in the service list  
✅ `13:06:34` Service 'authelia' is in the service list  
✅ `13:06:34` Service 'lamaste-panel' is in the service list  
✅ `13:06:34` nginx status is 'active'  

## Restart nginx

✅ `13:06:39` nginx restart request accepted  
✅ `13:06:42` nginx is active after restart  

## Reload nginx

✅ `13:06:42` nginx reload returned ok: true  

## Cannot stop lamaste-panel

✅ `13:06:42` Cannot stop lamaste-panel (HTTP 400)  
✅ `13:06:42` Error message explains why panel cannot be stopped  

## Restart lamaste-panel is allowed

✅ `13:06:42` lamaste-panel restart request accepted  
✅ `13:06:45` Panel is responsive after restart  

## Invalid service name

✅ `13:06:45` Unknown service rejected (HTTP 400)  

## Invalid action

✅ `13:06:45` Invalid action 'destroy' rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

