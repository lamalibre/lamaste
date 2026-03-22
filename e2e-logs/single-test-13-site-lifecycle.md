# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-22 18:25:17 UTC`


## Pre-flight: check onboarding is complete

✅ `18:25:18` Onboarding is complete  

## Create managed static site

✅ `18:25:18` Site creation returned ok: true  
✅ `18:25:18` Site has an ID  
✅ `18:25:18` Site name matches  
✅ `18:25:18` Site type is managed  
ℹ️ `18:25:18` Created site: e2esite.test.portlama.local (ID: 4238e5bc-c1ec-42d6-aee6-a56d907ee5a9)  

## Verify site in listing

✅ `18:25:18` Site appears in listing  

## List files — default content

✅ `18:25:18` Site has default files (count: 1)  
✅ `18:25:18` Default index.html exists  

## Upload test file

✅ `18:25:18` File upload returned ok: true  

## Verify uploaded file in listing

✅ `18:25:18` Uploaded file appears in listing  

## Delete uploaded file

✅ `18:25:18` File deletion returned ok: true  

## Verify file removed

✅ `18:25:18` Deleted file no longer in listing  

## Update site settings

✅ `18:25:19` Settings update returned ok: true  
✅ `18:25:19` SPA mode is now enabled  
✅ `18:25:19` SPA mode persisted in listing  

## File extension validation

✅ `18:25:19` Upload of .php file rejected with 400  
✅ `18:25:19` Upload of .exe file rejected with 400  
✅ `18:25:19` Upload of file with no extension rejected with 400  
✅ `18:25:19` Upload of .css file succeeds  

## Input validation

✅ `18:25:19` Duplicate site name rejected with 400  
✅ `18:25:19` Reserved name 'panel' rejected with 400  
✅ `18:25:19` Reserved name 'auth' rejected with 400  
✅ `18:25:19` Invalid UUID rejected with 400  

## Delete site

✅ `18:25:19` Site deletion returned ok: true  

## Verify site removed

✅ `18:25:19` Deleted site no longer in listing  
✅ `18:25:19` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

