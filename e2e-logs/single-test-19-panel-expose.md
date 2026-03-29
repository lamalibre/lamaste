# Portlama E2E: 19 — Panel Expose Lifecycle

> Started at `2026-03-29 09:09:20 UTC`


## Pre-flight: check onboarding is complete


## Verify panel:expose is a valid capability

✅ `09:09:21` Agent cert with panel:expose created successfully  
✅ `09:09:21` Agent cert has a p12 password  
ℹ️ `09:09:21` Created agent cert: panel-e2e-1774775360  
✅ `09:09:21` Extracted PEM cert and key from .p12  

## Expose panel: check agent-panel-status before expose

✅ `09:09:21` Panel not exposed initially  
✅ `09:09:21` No FQDN before expose  

## Expose panel: POST /api/tunnels/expose-panel

✅ `09:09:23` Expose panel returned ok: true  
✅ `09:09:23` Panel tunnel has an ID  
✅ `09:09:23` Panel tunnel type is 'panel'  
✅ `09:09:23` Panel subdomain matches agent-<label>  
✅ `09:09:23` Panel tunnel port matches  
✅ `09:09:23` Panel tunnel has an FQDN  
✅ `09:09:23` Panel tunnel has a createdAt timestamp  
✅ `09:09:23` Panel tunnel agentLabel matches  
ℹ️ `09:09:23` Exposed panel tunnel: agent-panel-e2e-1774775360.test.portlama.local (ID: 26f852a6-010a-476e-a9e7-d2af1f71855d)  

## Verify panel tunnel in tunnel listing

✅ `09:09:23` Panel tunnel shows type 'panel' in listing  
✅ `09:09:23` Panel tunnel shows correct agentLabel in listing  

## Verify nginx mTLS vhost created (not app vhost)

✅ `09:09:23` mTLS panel vhost exists at /etc/nginx/sites-enabled/portlama-agent-panel-agent-panel-e2e-1774775360  
✅ `09:09:23` No app vhost created (correct — panel uses mTLS vhost)  
✅ `09:09:23` nginx -t passes after panel expose  

## Verify agent-panel-status after expose

✅ `09:09:23` Panel shows as enabled after expose  
✅ `09:09:23` Panel status FQDN matches  
✅ `09:09:23` Panel status port matches  

## Duplicate expose returns 409

✅ `09:09:23` Duplicate panel expose returns 409 Conflict  

## Validation: agent- prefix reserved for non-panel tunnels

✅ `09:09:23` agent- prefix rejected for non-panel tunnel (HTTP 400)  

## Capability check: agent without panel:expose gets 403

✅ `09:09:25` Agent cert without panel:expose created  
✅ `09:09:25` Expose panel returns 403 without panel:expose capability  
✅ `09:09:25` Agent panel status returns 403 without panel:expose capability  
✅ `09:09:25` Retract panel returns 403 without panel:expose capability  

## Capability check: PATCH panel tunnel requires panel:expose

✅ `09:09:25` PATCH panel tunnel returns 403 without panel:expose  

## Capability check: DELETE panel tunnel requires panel:expose

✅ `09:09:25` DELETE panel tunnel returns 403 without panel:expose  

## Cross-agent spoofing: generic POST /api/tunnels with type=panel

✅ `09:09:25` Cross-agent panel tunnel spoofing rejected (HTTP 403)  

## Retract panel: DELETE /api/tunnels/retract-panel

✅ `09:09:27` Retract panel returned ok: true  
✅ `09:09:27` Panel tunnel no longer in list after retract  
✅ `09:09:27` mTLS panel vhost removed after retract  
✅ `09:09:27` nginx -t passes after panel retract  

## Verify agent-panel-status after retract

✅ `09:09:27` Panel shows as disabled after retract  

## Retract nonexistent panel returns 404

✅ `09:09:27` Retract nonexistent panel returns 404  

## Validation: expose-panel with invalid port

✅ `09:09:27` Port below 1024 rejected (HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `09:09:27` Cleaning up test resources...  
