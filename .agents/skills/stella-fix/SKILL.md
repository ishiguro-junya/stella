---
name: stella-fix
description: Diagnose Stella bugs, regressions, or failures and restore existing behavior. Do not use for new user-visible behavior, documentation-only work, or publishing.
---

# Stella Fix

Restore existing behavior by fixing the root cause once at the shared boundary.  

## Establish the cause and boundary

Check Git state before work and preserve existing changes.  
Read the [product specification](../../references/specifications/product.md) and implementation related to the symptom to establish expected behavior.  
Load [design](../../references/specifications/design.md), [architecture](../../references/specifications/architecture.md), or [security](../../references/specifications/security.md) only when the issue concerns that boundary.  

Use [debugger](../../references/roles/debugger.md) only while the cause is unknown.  
Trace callers and sibling paths to establish the root cause, impact, and regression test.  
If resolution requires new behavior or a product decision, stop before editing and return the decision to the user.  

## Repair and validate

Have [developer](../../references/roles/developer.md) confirm a failing regression test, apply the minimum shared-boundary fix, and synchronize affected documentation.  
Use [tester](../../references/roles/tester.md) only when manual, native, or visual validation is required.  
When using two or more roles, another session, or another worktree, follow the multi-role handoff procedure in [review](../../references/workflows/review.md).  
Run only unverified layers from [testing](../../references/workflows/testing.md), then have [reviewer](../../references/roles/reviewer.md) reconcile the regression, related paths, evidence, and documentation.  

Stage, commit, push, open a pull request, or release only when the request includes that operation.  
