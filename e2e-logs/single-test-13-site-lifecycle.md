# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-24 09:38:04 UTC`


## Pre-flight: check onboarding is complete

✅ `09:38:04` Onboarding is complete  

## Create managed static site

✅ `09:38:04` Site creation returned ok: true  
✅ `09:38:04` Site has an ID  
✅ `09:38:04` Site name matches  
✅ `09:38:04` Site type is managed  
ℹ️ `09:38:04` Created site: e2esite.test.portlama.local (ID: 1c960bde-1790-40cb-8de6-a25db598930c)  

## Verify site in listing

✅ `09:38:04` Site appears in listing  

## List files — default content

✅ `09:38:04` Site has default files (count: 1)  
✅ `09:38:04` Default index.html exists  

## Upload test file

✅ `09:38:05` File upload returned ok: true  

## Verify uploaded file in listing

✅ `09:38:05` Uploaded file appears in listing  

## Delete uploaded file

✅ `09:38:05` File deletion returned ok: true  

## Verify file removed

✅ `09:38:05` Deleted file no longer in listing  

## Update site settings

✅ `09:38:05` Settings update returned ok: true  
✅ `09:38:05` SPA mode is now enabled  
✅ `09:38:05` SPA mode persisted in listing  

## File extension validation

✅ `09:38:05` Upload of .php file rejected with 400  
✅ `09:38:05` Upload of .exe file rejected with 400  
✅ `09:38:05` Upload of file with no extension rejected with 400  
✅ `09:38:05` Upload of .css file succeeds  

## Input validation

✅ `09:38:05` Duplicate site name rejected with 400  
✅ `09:38:05` Reserved name 'panel' rejected with 400  
✅ `09:38:05` Reserved name 'auth' rejected with 400  
✅ `09:38:05` Invalid UUID rejected with 400  

## Delete site

✅ `09:38:05` Site deletion returned ok: true  

## Verify site removed

✅ `09:38:05` Deleted site no longer in listing  
✅ `09:38:05` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

