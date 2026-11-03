# Lamaste E2E: 24 — Storage Servers and Bindings (Three-VM)

> Started at `2026-11-03 09:33:00 UTC`


## Initialize cleanup trap variables


## Pre-flight: check onboarding is complete

✅ `09:33:00` Onboarding is complete on host VM  

## Generate UUID for storage server

ℹ️ `09:33:00` Generated storage server id: 2ca4a614-7810-456f-a32b-0160aa26873d  
✅ `09:33:00` Generated storage server UUID is non-empty  

## Initial storage servers list

✅ `09:33:01` Initial GET /api/storage/servers returns .servers as an array  

## Register storage server (fake credentials)

✅ `09:33:01` POST /api/storage/servers response .id matches request id  
✅ `09:33:01` POST /api/storage/servers response .label matches request  
✅ `09:33:01` POST /api/storage/servers response .bucket matches request  
✅ `09:33:01` POST /api/storage/servers response has .registeredAt  
✅ `09:33:01` POST /api/storage/servers response redacts accessKey  
✅ `09:33:01` POST /api/storage/servers response redacts secretKey  

## List after register includes new server

✅ `09:33:01` Newly registered server appears in GET /api/storage/servers  
✅ `09:33:01` GET /api/storage/servers does not leak accessKey  

## Duplicate register returns 409

✅ `09:33:01` Re-registering same UUID returns 409 Conflict  

## Invalid body returns 4xx

✅ `09:33:01` POST /api/storage/servers with non-uuid id rejected with 4xx/5xx  

## List bindings (initial)

✅ `09:33:01` GET /api/storage/bindings returns .bindings as array  

## Binding for missing plugin returns 404

✅ `09:33:01` POST /api/storage/bindings for plugin not in registry returns 404  

## Binding with invalid plugin name returns 4xx

✅ `09:33:02` POST /api/storage/bindings with invalid pluginName rejected with 4xx/5xx  

## GET binding for unbound plugin returns 404

✅ `09:33:02` GET /api/storage/bindings/:pluginName for unbound plugin returns 404  

## Delete storage server

✅ `09:33:02` DELETE /api/storage/servers/:id returns ok:true  

## Delete already-removed server returns 404

✅ `09:33:02` DELETE /api/storage/servers/:id for unknown id returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `09:33:02` Cleaning up test resources...  
