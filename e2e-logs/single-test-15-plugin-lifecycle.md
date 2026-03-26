# Portlama E2E: 15 — Plugin Lifecycle

> Started at `2026-03-26 10:46:56 UTC`


## Pre-flight: check onboarding is complete

✅ `10:46:56` Onboarding is complete  

## Empty initial plugin list

✅ `10:46:56` Initial plugin list is empty  

## Plugin install validation

✅ `10:46:56` Non-@lamalibre package rejected (HTTP 400)  
✅ `10:46:56` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `10:46:56` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `10:46:56` Enable non-existent plugin returns 404  
✅ `10:46:56` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `10:46:56` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `10:46:56` Push install is disabled by default  
✅ `10:46:56` Default policy ID is 'default'  
✅ `10:46:56` At least one push install policy exists (count: 1)  

## Push install config update

✅ `10:46:56` PATCH push-install config returned ok: true  
✅ `10:46:56` Push install is now enabled  

## Create a push install policy

✅ `10:46:56` Policy creation returned ok: true  
✅ `10:46:56` Policy ID matches  

## Verify policy in listing

✅ `10:46:56` Created policy appears in listing  

## Update the push install policy

✅ `10:46:56` Policy update returned ok: true  
✅ `10:46:56` Description updated  

## Cannot delete the default push install policy

✅ `10:46:56` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `10:46:56` Policy deletion returned ok: true  
✅ `10:46:56` Deleted policy no longer in listing  

## Push install policy validation

✅ `10:46:56` POST policy with empty name rejected (HTTP 400)  
✅ `10:46:56` POST policy with duplicate ID rejected (HTTP 409)  
✅ `10:46:56` PATCH non-existent policy returns 404  
✅ `10:46:56` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `10:46:56` Found agent: test-agent  
✅ `10:46:56` Push install enable for agent returned ok: true  
✅ `10:46:56` pushInstallEnabledUntil is set  
✅ `10:46:56` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `10:46:56` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `10:46:56` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `10:46:56` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `10:46:56` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `10:46:56` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `10:46:56` POST enable for non-existent agent returns 404  
✅ `10:46:56` DELETE enable for non-existent agent returns 404  
✅ `10:46:56` POST enable with invalid label format rejected (HTTP 400)  
✅ `10:46:56` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `10:46:56` Push install disabled globally for cleanup  
✅ `10:46:56` Push install is disabled after cleanup  
✅ `10:46:56` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

