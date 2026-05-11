# Lamaste E2E: 15 — Plugin Lifecycle

> Started at `2026-03-30 13:07:05 UTC`


## Pre-flight: check onboarding is complete

✅ `13:07:05` Onboarding is complete  

## Empty initial plugin list

✅ `13:07:05` Initial plugin list is empty  

## Plugin install validation

✅ `13:07:05` Non-@lamalibre package rejected (HTTP 400)  
✅ `13:07:05` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `13:07:05` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `13:07:05` Enable non-existent plugin returns 404  
✅ `13:07:05` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `13:07:05` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `13:07:06` Push install is disabled by default  
✅ `13:07:06` Default policy ID is 'default'  
✅ `13:07:06` At least one push install policy exists (count: 1)  

## Push install config update

✅ `13:07:06` PATCH push-install config returned ok: true  
✅ `13:07:06` Push install is now enabled  

## Create a push install policy

✅ `13:07:06` Policy creation returned ok: true  
✅ `13:07:06` Policy ID matches  

## Verify policy in listing

✅ `13:07:06` Created policy appears in listing  

## Update the push install policy

✅ `13:07:06` Policy update returned ok: true  
✅ `13:07:06` Description updated  

## Cannot delete the default push install policy

✅ `13:07:06` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `13:07:06` Policy deletion returned ok: true  
✅ `13:07:06` Deleted policy no longer in listing  

## Push install policy validation

✅ `13:07:06` POST policy with empty name rejected (HTTP 400)  
✅ `13:07:06` POST policy with duplicate ID rejected (HTTP 409)  
✅ `13:07:06` PATCH non-existent policy returns 404  
✅ `13:07:06` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `13:07:06` Found agent: test-agent  
✅ `13:07:06` Push install enable for agent returned ok: true  
✅ `13:07:06` pushInstallEnabledUntil is set  
✅ `13:07:06` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `13:07:06` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `13:07:06` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `13:07:06` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `13:07:06` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `13:07:06` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `13:07:06` POST enable for non-existent agent returns 404  
✅ `13:07:06` DELETE enable for non-existent agent returns 404  
✅ `13:07:06` POST enable with invalid label format rejected (HTTP 400)  
✅ `13:07:06` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `13:07:06` Push install disabled globally for cleanup  
✅ `13:07:06` Push install is disabled after cleanup  
✅ `13:07:06` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

