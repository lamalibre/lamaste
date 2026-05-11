# Lamaste E2E: 13 — Site Lifecycle

> Started at `2026-03-30 13:07:04 UTC`


## Pre-flight: check onboarding is complete

✅ `13:07:04` Onboarding is complete  

## Create managed static site

✅ `13:07:05` Site creation returned ok: true  
✅ `13:07:05` Site has an ID  
✅ `13:07:05` Site name matches  
✅ `13:07:05` Site type is managed  
ℹ️ `13:07:05` Created site: e2esite.test.lamaste.local (ID: ae423cb6-1bde-4745-915c-68f469c426f6)  

## Verify site in listing

✅ `13:07:05` Site appears in listing  

## List files — default content

✅ `13:07:05` Site has default files (count: 1)  
✅ `13:07:05` Default index.html exists  

## Upload test file

✅ `13:07:05` File upload returned ok: true  

## Verify uploaded file in listing

✅ `13:07:05` Uploaded file appears in listing  

## Delete uploaded file

✅ `13:07:05` File deletion returned ok: true  

## Verify file removed

✅ `13:07:05` Deleted file no longer in listing  

## Update site settings

✅ `13:07:05` Settings update returned ok: true  
✅ `13:07:05` SPA mode is now enabled  
✅ `13:07:05` SPA mode persisted in listing  

## File extension validation

✅ `13:07:05` Upload of .php file rejected with 400  
✅ `13:07:05` Upload of .exe file rejected with 400  
✅ `13:07:05` Upload of file with no extension rejected with 400  
✅ `13:07:05` Upload of .css file succeeds  

## Input validation

✅ `13:07:05` Duplicate site name rejected with 400  
✅ `13:07:05` Reserved name 'panel' rejected with 400  
✅ `13:07:05` Reserved name 'auth' rejected with 400  
✅ `13:07:05` Invalid UUID rejected with 400  

## Delete site

✅ `13:07:05` Site deletion returned ok: true  

## Verify site removed

✅ `13:07:05` Deleted site no longer in listing  
✅ `13:07:05` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

