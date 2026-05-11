# Lamaste E2E: 19 — Panel Expose Lifecycle

> Started at `2026-03-30 13:07:58 UTC`


## Pre-flight: check onboarding is complete


## Verify panel:expose is a valid capability

✅ `13:08:00` Agent cert with panel:expose created successfully  
✅ `13:08:00` Agent cert has a p12 password  
ℹ️ `13:08:00` Created agent cert: panel-e2e-1774876078  
✅ `13:08:00` Extracted PEM cert and key from .p12  

## Expose panel: check agent-panel-status before expose

✅ `13:08:00` Panel not exposed initially  
✅ `13:08:00` No FQDN before expose  

## Expose panel: POST /api/tunnels/expose-panel

✅ `13:08:03` Expose panel returned ok: true  
✅ `13:08:03` Panel tunnel has an ID  
✅ `13:08:03` Panel tunnel type is 'panel'  
✅ `13:08:03` Panel subdomain matches agent-<label>  
✅ `13:08:03` Panel tunnel port matches  
✅ `13:08:03` Panel tunnel has an FQDN  
✅ `13:08:03` Panel tunnel has a createdAt timestamp  
✅ `13:08:03` Panel tunnel agentLabel matches  
ℹ️ `13:08:03` Exposed panel tunnel: agent-panel-e2e-1774876078.test.lamaste.local (ID: d78eba91-ecdf-4f01-8941-754b2332c6c0)  

## Verify panel tunnel in tunnel listing

✅ `13:08:03` Panel tunnel shows type 'panel' in listing  
✅ `13:08:03` Panel tunnel shows correct agentLabel in listing  

## Verify nginx mTLS vhost created (not app vhost)

✅ `13:08:03` mTLS panel vhost exists at /etc/nginx/sites-enabled/lamaste-agent-panel-agent-panel-e2e-1774876078  
✅ `13:08:03` No app vhost created (correct — panel uses mTLS vhost)  
✅ `13:08:03` nginx -t passes after panel expose  

## Verify agent-panel-status after expose

✅ `13:08:03` Panel shows as enabled after expose  
✅ `13:08:03` Panel status FQDN matches  
✅ `13:08:03` Panel status port matches  

## Duplicate expose returns 409

✅ `13:08:03` Duplicate panel expose returns 409 Conflict  

## Validation: agent- prefix reserved for non-panel tunnels

✅ `13:08:04` agent- prefix rejected for non-panel tunnel (HTTP 400)  

## Capability check: agent without panel:expose gets 403

✅ `13:08:06` Agent cert without panel:expose created  
✅ `13:08:06` Expose panel returns 403 without panel:expose capability  
✅ `13:08:06` Agent panel status returns 403 without panel:expose capability  
✅ `13:08:06` Retract panel returns 403 without panel:expose capability  

## Capability check: PATCH panel tunnel requires panel:expose

✅ `13:08:07` PATCH panel tunnel returns 403 without panel:expose  

## Capability check: DELETE panel tunnel requires panel:expose

✅ `13:08:07` DELETE panel tunnel returns 403 without panel:expose  

## Cross-agent spoofing: generic POST /api/tunnels with type=panel

✅ `13:08:07` Cross-agent panel tunnel spoofing rejected (HTTP 403)  

## Retract panel: DELETE /api/tunnels/retract-panel

✅ `13:08:09` Retract panel returned ok: true  
✅ `13:08:09` Panel tunnel no longer in list after retract  
✅ `13:08:09` mTLS panel vhost removed after retract  
✅ `13:08:09` nginx -t passes after panel retract  

## Verify agent-panel-status after retract

✅ `13:08:09` Panel shows as disabled after retract  

## Retract nonexistent panel returns 404

✅ `13:08:09` Retract nonexistent panel returns 404  

## Validation: expose-panel with invalid port

✅ `13:08:09` Port below 1024 rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `13:08:09` Cleaning up test resources...  
