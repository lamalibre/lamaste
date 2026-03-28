# Portlama E2E: 15 — Plugin Lifecycle

> Started at `2026-03-28 16:08:49 UTC`


## Pre-flight: check onboarding is complete

✅ `16:08:49` Onboarding is complete  

## Empty initial plugin list

✅ `16:08:49` Initial plugin list is empty  

## Plugin install validation

✅ `16:08:49` Non-@lamalibre package rejected (HTTP 400)  
✅ `16:08:49` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `16:08:49` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `16:08:49` Enable non-existent plugin returns 404  
✅ `16:08:49` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `16:08:49` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `16:08:49` Push install is disabled by default  
✅ `16:08:49` Default policy ID is 'default'  
✅ `16:08:49` At least one push install policy exists (count: 1)  

## Push install config update

✅ `16:08:49` PATCH push-install config returned ok: true  
✅ `16:08:49` Push install is now enabled  

## Create a push install policy

✅ `16:08:49` Policy creation returned ok: true  
✅ `16:08:49` Policy ID matches  

## Verify policy in listing

✅ `16:08:49` Created policy appears in listing  

## Update the push install policy

✅ `16:08:49` Policy update returned ok: true  
✅ `16:08:49` Description updated  

## Cannot delete the default push install policy

✅ `16:08:49` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `16:08:49` Policy deletion returned ok: true  
✅ `16:08:49` Deleted policy no longer in listing  

## Push install policy validation

✅ `16:08:49` POST policy with empty name rejected (HTTP 400)  
✅ `16:08:49` POST policy with duplicate ID rejected (HTTP 409)  
✅ `16:08:50` PATCH non-existent policy returns 404  
✅ `16:08:50` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `16:08:50` Found agent: test-agent  
✅ `16:08:50` Push install enable for agent returned ok: true  
✅ `16:08:50` pushInstallEnabledUntil is set  
✅ `16:08:50` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `16:08:50` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `16:08:50` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `16:08:50` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `16:08:50` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `16:08:50` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `16:08:50` POST enable for non-existent agent returns 404  
✅ `16:08:50` DELETE enable for non-existent agent returns 404  
✅ `16:08:50` POST enable with invalid label format rejected (HTTP 400)  
✅ `16:08:50` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `16:08:50` Push install disabled globally for cleanup  
✅ `16:08:50` Push install is disabled after cleanup  
✅ `16:08:50` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

