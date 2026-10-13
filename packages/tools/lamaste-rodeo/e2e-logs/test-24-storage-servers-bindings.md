# Lamaste E2E: 24 — Storage Servers and Bindings (Three-VM)

> Started at `2026-10-13 11:52:26 UTC`


## Initialize cleanup trap variables


## Pre-flight: check onboarding is complete

✅ `11:52:26` Onboarding is complete on host VM  

## Generate UUID for storage server

ℹ️ `11:52:26` Generated storage server id: 2da27d30-89db-4490-80db-ea0ecfbbe004  
✅ `11:52:26` Generated storage server UUID is non-empty  

## Initial storage servers list

✅ `11:52:26` Initial GET /api/storage/servers returns .servers as an array  

## Register storage server (fake credentials)

✅ `11:52:27` POST /api/storage/servers response .id matches request id  
✅ `11:52:27` POST /api/storage/servers response .label matches request  
✅ `11:52:27` POST /api/storage/servers response .bucket matches request  
✅ `11:52:27` POST /api/storage/servers response has .registeredAt  
✅ `11:52:27` POST /api/storage/servers response redacts accessKey  
✅ `11:52:27` POST /api/storage/servers response redacts secretKey  

## List after register includes new server

✅ `11:52:27` Newly registered server appears in GET /api/storage/servers  
✅ `11:52:27` GET /api/storage/servers does not leak accessKey  

## Duplicate register returns 409

✅ `11:52:27` Re-registering same UUID returns 409 Conflict  

## Invalid body returns 4xx

✅ `11:52:27` POST /api/storage/servers with non-uuid id rejected with 4xx/5xx  

## List bindings (initial)

✅ `11:52:27` GET /api/storage/bindings returns .bindings as array  

## Binding for missing plugin returns 404

✅ `11:52:27` POST /api/storage/bindings for plugin not in registry returns 404  

## Binding with invalid plugin name returns 4xx

✅ `11:52:27` POST /api/storage/bindings with invalid pluginName rejected with 4xx/5xx  

## GET binding for unbound plugin returns 404

✅ `11:52:27` GET /api/storage/bindings/:pluginName for unbound plugin returns 404  

## Delete storage server

✅ `11:52:27` DELETE /api/storage/servers/:id returns ok:true  

## Delete already-removed server returns 404

✅ `11:52:28` DELETE /api/storage/servers/:id for unknown id returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `11:52:28` Cleaning up test resources...  
