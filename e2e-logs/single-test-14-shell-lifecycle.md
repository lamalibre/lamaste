# Portlama E2E: 14 — Shell Lifecycle

> Started at `2026-03-24 08:11:12 UTC`


## Pre-flight: check onboarding is complete

✅ `08:11:12` Onboarding is complete  

## Shell config defaults

✅ `08:11:12` Shell is disabled by default  
✅ `08:11:12` Default policy ID is 'default'  
✅ `08:11:12` At least one policy exists (count: 1)  
✅ `08:11:12` Default policy has name 'Default'  

## Enable shell globally

✅ `08:11:12` PATCH shell/config returned ok: true  
✅ `08:11:12` Shell is now enabled  

## Create a shell policy

✅ `08:11:12` Policy creation returned ok: true  
✅ `08:11:12` Policy ID matches  
✅ `08:11:12` Policy name matches  
✅ `08:11:12` Inactivity timeout is 300  

## Verify policy in listing

✅ `08:11:12` Created policy appears in listing  

## Update the policy

✅ `08:11:12` Policy update returned ok: true  
✅ `08:11:12` Inactivity timeout updated to 600  
✅ `08:11:12` Description updated  
✅ `08:11:12` Updated timeout persisted in listing  

## Cannot delete the default policy

✅ `08:11:12` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-test-policy

✅ `08:11:12` Policy deletion returned ok: true  
✅ `08:11:12` Deleted policy no longer in listing  

## Policy validation

✅ `08:11:12` POST policy with empty name rejected (HTTP 400)  
✅ `08:11:12` POST policy with invalid CIDR /99 rejected (HTTP 400)  
✅ `08:11:12` POST policy with duplicate ID rejected (HTTP 409)  

## Enable shell for agent

ℹ️ `08:11:12` Found agent: test-agent  
✅ `08:11:12` Shell enable for agent returned ok: true  
✅ `08:11:12` shellEnabledUntil is set  
✅ `08:11:12` shellEnabledUntil has a value: 2026-03-24T08:16:12.437Z  
✅ `08:11:12` Shell disable for agent returned ok: true  

## Shell enable without global toggle

✅ `08:11:12` Cannot enable shell for agent when globally disabled (HTTP 400)  

## Session audit log

✅ `08:11:12` GET shell/sessions returns a sessions array  

## File transfer endpoints (not yet implemented)

✅ `08:11:12` GET shell/file/:label returns 501 (not implemented)  
✅ `08:11:12` POST shell/file/:label returns 501 (not implemented)  

## Recordings listing

✅ `08:11:12` GET shell/recordings/:label returns a recordings array  
✅ `08:11:12` Recording download for non-existent session returns 404  

## Input validation

✅ `08:11:12` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `08:11:12` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `08:11:12` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `08:11:12` POST policy with name > 100 chars rejected (HTTP 400)  
✅ `08:11:12` POST policy with invalid ID characters rejected (HTTP 400)  
✅ `08:11:12` PATCH non-existent policy returns 404  
✅ `08:11:12` DELETE non-existent policy returns 404  
✅ `08:11:12` POST enable for non-existent agent returns 404  
✅ `08:11:12` DELETE enable for non-existent agent returns 404  
✅ `08:11:12` POST enable with invalid label format rejected (HTTP 400)  
✅ `08:11:12` GET shell/file without path query rejected (HTTP 400)  
✅ `08:11:12` Recording with invalid session ID rejected (HTTP 400)  

## Cleanup

✅ `08:11:12` Shell disabled globally for cleanup  
✅ `08:11:12` Shell is disabled after cleanup  
✅ `08:11:12` Cleanup complete — shell state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `47` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `47` |

