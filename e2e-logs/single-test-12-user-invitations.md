# Portlama E2E: 12 — User Invitations

> Started at `2026-03-29 09:08:31 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `09:08:31` Invitation creation returned ok: true  
✅ `09:08:31` Invitation username matches  
✅ `09:08:31` Invitation email matches  
✅ `09:08:31` Invitation token is valid 64-char hex  
✅ `09:08:31` Invitation ID is present  
✅ `09:08:31` Invitation createdAt is present  
✅ `09:08:31` Invitation expiresAt is present  

## List invitations

✅ `09:08:31` Invitation appears in GET /api/invitations  
✅ `09:08:31` Token is not exposed in invitation list  
✅ `09:08:31` Invitation status is pending  

## Duplicate invitation

✅ `09:08:31` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `09:08:31` Incomplete invitation data rejected (HTTP 400)  
✅ `09:08:31` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `09:08:31` Public invite details show username  
✅ `09:08:31` Public invite details show email  
✅ `09:08:31` Public invite details show expiresAt  

## Invalid token

✅ `09:08:31` Accept with invalid token returns 404  
✅ `09:08:31` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `09:08:33` Invitation acceptance returned ok: true  
✅ `09:08:33` Accepted username matches  

## Verify invited user exists

✅ `09:08:33` Invited user appears in GET /api/users  
✅ `09:08:33` Invited user email matches  

## Invitation marked as accepted

✅ `09:08:33` Invitation status changed to accepted  

## Used token rejection

✅ `09:08:33` Reusing accepted token returns 410 Gone  
✅ `09:08:33` GET on used token returns 410 Gone  

## Accept with short password

✅ `09:08:33` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `09:08:35` Invited user deletion returned ok: true  
✅ `09:08:35` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

