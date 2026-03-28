# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-28 22:39:11 UTC`


## Pre-flight: check onboarding is complete

✅ `22:39:11` Onboarding is complete  

## Create managed static site

✅ `22:39:11` Site creation returned ok: true  
✅ `22:39:11` Site has an ID  
✅ `22:39:11` Site name matches  
✅ `22:39:11` Site type is managed  
ℹ️ `22:39:11` Created site: e2esite.test.portlama.local (ID: 8bb484c8-aeab-41d6-b114-bb520c3e8e89)  

## Verify site in listing

✅ `22:39:11` Site appears in listing  

## List files — default content

✅ `22:39:11` Site has default files (count: 1)  
✅ `22:39:11` Default index.html exists  

## Upload test file

✅ `22:39:11` File upload returned ok: true  

## Verify uploaded file in listing

✅ `22:39:11` Uploaded file appears in listing  

## Delete uploaded file

✅ `22:39:11` File deletion returned ok: true  

## Verify file removed

✅ `22:39:11` Deleted file no longer in listing  

## Update site settings

✅ `22:39:12` Settings update returned ok: true  
✅ `22:39:12` SPA mode is now enabled  
✅ `22:39:12` SPA mode persisted in listing  

## File extension validation

✅ `22:39:12` Upload of .php file rejected with 400  
✅ `22:39:12` Upload of .exe file rejected with 400  
✅ `22:39:12` Upload of file with no extension rejected with 400  
✅ `22:39:12` Upload of .css file succeeds  

## Input validation

✅ `22:39:12` Duplicate site name rejected with 400  
✅ `22:39:12` Reserved name 'panel' rejected with 400  
✅ `22:39:12` Reserved name 'auth' rejected with 400  
✅ `22:39:12` Invalid UUID rejected with 400  

## Delete site

✅ `22:39:12` Site deletion returned ok: true  

## Verify site removed

✅ `22:39:12` Deleted site no longer in listing  
✅ `22:39:12` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

