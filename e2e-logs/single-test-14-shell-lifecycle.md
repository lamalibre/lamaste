# Portlama E2E: 14 — Shell Lifecycle

> Started at `2026-03-22 18:25:19 UTC`


## Pre-flight: check onboarding is complete

✅ `18:25:19` Onboarding is complete  

## Shell config defaults

✅ `18:25:19` Shell is disabled by default  
✅ `18:25:19` Default policy ID is 'default'  
✅ `18:25:19` At least one policy exists (count: 1)  
✅ `18:25:19` Default policy has name 'Default'  

## Enable shell globally

✅ `18:25:19` PATCH shell/config returned ok: true  
✅ `18:25:19` Shell is now enabled  

## Create a shell policy

✅ `18:25:19` Policy creation returned ok: true  
✅ `18:25:19` Policy ID matches  
✅ `18:25:19` Policy name matches  
✅ `18:25:19` Inactivity timeout is 300  

## Verify policy in listing

✅ `18:25:19` Created policy appears in listing  

## Update the policy

✅ `18:25:19` Policy update returned ok: true  
✅ `18:25:19` Inactivity timeout updated to 600  
✅ `18:25:19` Description updated  
✅ `18:25:19` Updated timeout persisted in listing  

## Cannot delete the default policy

✅ `18:25:19` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-test-policy

✅ `18:25:19` Policy deletion returned ok: true  
✅ `18:25:19` Deleted policy no longer in listing  

## Policy validation

✅ `18:25:19` POST policy with empty name rejected (HTTP 400)  
✅ `18:25:19` POST policy with invalid CIDR /99 rejected (HTTP 400)  
✅ `18:25:19` POST policy with duplicate ID rejected (HTTP 409)  

## Enable shell for agent

ℹ️ `18:25:20` Found agent: test-agent  
✅ `18:25:20` Shell enable for agent returned ok: true  
✅ `18:25:20` shellEnabledUntil is set  
✅ `18:25:20` shellEnabledUntil has a value: 2026-03-22T18:30:20.044Z  
✅ `18:25:20` Shell disable for agent returned ok: true  

## Shell enable without global toggle

✅ `18:25:20` Cannot enable shell for agent when globally disabled (HTTP 400)  

## Session audit log

✅ `18:25:20` GET shell/sessions returns a sessions array  

## File transfer endpoints (not yet implemented)

✅ `18:25:20` GET shell/file/:label returns 501 (not implemented)  
✅ `18:25:20` POST shell/file/:label returns 501 (not implemented)  

## Recordings listing

✅ `18:25:20` GET shell/recordings/:label returns a recordings array  
✅ `18:25:20` Recording download for non-existent session returns 404  

## Input validation

✅ `18:25:20` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `18:25:20` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `18:25:20` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `18:25:20` POST policy with name > 100 chars rejected (HTTP 400)  
✅ `18:25:20` POST policy with invalid ID characters rejected (HTTP 400)  
✅ `18:25:20` PATCH non-existent policy returns 404  
✅ `18:25:20` DELETE non-existent policy returns 404  
✅ `18:25:20` POST enable for non-existent agent returns 404  
✅ `18:25:20` DELETE enable for non-existent agent returns 404  
✅ `18:25:21` POST enable with invalid label format rejected (HTTP 400)  
✅ `18:25:21` GET shell/file without path query rejected (HTTP 400)  
✅ `18:25:21` Recording with invalid session ID rejected (HTTP 400)  

## Cleanup

✅ `18:25:21` Shell disabled globally for cleanup  
✅ `18:25:21` Shell is disabled after cleanup  
✅ `18:25:21` Cleanup complete — shell state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `47` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `47` |

