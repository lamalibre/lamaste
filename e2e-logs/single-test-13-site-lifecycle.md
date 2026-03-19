# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-19 12:17:48 UTC`


## Pre-flight: check onboarding is complete

✅ `12:17:48` Onboarding is complete  

## Create managed static site

✅ `12:17:48` Site creation returned ok: true  
✅ `12:17:48` Site has an ID  
✅ `12:17:48` Site name matches  
✅ `12:17:48` Site type is managed  
ℹ️ `12:17:48` Created site: e2esite.test.portlama.local (ID: 42ee82c4-c71b-40f3-9ece-bdf259db4a14)  

## Verify site in listing

✅ `12:17:48` Site appears in listing  

## List files — default content

✅ `12:17:48` Site has default files (count: 1)  
✅ `12:17:48` Default index.html exists  

## Upload test file

✅ `12:17:49` File upload returned ok: true  

## Verify uploaded file in listing

✅ `12:17:49` Uploaded file appears in listing  

## Delete uploaded file

✅ `12:17:49` File deletion returned ok: true  

## Verify file removed

✅ `12:17:49` Deleted file no longer in listing  

## Update site settings

✅ `12:17:49` Settings update returned ok: true  
✅ `12:17:49` SPA mode is now enabled  
✅ `12:17:49` SPA mode persisted in listing  

## File extension validation

✅ `12:17:49` Upload of .php file rejected with 400  
✅ `12:17:49` Upload of .exe file rejected with 400  
✅ `12:17:49` Upload of file with no extension rejected with 400  
✅ `12:17:49` Upload of .css file succeeds  

## Input validation

✅ `12:17:49` Duplicate site name rejected with 400  
✅ `12:17:49` Reserved name 'panel' rejected with 400  
✅ `12:17:49` Reserved name 'auth' rejected with 400  
✅ `12:17:49` Invalid UUID rejected with 400  

## Delete site

✅ `12:17:49` Site deletion returned ok: true  

## Verify site removed

✅ `12:17:49` Deleted site no longer in listing  
✅ `12:17:49` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

