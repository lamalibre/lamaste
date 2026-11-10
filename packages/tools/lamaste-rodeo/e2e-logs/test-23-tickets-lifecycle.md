# Lamaste E2E: 23 — Tickets Lifecycle (Three-VM)

> Started at `2026-11-10 17:49:55 UTC`


## 1. Register ticket scope

✅ `17:49:55` POST /api/tickets/scopes response has ok: true  
✅ `17:49:55` Scope create response lists the registered sub-scope name  

## 2. List ticket scopes

✅ `17:49:55` GET /api/tickets/scopes response contains registered scope name  

## 3. Create source and target agent certs with sub-scope capability

✅ `17:49:57` Source agent cert creation returns ok: true  
✅ `17:49:59` Target agent cert creation returns ok: true  
✅ `17:49:59` Extracted PEM cert/key pairs for source and target agents  

## 4. Register instance via source agent cert

✅ `17:49:59` POST /api/tickets/instances returns 201 for new instance  
✅ `17:49:59` Instance registration returned a non-empty instanceId  
✅ `17:49:59` Instance registration returned a non-empty instanceScope  
✅ `17:49:59` Instance scope embeds the registered sub-scope prefix  

## 5. Re-registering same instance returns 200 (idempotent)

✅ `17:50:00` Re-registering same (scope, agent) returns 200 (idempotent path)  

## 6. Instance heartbeat

✅ `17:50:00` POST /api/tickets/instances/:id/heartbeat returns 200  
✅ `17:50:00` Heartbeat on non-existent instance returns 404  

## 7. Admin lists assignments (filtered by our agent)

✅ `17:50:00` GET /api/tickets/assignments filtered by our target label is initially empty  

## 8. Assignment validation — malformed instanceScope is rejected

✅ `17:50:00` POST /api/tickets/assignments with malformed instanceScope returns 400  
✅ `17:50:00` DELETE /api/tickets/assignments/:agent/:scope for non-existent row returns 404  

## 9. Ticket request without assignment returns 404

✅ `17:50:00` POST /api/tickets without a matching assignment returns 404  

## 10. Admin lists tickets and sessions; agent reads own inbox

✅ `17:50:01` GET /api/tickets (admin) returns a tickets field  
✅ `17:50:01` GET /api/tickets/sessions (admin) returns a sessions field  
✅ `17:50:01` Target agent inbox is empty when no assignment exists  

## 11. Ticket validate/revoke negative paths

✅ `17:50:01` POST /api/tickets/validate on unknown ticket returns 401 (generic denial)  
✅ `17:50:01` POST /api/tickets/sessions on unknown ticket returns 400  
✅ `17:50:01` POST /api/tickets/sessions/:id/heartbeat on unknown session returns 404  
✅ `17:50:02` PATCH /api/tickets/sessions/:id on unknown session returns 404  
✅ `17:50:02` DELETE /api/tickets/:id on unknown ticket returns 404  

## 12. A plugin-agent certificate cannot create tunnels

✅ `17:50:02` Source agent obtained a delegated enrollment token  
✅ `17:50:03` Plugin-agent enrolled with the delegated token  
✅ `17:50:03` Plugin-agent certificate carries CN=plugin-agent:rodeo-tickets-source:rodeo-tickets-pa  
✅ `17:50:03` POST /api/tunnels with a plugin-agent certificate returns 403  
✅ `17:50:03` No tunnel was created for the plugin-agent  

## 13. Lifecycle coverage complete

ℹ️ `17:50:03` Tickets lifecycle coverage complete; cleanup handled by EXIT trap  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

ℹ️ `17:50:03` Cleaning up test resources...  
