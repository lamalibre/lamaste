# Portlama E2E: 15 — Plugin Lifecycle

> Started at `2026-03-24 08:11:12 UTC`


## Pre-flight: check onboarding is complete

✅ `08:11:12` Onboarding is complete  

## Empty initial plugin list

✅ `08:11:12` Initial plugin list is empty  

## Plugin install validation

✅ `08:11:12` Non-@lamalibre package rejected (HTTP 400)  
✅ `08:11:12` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `08:11:12` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `08:11:12` Enable non-existent plugin returns 404  
✅ `08:11:12` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `08:11:12` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `08:11:12` Push install is disabled by default  
✅ `08:11:12` Default policy ID is 'default'  
✅ `08:11:12` At least one push install policy exists (count: 1)  

## Push install config update

✅ `08:11:12` PATCH push-install config returned ok: true  
✅ `08:11:12` Push install is now enabled  

## Create a push install policy

✅ `08:11:12` Policy creation returned ok: true  
✅ `08:11:12` Policy ID matches  

## Verify policy in listing

✅ `08:11:13` Created policy appears in listing  

## Update the push install policy

✅ `08:11:13` Policy update returned ok: true  
✅ `08:11:13` Description updated  

## Cannot delete the default push install policy

✅ `08:11:13` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `08:11:13` Policy deletion returned ok: true  
✅ `08:11:13` Deleted policy no longer in listing  

## Push install policy validation

✅ `08:11:13` POST policy with empty name rejected (HTTP 400)  
✅ `08:11:13` POST policy with duplicate ID rejected (HTTP 409)  
✅ `08:11:13` PATCH non-existent policy returns 404  
✅ `08:11:13` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `08:11:13` Found agent: test-agent  
✅ `08:11:13` Push install enable for agent returned ok: true  
✅ `08:11:13` pushInstallEnabledUntil is set  
✅ `08:11:13` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `08:11:13` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `08:11:13` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `08:11:13` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `08:11:13` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `08:11:13` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `08:11:13` POST enable for non-existent agent returns 404  
✅ `08:11:13` DELETE enable for non-existent agent returns 404  
✅ `08:11:13` POST enable with invalid label format rejected (HTTP 400)  
✅ `08:11:13` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `08:11:13` Push install disabled globally for cleanup  
✅ `08:11:13` Push install is disabled after cleanup  
✅ `08:11:13` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

