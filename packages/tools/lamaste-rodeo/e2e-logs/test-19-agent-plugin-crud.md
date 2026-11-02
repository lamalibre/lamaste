# Lamaste E2E: 19 — Agent Plugin CRUD

> Started at `2026-11-02 15:51:42 UTC`


## Pre-flight: check onboarding is complete

✅ `15:51:42` Onboarding is complete  

## Start agent panel service

✅ `15:51:43` lamaste-agentd is installed on the agent VM  
✅ `15:51:44` Agent panel started on port 9393  

## GET /plugins — empty list

✅ `15:51:44` Plugin list is initially empty  

## Install validation — missing body

✅ `15:51:44` Install without packageName returns 400  

## Install validation — non-lamalibre scope

✅ `15:51:44` Install with non-@lamalibre/ scope returns 400  

## Plugin name validation — reserved names

✅ `15:51:44` Reserved name 'plugins' rejected  
✅ `15:51:44` Reserved name 'agents' rejected  

## Plugin name validation — invalid characters

✅ `15:51:44` Name with dots rejected  
✅ `15:51:44` Name with slashes rejected  
✅ `15:51:45` Uppercase name rejected  

## Operations on nonexistent plugin

✅ `15:51:45` Enable nonexistent plugin returns 400  
✅ `15:51:45` Disable nonexistent plugin returns 400  
✅ `15:51:45` Delete nonexistent plugin returns 400  

## Check-update and bundle for nonexistent plugin

✅ `15:51:45` Check-update nonexistent returns 400  
✅ `15:51:45` Bundle nonexistent returns 404  

## Auth validation — requests without credentials

✅ `15:51:45` Request without credentials returns 401  
✅ `15:51:45` Health endpoint accessible without auth  

## Auth validation — forged certificate headers

✅ `15:51:46` Forged agent certificate headers are refused (401)  
✅ `15:51:46` Forged admin certificate headers are refused (401)  
✅ `15:51:46` Percent-escaped /api path without credentials is refused (401)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

