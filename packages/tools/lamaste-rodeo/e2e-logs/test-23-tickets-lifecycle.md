# Lamaste E2E: 23 — Tickets Lifecycle (Three-VM)

> Started at `2026-10-13 11:52:19 UTC`


## 1. Register ticket scope

✅ `11:52:19` POST /api/tickets/scopes response has ok: true  
✅ `11:52:19` Scope create response lists the registered sub-scope name  

## 2. List ticket scopes

✅ `11:52:19` GET /api/tickets/scopes response contains registered scope name  

## 3. Create source and target agent certs with sub-scope capability

✅ `11:52:20` Source agent cert creation returns ok: true  
✅ `11:52:22` Target agent cert creation returns ok: true  
✅ `11:52:22` Extracted PEM cert/key pairs for source and target agents  

## 4. Register instance via source agent cert

✅ `11:52:23` POST /api/tickets/instances returns 201 for new instance  
✅ `11:52:23` Instance registration returned a non-empty instanceId  
✅ `11:52:23` Instance registration returned a non-empty instanceScope  
✅ `11:52:23` Instance scope embeds the registered sub-scope prefix  

## 5. Re-registering same instance returns 200 (idempotent)

✅ `11:52:23` Re-registering same (scope, agent) returns 200 (idempotent path)  

## 6. Instance heartbeat

✅ `11:52:23` POST /api/tickets/instances/:id/heartbeat returns 200  
✅ `11:52:23` Heartbeat on non-existent instance returns 404  

## 7. Admin lists assignments (filtered by our agent)

✅ `11:52:23` GET /api/tickets/assignments filtered by our target label is initially empty  

## 8. Assignment validation — malformed instanceScope is rejected

✅ `11:52:23` POST /api/tickets/assignments with malformed instanceScope returns 400  
✅ `11:52:23` DELETE /api/tickets/assignments/:agent/:scope for non-existent row returns 404  

## 9. Ticket request without assignment returns 404

✅ `11:52:23` POST /api/tickets without a matching assignment returns 404  

## 10. Admin lists tickets and sessions; agent reads own inbox

✅ `11:52:24` GET /api/tickets (admin) returns a tickets field  
✅ `11:52:24` GET /api/tickets/sessions (admin) returns a sessions field  
✅ `11:52:24` Target agent inbox is empty when no assignment exists  

## 11. Ticket validate/revoke negative paths

✅ `11:52:24` POST /api/tickets/validate on unknown ticket returns 401 (generic denial)  
✅ `11:52:24` POST /api/tickets/sessions on unknown ticket returns 400  
✅ `11:52:24` POST /api/tickets/sessions/:id/heartbeat on unknown session returns 404  
✅ `11:52:24` PATCH /api/tickets/sessions/:id on unknown session returns 404  
✅ `11:52:24` DELETE /api/tickets/:id on unknown ticket returns 404  

## 12. A plugin-agent certificate cannot create tunnels

✅ `11:52:24` Source agent obtained a delegated enrollment token  
✅ `11:52:25` Plugin-agent enrolled with the delegated token  
✅ `11:52:25` Plugin-agent certificate carries CN=plugin-agent:rodeo-tickets-source:rodeo-tickets-pa  
✅ `11:52:25` POST /api/tunnels with a plugin-agent certificate returns 403  
✅ `11:52:25` No tunnel was created for the plugin-agent  

## 13. Lifecycle coverage complete

ℹ️ `11:52:25` Tickets lifecycle coverage complete; cleanup handled by EXIT trap  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

ℹ️ `11:52:25` Cleaning up test resources...  
