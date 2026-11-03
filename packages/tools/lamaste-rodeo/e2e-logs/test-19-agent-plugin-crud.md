# Lamaste E2E: 19 — Agent Plugin CRUD

> Started at `2026-11-03 09:31:28 UTC`


## Pre-flight: check onboarding is complete

✅ `09:31:28` Onboarding is complete  

## Start agent panel service

✅ `09:31:29` lamaste-agentd is installed on the agent VM  
✅ `09:31:30` Agent panel started on port 9393  

## GET /plugins — empty list

✅ `09:31:30` Plugin list is initially empty  

## Install validation — missing body

✅ `09:31:30` Install without packageName returns 400  

## Install validation — non-lamalibre scope

✅ `09:31:30` Install with non-@lamalibre/ scope returns 400  

## Plugin name validation — reserved names

✅ `09:31:30` Reserved name 'plugins' rejected  
✅ `09:31:30` Reserved name 'agents' rejected  

## Plugin name validation — invalid characters

✅ `09:31:30` Name with dots rejected  
✅ `09:31:30` Name with slashes rejected  
✅ `09:31:31` Uppercase name rejected  

## Operations on nonexistent plugin

✅ `09:31:31` Enable nonexistent plugin returns 400  
✅ `09:31:31` Disable nonexistent plugin returns 400  
✅ `09:31:31` Delete nonexistent plugin returns 400  

## Check-update and bundle for nonexistent plugin

✅ `09:31:31` Check-update nonexistent returns 400  
✅ `09:31:31` Bundle nonexistent returns 404  

## Auth validation — requests without credentials

✅ `09:31:31` Request without credentials returns 401  
✅ `09:31:31` Health endpoint accessible without auth  

## Auth validation — forged certificate headers

✅ `09:31:32` Forged agent certificate headers are refused (401)  
✅ `09:31:32` Forged admin certificate headers are refused (401)  
✅ `09:31:32` Percent-escaped /api path without credentials is refused (401)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

