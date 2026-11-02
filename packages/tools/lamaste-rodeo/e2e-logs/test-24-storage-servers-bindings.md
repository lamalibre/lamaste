# Lamaste E2E: 24 — Storage Servers and Bindings (Three-VM)

> Started at `2026-11-02 15:53:30 UTC`


## Initialize cleanup trap variables


## Pre-flight: check onboarding is complete

✅ `15:53:30` Onboarding is complete on host VM  

## Generate UUID for storage server

ℹ️ `15:53:30` Generated storage server id: 58d38036-5d8a-43be-a4f3-d9c18d805e04  
✅ `15:53:30` Generated storage server UUID is non-empty  

## Initial storage servers list

✅ `15:53:30` Initial GET /api/storage/servers returns .servers as an array  

## Register storage server (fake credentials)

✅ `15:53:31` POST /api/storage/servers response .id matches request id  
✅ `15:53:31` POST /api/storage/servers response .label matches request  
✅ `15:53:31` POST /api/storage/servers response .bucket matches request  
✅ `15:53:31` POST /api/storage/servers response has .registeredAt  
✅ `15:53:31` POST /api/storage/servers response redacts accessKey  
✅ `15:53:31` POST /api/storage/servers response redacts secretKey  

## List after register includes new server

✅ `15:53:31` Newly registered server appears in GET /api/storage/servers  
✅ `15:53:31` GET /api/storage/servers does not leak accessKey  

## Duplicate register returns 409

✅ `15:53:31` Re-registering same UUID returns 409 Conflict  

## Invalid body returns 4xx

✅ `15:53:31` POST /api/storage/servers with non-uuid id rejected with 4xx/5xx  

## List bindings (initial)

✅ `15:53:31` GET /api/storage/bindings returns .bindings as array  

## Binding for missing plugin returns 404

✅ `15:53:31` POST /api/storage/bindings for plugin not in registry returns 404  

## Binding with invalid plugin name returns 4xx

✅ `15:53:31` POST /api/storage/bindings with invalid pluginName rejected with 4xx/5xx  

## GET binding for unbound plugin returns 404

✅ `15:53:31` GET /api/storage/bindings/:pluginName for unbound plugin returns 404  

## Delete storage server

✅ `15:53:31` DELETE /api/storage/servers/:id returns ok:true  

## Delete already-removed server returns 404

✅ `15:53:32` DELETE /api/storage/servers/:id for unknown id returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `15:53:32` Cleaning up test resources...  
