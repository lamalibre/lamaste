# Lamaste E2E: 23 — Tickets Lifecycle (Three-VM)

> Started at `2026-04-30 09:10:01 UTC`


## 1. Register ticket scope

✅ `09:10:01` POST /api/tickets/scopes response has ok: true  
✅ `09:10:01` Scope create response lists the registered sub-scope name  

## 2. List ticket scopes

✅ `09:10:01` GET /api/tickets/scopes response contains registered scope name  

## 3. Create source and target agent certs with sub-scope capability

✅ `09:10:02` Source agent cert creation returns ok: true  
✅ `09:10:04` Target agent cert creation returns ok: true  
✅ `09:10:04` Extracted PEM cert/key pairs for source and target agents  

## 4. Register instance via source agent cert

✅ `09:10:04` POST /api/tickets/instances returns 201 for new instance  
✅ `09:10:04` Instance registration returned a non-empty instanceId  
✅ `09:10:04` Instance registration returned a non-empty instanceScope  
✅ `09:10:04` Instance scope embeds the registered sub-scope prefix  

## 5. Re-registering same instance returns 200 (idempotent)

✅ `09:10:04` Re-registering same (scope, agent) returns 200 (idempotent path)  

## 6. Instance heartbeat

✅ `09:10:04` POST /api/tickets/instances/:id/heartbeat returns 200  
✅ `09:10:05` Heartbeat on non-existent instance returns 404  

## 7. Admin lists assignments (filtered by our agent)

✅ `09:10:05` GET /api/tickets/assignments filtered by our target label is initially empty  

## 8. Assignment validation — malformed instanceScope is rejected

✅ `09:10:05` POST /api/tickets/assignments with malformed instanceScope returns 400  
✅ `09:10:05` DELETE /api/tickets/assignments/:agent/:scope for non-existent row returns 404  

## 9. Ticket request without assignment returns 404

✅ `09:10:05` POST /api/tickets without a matching assignment returns 404  

## 10. Admin lists tickets and sessions; agent reads own inbox

✅ `09:10:05` GET /api/tickets (admin) returns a tickets field  
✅ `09:10:05` GET /api/tickets/sessions (admin) returns a sessions field  
✅ `09:10:05` Target agent inbox is empty when no assignment exists  

## 11. Ticket validate/revoke negative paths

✅ `09:10:05` POST /api/tickets/validate on unknown ticket returns 401 (generic denial)  
✅ `09:10:05` POST /api/tickets/sessions on unknown ticket returns 400  
✅ `09:10:06` POST /api/tickets/sessions/:id/heartbeat on unknown session returns 404  
✅ `09:10:06` PATCH /api/tickets/sessions/:id on unknown session returns 404  
✅ `09:10:06` DELETE /api/tickets/:id on unknown ticket returns 404  

## 12. Lifecycle coverage complete

ℹ️ `09:10:06` Tickets lifecycle coverage complete; cleanup handled by EXIT trap  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `09:10:06` Cleaning up test resources...  
