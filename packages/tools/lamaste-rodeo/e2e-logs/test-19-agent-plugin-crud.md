# Lamaste E2E: 19 — Agent Plugin CRUD

> Started at `2026-11-04 13:36:18 UTC`


## Pre-flight: check onboarding is complete

✅ `13:36:18` Onboarding is complete  

## Start agent panel service

✅ `13:36:18` lamaste-agentd is installed on the agent VM  
✅ `13:36:20` Agent panel started on port 9393  

## GET /plugins — empty list

✅ `13:36:21` Plugin list is initially empty  

## Install validation — missing body

✅ `13:36:21` Install without packageName returns 400  

## Install validation — non-lamalibre scope

✅ `13:36:21` Install with non-@lamalibre/ scope returns 400  

## Plugin name validation — reserved names

✅ `13:36:21` Reserved name 'plugins' rejected  
✅ `13:36:21` Reserved name 'agents' rejected  

## Plugin name validation — invalid characters

✅ `13:36:21` Name with dots rejected  
✅ `13:36:22` Name with slashes rejected  
✅ `13:36:22` Uppercase name rejected  

## Operations on nonexistent plugin

✅ `13:36:22` Enable nonexistent plugin returns 400  
✅ `13:36:22` Disable nonexistent plugin returns 400  
✅ `13:36:22` Delete nonexistent plugin returns 400  

## Check-update and bundle for nonexistent plugin

✅ `13:36:22` Check-update nonexistent returns 400  
✅ `13:36:23` Bundle nonexistent returns 404  

## Auth validation — requests without credentials

✅ `13:36:23` Request without credentials returns 401  
✅ `13:36:23` Health endpoint accessible without auth  

## Auth validation — forged certificate headers

✅ `13:36:23` Forged agent certificate headers are refused (401)  
✅ `13:36:23` Forged admin certificate headers are refused (401)  
✅ `13:36:23` Percent-escaped /api path without credentials is refused (401)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

