---
name: stella-feature
description: Add or change Stella features, user-visible behavior, UI/UX, safety, dependencies, or external interfaces. Do not use for restoring existing behavior, documentation-only work, or publishing.
---

# Stella Feature

Implement new behavior with only the roles and validation it requires.  

## Define the specification

Check Git state before work and preserve existing changes.  
Read only the authoritative sources relevant to the task.  

- Use the [product specification](../../references/specifications/product.md) for user-visible behavior.
- Use [design](../../references/specifications/design.md) for appearance, interactions, and accessibility.
- Use [architecture](../../references/specifications/architecture.md) for internal boundaries, state ownership, and persistence.
- Use [security](../../references/specifications/security.md) for trust boundaries, safety guarantees, and dependencies.

Define acceptance criteria, exclusions, security impact, and validation ownership.  
Ask the user only for decisions that change meaning.  

## Use only required roles

- Use [planner](../../references/roles/planner.md) for product decisions, multiple domains, safety, compatibility, migration, dependencies, or external interfaces.
- Use [designer](../../references/roles/designer.md) for appearance, information architecture, interactions, state design, or accessibility.
- Use [debugger](../../references/roles/debugger.md) for failures with an unknown cause.
- Use [developer](../../references/roles/developer.md) to change code, tests, or related documentation.
- Use [tester](../../references/roles/tester.md) when manual, native, or visual validation is required.
- Use [reviewer](../../references/roles/reviewer.md) for the final implementation audit and reconciliation.

When using two or more roles, another session, or another worktree, follow the multi-role handoff procedure in [review](../../references/workflows/review.md).  
Never run multiple writers in the same worktree concurrently.  

## Implement and validate

For each acceptance criterion, start with a failing check close to the change and add the minimum implementation.  
Synchronize changed facts to the correct authoritative source in the same change.  
Run each required check from [testing](../../references/workflows/testing.md) once, then obtain the reviewer's verdict.  
Do not repeat validation after collecting the required evidence.  

Stage, commit, push, open a pull request, or release only when the request includes that operation.  
