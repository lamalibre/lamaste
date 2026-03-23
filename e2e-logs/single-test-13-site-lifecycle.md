# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-23 12:09:43 UTC`


## Pre-flight: check onboarding is complete

✅ `12:09:43` Onboarding is complete  

## Create managed static site

✅ `12:09:44` Site creation returned ok: true  
✅ `12:09:44` Site has an ID  
✅ `12:09:44` Site name matches  
✅ `12:09:44` Site type is managed  
ℹ️ `12:09:44` Created site: e2esite.test.portlama.local (ID: 4331a69c-31a6-49b2-a516-65ec37ad1e2f)  

## Verify site in listing

✅ `12:09:44` Site appears in listing  

## List files — default content

✅ `12:09:44` Site has default files (count: 1)  
✅ `12:09:44` Default index.html exists  

## Upload test file

✅ `12:09:44` File upload returned ok: true  

## Verify uploaded file in listing

✅ `12:09:44` Uploaded file appears in listing  

## Delete uploaded file

✅ `12:09:44` File deletion returned ok: true  

## Verify file removed

✅ `12:09:44` Deleted file no longer in listing  

## Update site settings

✅ `12:09:44` Settings update returned ok: true  
✅ `12:09:44` SPA mode is now enabled  
✅ `12:09:44` SPA mode persisted in listing  

## File extension validation

✅ `12:09:44` Upload of .php file rejected with 400  
✅ `12:09:44` Upload of .exe file rejected with 400  
✅ `12:09:44` Upload of file with no extension rejected with 400  
✅ `12:09:44` Upload of .css file succeeds  

## Input validation

✅ `12:09:44` Duplicate site name rejected with 400  
✅ `12:09:44` Reserved name 'panel' rejected with 400  
✅ `12:09:44` Reserved name 'auth' rejected with 400  
✅ `12:09:44` Invalid UUID rejected with 400  

## Delete site

✅ `12:09:44` Site deletion returned ok: true  

## Verify site removed

✅ `12:09:44` Deleted site no longer in listing  
✅ `12:09:44` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

