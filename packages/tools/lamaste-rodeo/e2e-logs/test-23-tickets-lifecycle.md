# Lamaste E2E: 23 — Tickets Lifecycle (Three-VM)

> Started at `2026-11-10 13:07:24 UTC`


## 1. Register ticket scope

✅ `13:07:24` POST /api/tickets/scopes response has ok: true  
✅ `13:07:24` Scope create response lists the registered sub-scope name  

## 2. List ticket scopes

✅ `13:07:24` GET /api/tickets/scopes response contains registered scope name  

## 3. Create source and target agent certs with sub-scope capability

✅ `13:07:25` Source agent cert creation returns ok: true  
✅ `13:07:26` Target agent cert creation returns ok: true  
✅ `13:07:27` Extracted PEM cert/key pairs for source and target agents  

## 4. Register instance via source agent cert

✅ `13:07:27` POST /api/tickets/instances returns 201 for new instance  
✅ `13:07:27` Instance registration returned a non-empty instanceId  
✅ `13:07:27` Instance registration returned a non-empty instanceScope  
✅ `13:07:27` Instance scope embeds the registered sub-scope prefix  

## 5. Re-registering same instance returns 200 (idempotent)

✅ `13:07:27` Re-registering same (scope, agent) returns 200 (idempotent path)  

## 6. Instance heartbeat

✅ `13:07:27` POST /api/tickets/instances/:id/heartbeat returns 200  
✅ `13:07:27` Heartbeat on non-existent instance returns 404  

## 7. Admin lists assignments (filtered by our agent)

✅ `13:07:28` GET /api/tickets/assignments filtered by our target label is initially empty  

## 8. Assignment validation — malformed instanceScope is rejected

✅ `13:07:28` POST /api/tickets/assignments with malformed instanceScope returns 400  
✅ `13:07:28` DELETE /api/tickets/assignments/:agent/:scope for non-existent row returns 404  

## 9. Ticket request without assignment returns 404

✅ `13:07:28` POST /api/tickets without a matching assignment returns 404  

## 10. Admin lists tickets and sessions; agent reads own inbox

✅ `13:07:28` GET /api/tickets (admin) returns a tickets field  
✅ `13:07:28` GET /api/tickets/sessions (admin) returns a sessions field  
✅ `13:07:29` Target agent inbox is empty when no assignment exists  

## 11. Ticket validate/revoke negative paths

✅ `13:07:29` POST /api/tickets/validate on unknown ticket returns 401 (generic denial)  
✅ `13:07:29` POST /api/tickets/sessions on unknown ticket returns 400  
✅ `13:07:29` POST /api/tickets/sessions/:id/heartbeat on unknown session returns 404  
✅ `13:07:29` PATCH /api/tickets/sessions/:id on unknown session returns 404  
✅ `13:07:29` DELETE /api/tickets/:id on unknown ticket returns 404  

## 12. A plugin-agent certificate cannot create tunnels

✅ `13:07:29` Source agent obtained a delegated enrollment token  
✅ `13:07:30` Plugin-agent enrolled with the delegated token  
✅ `13:07:30` Plugin-agent certificate carries CN=plugin-agent:rodeo-tickets-source:rodeo-tickets-pa  
✅ `13:07:30` POST /api/tunnels with a plugin-agent certificate returns 403  
✅ `13:07:31` No tunnel was created for the plugin-agent  

## 13. Lifecycle coverage complete

ℹ️ `13:07:31` Tickets lifecycle coverage complete; cleanup handled by EXIT trap  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

ℹ️ `13:07:31` Cleaning up test resources...  
