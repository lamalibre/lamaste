# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-29 09:08:35 UTC`


## Pre-flight: check onboarding is complete

✅ `09:08:35` Onboarding is complete  

## Create managed static site

✅ `09:08:36` Site creation returned ok: true  
✅ `09:08:36` Site has an ID  
✅ `09:08:36` Site name matches  
✅ `09:08:36` Site type is managed  
ℹ️ `09:08:36` Created site: e2esite.test.portlama.local (ID: 707b180c-1ac0-43e2-9001-f877ff6b9846)  

## Verify site in listing

✅ `09:08:36` Site appears in listing  

## List files — default content

✅ `09:08:36` Site has default files (count: 1)  
✅ `09:08:36` Default index.html exists  

## Upload test file

✅ `09:08:36` File upload returned ok: true  

## Verify uploaded file in listing

✅ `09:08:36` Uploaded file appears in listing  

## Delete uploaded file

✅ `09:08:36` File deletion returned ok: true  

## Verify file removed

✅ `09:08:36` Deleted file no longer in listing  

## Update site settings

✅ `09:08:36` Settings update returned ok: true  
✅ `09:08:36` SPA mode is now enabled  
✅ `09:08:36` SPA mode persisted in listing  

## File extension validation

✅ `09:08:36` Upload of .php file rejected with 400  
✅ `09:08:36` Upload of .exe file rejected with 400  
✅ `09:08:36` Upload of file with no extension rejected with 400  
✅ `09:08:36` Upload of .css file succeeds  

## Input validation

✅ `09:08:36` Duplicate site name rejected with 400  
✅ `09:08:36` Reserved name 'panel' rejected with 400  
✅ `09:08:36` Reserved name 'auth' rejected with 400  
✅ `09:08:36` Invalid UUID rejected with 400  

## Delete site

✅ `09:08:36` Site deletion returned ok: true  

## Verify site removed

✅ `09:08:36` Deleted site no longer in listing  
✅ `09:08:36` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

