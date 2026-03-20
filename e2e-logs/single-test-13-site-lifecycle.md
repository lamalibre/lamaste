# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-20 14:34:18 UTC`


## Pre-flight: check onboarding is complete

✅ `14:34:18` Onboarding is complete  

## Create managed static site

✅ `14:34:18` Site creation returned ok: true  
✅ `14:34:18` Site has an ID  
✅ `14:34:18` Site name matches  
✅ `14:34:18` Site type is managed  
ℹ️ `14:34:18` Created site: e2esite.test.portlama.local (ID: a5ebe809-022f-4b6e-8677-ad714f92fdaa)  

## Verify site in listing

✅ `14:34:18` Site appears in listing  

## List files — default content

✅ `14:34:18` Site has default files (count: 1)  
✅ `14:34:18` Default index.html exists  

## Upload test file

✅ `14:34:18` File upload returned ok: true  

## Verify uploaded file in listing

✅ `14:34:18` Uploaded file appears in listing  

## Delete uploaded file

✅ `14:34:18` File deletion returned ok: true  

## Verify file removed

✅ `14:34:18` Deleted file no longer in listing  

## Update site settings

✅ `14:34:18` Settings update returned ok: true  
✅ `14:34:18` SPA mode is now enabled  
✅ `14:34:18` SPA mode persisted in listing  

## File extension validation

✅ `14:34:18` Upload of .php file rejected with 400  
✅ `14:34:18` Upload of .exe file rejected with 400  
✅ `14:34:18` Upload of file with no extension rejected with 400  
✅ `14:34:18` Upload of .css file succeeds  

## Input validation

✅ `14:34:19` Duplicate site name rejected with 400  
✅ `14:34:19` Reserved name 'panel' rejected with 400  
✅ `14:34:19` Reserved name 'auth' rejected with 400  
✅ `14:34:19` Invalid UUID rejected with 400  

## Delete site

✅ `14:34:19` Site deletion returned ok: true  

## Verify site removed

✅ `14:34:19` Deleted site no longer in listing  
✅ `14:34:19` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

