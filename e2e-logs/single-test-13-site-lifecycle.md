# Portlama E2E: 13 — Site Lifecycle

> Started at `2026-03-26 10:46:55 UTC`


## Pre-flight: check onboarding is complete

✅ `10:46:55` Onboarding is complete  

## Create managed static site

✅ `10:46:55` Site creation returned ok: true  
✅ `10:46:55` Site has an ID  
✅ `10:46:55` Site name matches  
✅ `10:46:55` Site type is managed  
ℹ️ `10:46:55` Created site: e2esite.test.portlama.local (ID: 820ccc8f-cd6c-4acc-8394-22f4ba8cd20b)  

## Verify site in listing

✅ `10:46:55` Site appears in listing  

## List files — default content

✅ `10:46:55` Site has default files (count: 1)  
✅ `10:46:55` Default index.html exists  

## Upload test file

✅ `10:46:55` File upload returned ok: true  

## Verify uploaded file in listing

✅ `10:46:55` Uploaded file appears in listing  

## Delete uploaded file

✅ `10:46:55` File deletion returned ok: true  

## Verify file removed

✅ `10:46:55` Deleted file no longer in listing  

## Update site settings

✅ `10:46:55` Settings update returned ok: true  
✅ `10:46:55` SPA mode is now enabled  
✅ `10:46:55` SPA mode persisted in listing  

## File extension validation

✅ `10:46:55` Upload of .php file rejected with 400  
✅ `10:46:55` Upload of .exe file rejected with 400  
✅ `10:46:56` Upload of file with no extension rejected with 400  
✅ `10:46:56` Upload of .css file succeeds  

## Input validation

✅ `10:46:56` Duplicate site name rejected with 400  
✅ `10:46:56` Reserved name 'panel' rejected with 400  
✅ `10:46:56` Reserved name 'auth' rejected with 400  
✅ `10:46:56` Invalid UUID rejected with 400  

## Delete site

✅ `10:46:56` Site deletion returned ok: true  

## Verify site removed

✅ `10:46:56` Deleted site no longer in listing  
✅ `10:46:56` Deleted site returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

