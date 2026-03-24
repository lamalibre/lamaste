# Portlama E2E: 15 — Plugin Lifecycle

> Started at `2026-03-24 09:38:05 UTC`


## Pre-flight: check onboarding is complete

✅ `09:38:05` Onboarding is complete  

## Empty initial plugin list

✅ `09:38:05` Initial plugin list is empty  

## Plugin install validation

✅ `09:38:05` Non-@lamalibre package rejected (HTTP 400)  
✅ `09:38:05` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `09:38:05` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `09:38:05` Enable non-existent plugin returns 404  
✅ `09:38:05` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `09:38:05` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `09:38:05` Push install is disabled by default  
✅ `09:38:05` Default policy ID is 'default'  
✅ `09:38:05` At least one push install policy exists (count: 1)  

## Push install config update

✅ `09:38:05` PATCH push-install config returned ok: true  
✅ `09:38:05` Push install is now enabled  

## Create a push install policy

✅ `09:38:05` Policy creation returned ok: true  
✅ `09:38:05` Policy ID matches  

## Verify policy in listing

✅ `09:38:05` Created policy appears in listing  

## Update the push install policy

✅ `09:38:05` Policy update returned ok: true  
✅ `09:38:05` Description updated  

## Cannot delete the default push install policy

✅ `09:38:05` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `09:38:05` Policy deletion returned ok: true  
✅ `09:38:05` Deleted policy no longer in listing  

## Push install policy validation

✅ `09:38:05` POST policy with empty name rejected (HTTP 400)  
✅ `09:38:05` POST policy with duplicate ID rejected (HTTP 409)  
✅ `09:38:05` PATCH non-existent policy returns 404  
✅ `09:38:05` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `09:38:05` Found agent: test-agent  
✅ `09:38:05` Push install enable for agent returned ok: true  
✅ `09:38:05` pushInstallEnabledUntil is set  
✅ `09:38:05` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `09:38:05` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `09:38:05` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `09:38:05` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `09:38:06` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `09:38:06` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `09:38:06` POST enable for non-existent agent returns 404  
✅ `09:38:06` DELETE enable for non-existent agent returns 404  
✅ `09:38:06` POST enable with invalid label format rejected (HTTP 400)  
✅ `09:38:06` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `09:38:06` Push install disabled globally for cleanup  
✅ `09:38:06` Push install is disabled after cleanup  
✅ `09:38:06` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

