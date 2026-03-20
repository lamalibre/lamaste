# Portlama E2E: 14 — Shell Lifecycle

> Started at `2026-03-20 14:34:19 UTC`


## Pre-flight: check onboarding is complete

✅ `14:34:19` Onboarding is complete  

## Shell config defaults

✅ `14:34:19` Shell is disabled by default  
✅ `14:34:19` Default policy ID is 'default'  
✅ `14:34:19` At least one policy exists (count: 1)  
✅ `14:34:19` Default policy has name 'Default'  

## Enable shell globally

✅ `14:34:19` PATCH shell/config returned ok: true  
✅ `14:34:19` Shell is now enabled  

## Create a shell policy

✅ `14:34:19` Policy creation returned ok: true  
✅ `14:34:19` Policy ID matches  
✅ `14:34:19` Policy name matches  
✅ `14:34:19` Inactivity timeout is 300  

## Verify policy in listing

✅ `14:34:19` Created policy appears in listing  

## Update the policy

✅ `14:34:19` Policy update returned ok: true  
✅ `14:34:19` Inactivity timeout updated to 600  
✅ `14:34:19` Description updated  
✅ `14:34:19` Updated timeout persisted in listing  

## Cannot delete the default policy

✅ `14:34:19` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-test-policy

✅ `14:34:19` Policy deletion returned ok: true  
✅ `14:34:19` Deleted policy no longer in listing  

## Policy validation

✅ `14:34:19` POST policy with empty name rejected (HTTP 400)  
✅ `14:34:19` POST policy with invalid CIDR /99 rejected (HTTP 400)  
✅ `14:34:19` POST policy with duplicate ID rejected (HTTP 409)  

## Enable shell for agent

ℹ️ `14:34:19` Found agent: test-agent  
✅ `14:34:19` Shell enable for agent returned ok: true  
✅ `14:34:19` shellEnabledUntil is set  
✅ `14:34:19` shellEnabledUntil has a value: 2026-03-20T14:39:19.497Z  
✅ `14:34:19` Shell disable for agent returned ok: true  

## Shell enable without global toggle

✅ `14:34:19` Cannot enable shell for agent when globally disabled (HTTP 400)  

## Session audit log

✅ `14:34:19` GET shell/sessions returns a sessions array  

## File transfer endpoints (not yet implemented)

✅ `14:34:19` GET shell/file/:label returns 501 (not implemented)  
✅ `14:34:19` POST shell/file/:label returns 501 (not implemented)  

## Recordings listing

✅ `14:34:19` GET shell/recordings/:label returns a recordings array  
✅ `14:34:19` Recording download for non-existent session returns 404  

## Input validation

✅ `14:34:19` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `14:34:19` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `14:34:19` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `14:34:19` POST policy with name > 100 chars rejected (HTTP 400)  
✅ `14:34:19` POST policy with invalid ID characters rejected (HTTP 400)  
✅ `14:34:19` PATCH non-existent policy returns 404  
✅ `14:34:19` DELETE non-existent policy returns 404  
✅ `14:34:19` POST enable for non-existent agent returns 404  
✅ `14:34:19` DELETE enable for non-existent agent returns 404  
✅ `14:34:19` POST enable with invalid label format rejected (HTTP 400)  
✅ `14:34:19` GET shell/file without path query rejected (HTTP 400)  
✅ `14:34:19` Recording with invalid session ID rejected (HTTP 400)  

## Cleanup

✅ `14:34:19` Shell disabled globally for cleanup  
✅ `14:34:19` Shell is disabled after cleanup  
✅ `14:34:19` Cleanup complete — shell state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `47` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `47` |

