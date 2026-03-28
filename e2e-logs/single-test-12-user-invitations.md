# Portlama E2E: 12 — User Invitations

> Started at `2026-03-28 16:08:43 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `16:08:43` Invitation creation returned ok: true  
✅ `16:08:43` Invitation username matches  
✅ `16:08:43` Invitation email matches  
✅ `16:08:43` Invitation token is valid 64-char hex  
✅ `16:08:43` Invitation ID is present  
✅ `16:08:43` Invitation createdAt is present  
✅ `16:08:43` Invitation expiresAt is present  

## List invitations

✅ `16:08:43` Invitation appears in GET /api/invitations  
✅ `16:08:43` Token is not exposed in invitation list  
✅ `16:08:43` Invitation status is pending  

## Duplicate invitation

✅ `16:08:43` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `16:08:44` Incomplete invitation data rejected (HTTP 400)  
✅ `16:08:44` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `16:08:44` Public invite details show username  
✅ `16:08:44` Public invite details show email  
✅ `16:08:44` Public invite details show expiresAt  

## Invalid token

✅ `16:08:44` Accept with invalid token returns 404  
✅ `16:08:44` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `16:08:46` Invitation acceptance returned ok: true  
✅ `16:08:46` Accepted username matches  

## Verify invited user exists

✅ `16:08:46` Invited user appears in GET /api/users  
✅ `16:08:46` Invited user email matches  

## Invitation marked as accepted

✅ `16:08:46` Invitation status changed to accepted  

## Used token rejection

✅ `16:08:46` Reusing accepted token returns 410 Gone  
✅ `16:08:46` GET on used token returns 410 Gone  

## Accept with short password

✅ `16:08:46` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `16:08:48` Invited user deletion returned ok: true  
✅ `16:08:48` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

