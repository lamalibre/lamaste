# Lamaste E2E: 24 — Storage Servers and Bindings (Three-VM)

> Started at `2026-11-09 12:44:59 UTC`


## Initialize cleanup trap variables


## Pre-flight: check onboarding is complete

✅ `12:44:59` Onboarding is complete on host VM  

## Generate UUID for storage server

ℹ️ `12:44:59` Generated storage server id: 2b381fe3-1230-4911-9032-ea96509bad94  
✅ `12:44:59` Generated storage server UUID is non-empty  

## Initial storage servers list

✅ `12:44:59` Initial GET /api/storage/servers returns .servers as an array  

## Register storage server (fake credentials)

✅ `12:45:00` POST /api/storage/servers response .id matches request id  
✅ `12:45:00` POST /api/storage/servers response .label matches request  
✅ `12:45:00` POST /api/storage/servers response .bucket matches request  
✅ `12:45:00` POST /api/storage/servers response has .registeredAt  
✅ `12:45:00` POST /api/storage/servers response redacts accessKey  
✅ `12:45:00` POST /api/storage/servers response redacts secretKey  

## List after register includes new server

✅ `12:45:00` Newly registered server appears in GET /api/storage/servers  
✅ `12:45:00` GET /api/storage/servers does not leak accessKey  

## Duplicate register returns 409

✅ `12:45:00` Re-registering same UUID returns 409 Conflict  

## Invalid body returns 4xx

✅ `12:45:00` POST /api/storage/servers with non-uuid id rejected with 4xx/5xx  

## List bindings (initial)

✅ `12:45:00` GET /api/storage/bindings returns .bindings as array  

## Binding for missing plugin returns 404

✅ `12:45:00` POST /api/storage/bindings for plugin not in registry returns 404  

## Binding with invalid plugin name returns 4xx

✅ `12:45:00` POST /api/storage/bindings with invalid pluginName rejected with 4xx/5xx  

## GET binding for unbound plugin returns 404

✅ `12:45:00` GET /api/storage/bindings/:pluginName for unbound plugin returns 404  

## Delete storage server

✅ `12:45:01` DELETE /api/storage/servers/:id returns ok:true  

## Delete already-removed server returns 404

✅ `12:45:01` DELETE /api/storage/servers/:id for unknown id returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `12:45:01` Cleaning up test resources...  
