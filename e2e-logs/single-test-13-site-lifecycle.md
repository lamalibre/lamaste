# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-24 08:11:11 UTC`


## Pre-flight: check onboarding is complete

✅ `08:11:11` Onboarding is complete  

## Create managed static site

✅ `08:11:11` Site creation returned ok: true  
✅ `08:11:11` Site has an ID  
✅ `08:11:11` Site name matches  
✅ `08:11:11` Site type is managed  
ℹ️ `08:11:11` Created site: e2esite.test.portlama.local (ID: ffc10e66-aed1-4f1f-a69c-e10686afc3df)  

## Verify site in listing

✅ `08:11:11` Site appears in listing  

## List files — default content

✅ `08:11:11` Site has default files (count: 1)  
✅ `08:11:11` Default index.html exists  

## Upload test file

✅ `08:11:11` File upload returned ok: true  

## Verify uploaded file in listing

✅ `08:11:11` Uploaded file appears in listing  

## Delete uploaded file

✅ `08:11:11` File deletion returned ok: true  

## Verify file removed

✅ `08:11:11` Deleted file no longer in listing  

## Update site settings

✅ `08:11:11` Settings update returned ok: true  
✅ `08:11:11` SPA mode is now enabled  
✅ `08:11:11` SPA mode persisted in listing  

## File extension validation

✅ `08:11:11` Upload of .php file rejected with 400  
✅ `08:11:11` Upload of .exe file rejected with 400  
✅ `08:11:11` Upload of file with no extension rejected with 400  
✅ `08:11:11` Upload of .css file succeeds  

## Input validation

✅ `08:11:12` Duplicate site name rejected with 400  
✅ `08:11:12` Reserved name 'panel' rejected with 400  
✅ `08:11:12` Reserved name 'auth' rejected with 400  
✅ `08:11:12` Invalid UUID rejected with 400  

## Delete site

✅ `08:11:12` Site deletion returned ok: true  

## Verify site removed

✅ `08:11:12` Deleted site no longer in listing  
✅ `08:11:12` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

