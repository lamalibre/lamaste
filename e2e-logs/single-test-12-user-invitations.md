# Portlama E2E: 12 — User Invitations

> Started at `2026-03-23 12:09:38 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `12:09:39` Invitation creation returned ok: true  
✅ `12:09:39` Invitation username matches  
✅ `12:09:39` Invitation email matches  
✅ `12:09:39` Invitation token is valid 64-char hex  
✅ `12:09:39` Invitation ID is present  
✅ `12:09:39` Invitation createdAt is present  
✅ `12:09:39` Invitation expiresAt is present  

## List invitations

✅ `12:09:39` Invitation appears in GET /api/invitations  
✅ `12:09:39` Token is not exposed in invitation list  
✅ `12:09:39` Invitation status is pending  

## Duplicate invitation

✅ `12:09:39` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `12:09:39` Incomplete invitation data rejected (HTTP 400)  
✅ `12:09:39` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `12:09:39` Public invite details show username  
✅ `12:09:39` Public invite details show email  
✅ `12:09:39` Public invite details show expiresAt  

## Invalid token

✅ `12:09:39` Accept with invalid token returns 404  
✅ `12:09:39` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `12:09:41` Invitation acceptance returned ok: true  
✅ `12:09:41` Accepted username matches  

## Verify invited user exists

✅ `12:09:41` Invited user appears in GET /api/users  
✅ `12:09:41` Invited user email matches  

## Invitation marked as accepted

✅ `12:09:41` Invitation status changed to accepted  

## Used token rejection

✅ `12:09:41` Reusing accepted token returns 410 Gone  
✅ `12:09:41` GET on used token returns 410 Gone  

## Accept with short password

✅ `12:09:41` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `12:09:43` Invited user deletion returned ok: true  
✅ `12:09:43` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

