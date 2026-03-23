# Portlama E2E: 15 — Plugin Lifecycle

> Started at `2026-03-23 12:09:45 UTC`


## Pre-flight: check onboarding is complete

✅ `12:09:45` Onboarding is complete  

## Empty initial plugin list

✅ `12:09:45` Initial plugin list is empty  

## Plugin install validation

✅ `12:09:45` Non-@lamalibre package rejected (HTTP 400)  
✅ `12:09:45` Empty package name rejected (HTTP 400)  

## Plugin detail for non-existent plugin

✅ `12:09:45` GET non-existent plugin returns 404  

## Enable/disable non-existent plugin

✅ `12:09:45` Enable non-existent plugin returns 404  
✅ `12:09:45` Disable non-existent plugin returns 404  

## Uninstall non-existent plugin

✅ `12:09:45` Uninstall non-existent plugin returns 404  

## Push install config defaults

✅ `12:09:45` Push install is disabled by default  
✅ `12:09:45` Default policy ID is 'default'  
✅ `12:09:45` At least one push install policy exists (count: 1)  

## Push install config update

✅ `12:09:45` PATCH push-install config returned ok: true  
✅ `12:09:45` Push install is now enabled  

## Create a push install policy

✅ `12:09:45` Policy creation returned ok: true  
✅ `12:09:45` Policy ID matches  

## Verify policy in listing

✅ `12:09:45` Created policy appears in listing  

## Update the push install policy

✅ `12:09:45` Policy update returned ok: true  
✅ `12:09:45` Description updated  

## Cannot delete the default push install policy

✅ `12:09:45` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-pi-test policy

✅ `12:09:45` Policy deletion returned ok: true  
✅ `12:09:45` Deleted policy no longer in listing  

## Push install policy validation

✅ `12:09:45` POST policy with empty name rejected (HTTP 400)  
✅ `12:09:45` POST policy with duplicate ID rejected (HTTP 409)  
✅ `12:09:45` PATCH non-existent policy returns 404  
✅ `12:09:45` DELETE non-existent policy returns 404  

## Push install enable/disable for agent

ℹ️ `12:09:45` Found agent: test-agent  
✅ `12:09:45` Push install enable for agent returned ok: true  
✅ `12:09:45` pushInstallEnabledUntil is set  
✅ `12:09:45` Push install disable for agent returned ok: true  

## Push install without global toggle

✅ `12:09:45` Cannot enable push install when globally disabled (HTTP 400)  

## Push install sessions audit log

✅ `12:09:45` GET push-install sessions returns a sessions array  

## Push install input validation

✅ `12:09:46` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `12:09:46` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `12:09:46` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `12:09:46` POST enable for non-existent agent returns 404  
✅ `12:09:46` DELETE enable for non-existent agent returns 404  
✅ `12:09:46` POST enable with invalid label format rejected (HTTP 400)  
✅ `12:09:46` GET plugin with invalid name rejected (HTTP 400)  

## Cleanup

✅ `12:09:46` Push install disabled globally for cleanup  
✅ `12:09:46` Push install is disabled after cleanup  
✅ `12:09:46` Cleanup complete — plugin state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `40` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `40` |

