# Portlama E2E: 14 — Shell Lifecycle

> Started at `2026-03-23 12:09:44 UTC`


## Pre-flight: check onboarding is complete

✅ `12:09:44` Onboarding is complete  

## Shell config defaults

✅ `12:09:44` Shell is disabled by default  
✅ `12:09:44` Default policy ID is 'default'  
✅ `12:09:44` At least one policy exists (count: 1)  
✅ `12:09:44` Default policy has name 'Default'  

## Enable shell globally

✅ `12:09:44` PATCH shell/config returned ok: true  
✅ `12:09:44` Shell is now enabled  

## Create a shell policy

✅ `12:09:44` Policy creation returned ok: true  
✅ `12:09:44` Policy ID matches  
✅ `12:09:44` Policy name matches  
✅ `12:09:44` Inactivity timeout is 300  

## Verify policy in listing

✅ `12:09:44` Created policy appears in listing  

## Update the policy

✅ `12:09:44` Policy update returned ok: true  
✅ `12:09:44` Inactivity timeout updated to 600  
✅ `12:09:44` Description updated  
✅ `12:09:44` Updated timeout persisted in listing  

## Cannot delete the default policy

✅ `12:09:44` Cannot delete the default policy (HTTP 400)  

## Delete the e2e-test-policy

✅ `12:09:44` Policy deletion returned ok: true  
✅ `12:09:45` Deleted policy no longer in listing  

## Policy validation

✅ `12:09:45` POST policy with empty name rejected (HTTP 400)  
✅ `12:09:45` POST policy with invalid CIDR /99 rejected (HTTP 400)  
✅ `12:09:45` POST policy with duplicate ID rejected (HTTP 409)  

## Enable shell for agent

ℹ️ `12:09:45` Found agent: test-agent  
✅ `12:09:45` Shell enable for agent returned ok: true  
✅ `12:09:45` shellEnabledUntil is set  
✅ `12:09:45` shellEnabledUntil has a value: 2026-03-23T12:14:45.108Z  
✅ `12:09:45` Shell disable for agent returned ok: true  

## Shell enable without global toggle

✅ `12:09:45` Cannot enable shell for agent when globally disabled (HTTP 400)  

## Session audit log

✅ `12:09:45` GET shell/sessions returns a sessions array  

## File transfer endpoints (not yet implemented)

✅ `12:09:45` GET shell/file/:label returns 501 (not implemented)  
✅ `12:09:45` POST shell/file/:label returns 501 (not implemented)  

## Recordings listing

✅ `12:09:45` GET shell/recordings/:label returns a recordings array  
✅ `12:09:45` Recording download for non-existent session returns 404  

## Input validation

✅ `12:09:45` PATCH config with non-existent defaultPolicy rejected (HTTP 400)  
✅ `12:09:45` POST enable with durationMinutes: 0 rejected (HTTP 400)  
✅ `12:09:45` POST enable with durationMinutes: 9999 rejected (HTTP 400)  
✅ `12:09:45` POST policy with name > 100 chars rejected (HTTP 400)  
✅ `12:09:45` POST policy with invalid ID characters rejected (HTTP 400)  
✅ `12:09:45` PATCH non-existent policy returns 404  
✅ `12:09:45` DELETE non-existent policy returns 404  
✅ `12:09:45` POST enable for non-existent agent returns 404  
✅ `12:09:45` DELETE enable for non-existent agent returns 404  
✅ `12:09:45` POST enable with invalid label format rejected (HTTP 400)  
✅ `12:09:45` GET shell/file without path query rejected (HTTP 400)  
✅ `12:09:45` Recording with invalid session ID rejected (HTTP 400)  

## Cleanup

✅ `12:09:45` Shell disabled globally for cleanup  
✅ `12:09:45` Shell is disabled after cleanup  
✅ `12:09:45` Cleanup complete — shell state restored  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `47` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `47` |

