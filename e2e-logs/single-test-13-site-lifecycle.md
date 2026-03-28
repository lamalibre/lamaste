# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-28 16:08:48 UTC`


## Pre-flight: check onboarding is complete

✅ `16:08:48` Onboarding is complete  

## Create managed static site

✅ `16:08:49` Site creation returned ok: true  
✅ `16:08:49` Site has an ID  
✅ `16:08:49` Site name matches  
✅ `16:08:49` Site type is managed  
ℹ️ `16:08:49` Created site: e2esite.test.portlama.local (ID: 5cac3bef-37f2-4d7c-91b2-6d9db25859d4)  

## Verify site in listing

✅ `16:08:49` Site appears in listing  

## List files — default content

✅ `16:08:49` Site has default files (count: 1)  
✅ `16:08:49` Default index.html exists  

## Upload test file

✅ `16:08:49` File upload returned ok: true  

## Verify uploaded file in listing

✅ `16:08:49` Uploaded file appears in listing  

## Delete uploaded file

✅ `16:08:49` File deletion returned ok: true  

## Verify file removed

✅ `16:08:49` Deleted file no longer in listing  

## Update site settings

✅ `16:08:49` Settings update returned ok: true  
✅ `16:08:49` SPA mode is now enabled  
✅ `16:08:49` SPA mode persisted in listing  

## File extension validation

✅ `16:08:49` Upload of .php file rejected with 400  
✅ `16:08:49` Upload of .exe file rejected with 400  
✅ `16:08:49` Upload of file with no extension rejected with 400  
✅ `16:08:49` Upload of .css file succeeds  

## Input validation

✅ `16:08:49` Duplicate site name rejected with 400  
✅ `16:08:49` Reserved name 'panel' rejected with 400  
✅ `16:08:49` Reserved name 'auth' rejected with 400  
✅ `16:08:49` Invalid UUID rejected with 400  

## Delete site

✅ `16:08:49` Site deletion returned ok: true  

## Verify site removed

✅ `16:08:49` Deleted site no longer in listing  
✅ `16:08:49` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

