# Lamaste E2E: 24 — Storage Servers and Bindings (Three-VM)

> Started at `2026-11-10 13:07:32 UTC`


## Initialize cleanup trap variables


## Pre-flight: check onboarding is complete

✅ `13:07:32` Onboarding is complete on host VM  

## Generate UUID for storage server

ℹ️ `13:07:32` Generated storage server id: d226c49c-ffa6-4c36-8f88-c54624e3c401  
✅ `13:07:32` Generated storage server UUID is non-empty  

## Initial storage servers list

✅ `13:07:32` Initial GET /api/storage/servers returns .servers as an array  

## Register storage server (fake credentials)

✅ `13:07:32` POST /api/storage/servers response .id matches request id  
✅ `13:07:32` POST /api/storage/servers response .label matches request  
✅ `13:07:32` POST /api/storage/servers response .bucket matches request  
✅ `13:07:32` POST /api/storage/servers response has .registeredAt  
✅ `13:07:32` POST /api/storage/servers response redacts accessKey  
✅ `13:07:32` POST /api/storage/servers response redacts secretKey  

## List after register includes new server

✅ `13:07:32` Newly registered server appears in GET /api/storage/servers  
✅ `13:07:32` GET /api/storage/servers does not leak accessKey  

## Duplicate register returns 409

✅ `13:07:32` Re-registering same UUID returns 409 Conflict  

## Invalid body returns 4xx

✅ `13:07:33` POST /api/storage/servers with non-uuid id rejected with 4xx/5xx  

## List bindings (initial)

✅ `13:07:33` GET /api/storage/bindings returns .bindings as array  

## Binding for missing plugin returns 404

✅ `13:07:33` POST /api/storage/bindings for plugin not in registry returns 404  

## Binding with invalid plugin name returns 4xx

✅ `13:07:33` POST /api/storage/bindings with invalid pluginName rejected with 4xx/5xx  

## GET binding for unbound plugin returns 404

✅ `13:07:33` GET /api/storage/bindings/:pluginName for unbound plugin returns 404  

## Delete storage server

✅ `13:07:33` DELETE /api/storage/servers/:id returns ok:true  

## Delete already-removed server returns 404

✅ `13:07:34` DELETE /api/storage/servers/:id for unknown id returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `13:07:34` Cleaning up test resources...  
