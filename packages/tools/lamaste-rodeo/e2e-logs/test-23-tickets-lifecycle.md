# Lamaste E2E: 23 — Tickets Lifecycle (Three-VM)

> Started at `2026-11-02 15:53:22 UTC`


## 1. Register ticket scope

✅ `15:53:23` POST /api/tickets/scopes response has ok: true  
✅ `15:53:23` Scope create response lists the registered sub-scope name  

## 2. List ticket scopes

✅ `15:53:23` GET /api/tickets/scopes response contains registered scope name  

## 3. Create source and target agent certs with sub-scope capability

✅ `15:53:25` Source agent cert creation returns ok: true  
✅ `15:53:26` Target agent cert creation returns ok: true  
✅ `15:53:27` Extracted PEM cert/key pairs for source and target agents  

## 4. Register instance via source agent cert

✅ `15:53:27` POST /api/tickets/instances returns 201 for new instance  
✅ `15:53:27` Instance registration returned a non-empty instanceId  
✅ `15:53:27` Instance registration returned a non-empty instanceScope  
✅ `15:53:27` Instance scope embeds the registered sub-scope prefix  

## 5. Re-registering same instance returns 200 (idempotent)

✅ `15:53:27` Re-registering same (scope, agent) returns 200 (idempotent path)  

## 6. Instance heartbeat

✅ `15:53:27` POST /api/tickets/instances/:id/heartbeat returns 200  
✅ `15:53:27` Heartbeat on non-existent instance returns 404  

## 7. Admin lists assignments (filtered by our agent)

✅ `15:53:27` GET /api/tickets/assignments filtered by our target label is initially empty  

## 8. Assignment validation — malformed instanceScope is rejected

✅ `15:53:28` POST /api/tickets/assignments with malformed instanceScope returns 400  
✅ `15:53:28` DELETE /api/tickets/assignments/:agent/:scope for non-existent row returns 404  

## 9. Ticket request without assignment returns 404

✅ `15:53:28` POST /api/tickets without a matching assignment returns 404  

## 10. Admin lists tickets and sessions; agent reads own inbox

✅ `15:53:28` GET /api/tickets (admin) returns a tickets field  
✅ `15:53:28` GET /api/tickets/sessions (admin) returns a sessions field  
✅ `15:53:28` Target agent inbox is empty when no assignment exists  

## 11. Ticket validate/revoke negative paths

✅ `15:53:28` POST /api/tickets/validate on unknown ticket returns 401 (generic denial)  
✅ `15:53:28` POST /api/tickets/sessions on unknown ticket returns 400  
✅ `15:53:28` POST /api/tickets/sessions/:id/heartbeat on unknown session returns 404  
✅ `15:53:29` PATCH /api/tickets/sessions/:id on unknown session returns 404  
✅ `15:53:29` DELETE /api/tickets/:id on unknown ticket returns 404  

## 12. A plugin-agent certificate cannot create tunnels

✅ `15:53:29` Source agent obtained a delegated enrollment token  
✅ `15:53:29` Plugin-agent enrolled with the delegated token  
✅ `15:53:29` Plugin-agent certificate carries CN=plugin-agent:rodeo-tickets-source:rodeo-tickets-pa  
✅ `15:53:29` POST /api/tunnels with a plugin-agent certificate returns 403  
✅ `15:53:30` No tunnel was created for the plugin-agent  

## 13. Lifecycle coverage complete

ℹ️ `15:53:30` Tickets lifecycle coverage complete; cleanup handled by EXIT trap  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

ℹ️ `15:53:30` Cleaning up test resources...  
