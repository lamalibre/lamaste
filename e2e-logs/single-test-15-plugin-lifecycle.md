# Portlama E2E: 15 — Plugin Lifecycle

> Started at `2026-03-22 18:25:21 UTC`


## Pre-flight: check onboarding is complete

✅ `18:25:21` Onboarding is complete  

## Empty initial plugin list

✅ `18:25:21` Initial plugin list is empty  

## Plugin install validation

✅ `18:25:21` Non-@lamalibre package rejected (HTTP 400)  
✅ `18:25:21` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `18:25:21` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `18:25:21` Enable non-existent plugin returns 404  
✅ `18:25:21` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `18:25:21` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `18:25:21` Push install is disabled by default  
✅ `18:25:21` Default policy ID is 'default'  
✅ `18:25:21` At least one push install policy exists (count: 1)  

## Push install config update

✅ `18:25:21` PATCH push-install config returned ok: true  
✅ `18:25:21` Push install is now enabled  

## Create a push install policy

✅ `18:25:21` Policy creation returned ok: true  
✅ `18:25:21` Policy ID matches  

## Verify policy in listing

✅ `18:25:21` Created policy appears in listing  

## Update the push install policy

✅ `18:25:21` Policy update returned ok: true  
✅ `18:25:21` Description updated  

## Cannot delete the default push install policy

✅ `18:25:21` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `18:25:21` Policy deletion returned ok: true  
✅ `18:25:21` Deleted policy no longer in listing  

## Push install policy validation

✅ `18:25:21` POST policy with empty name rejected (HTTP 400)  
✅ `18:25:21` POST policy with duplicate ID rejected (HTTP 409)  
✅ `18:25:21` PATCH non-existent policy returns 404  
✅ `18:25:21` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `18:25:21` Found agent: test-agent  
✅ `18:25:21` Push install enable for agent returned ok: true  
✅ `18:25:21` pushInstallEnabledUntil is set  
✅ `18:25:21` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `18:25:21` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `18:25:21` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `18:25:21` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `18:25:21` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `18:25:21` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `18:25:21` POST enable for non-existent agent returns 404  
✅ `18:25:21` DELETE enable for non-existent agent returns 404  
✅ `18:25:21` POST enable with invalid label format rejected (HTTP 400)  
✅ `18:25:21` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `18:25:21` Push install disabled globally for cleanup  
✅ `18:25:21` Push install is disabled after cleanup  
✅ `18:25:21` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

