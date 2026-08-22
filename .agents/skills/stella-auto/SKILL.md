---
name: stella-auto
description: Coordinate Stella development across multiple routes or roles only when the user explicitly names stella-auto.
disable-model-invocation: true
---

# Stella Auto

Use this skill only when the user explicitly names it.  
Coordinate work that spans multiple routes or roles.  

## Select routes

- Use [stella-feature](../stella-feature/SKILL.md) for features or specification changes.
- Use [stella-fix](../stella-fix/SKILL.md) to restore existing behavior.
- Use [stella-docs](../stella-docs/SKILL.md) for documentation and agent-definition changes only.

Load only the applicable routes and follow their completion criteria.  
Use [stella-release](../stella-release/SKILL.md) only when the user also explicitly names `stella-release`.  

## Coordinate the work

Check Git state and requested external actions before work, preserving existing changes.  
Assign one implementation and evidence owner to each acceptance criterion.  
When using two or more roles, another session, or another worktree, follow the multi-role handoff procedure in [review](../../references/workflows/review.md).  
Never run multiple writers in the same worktree concurrently.  
After a failure, return only to the role responsible for its cause; do not repeat completed stages or commands.  
Finish with a [reviewer](../../references/roles/reviewer.md) reconciliation of acceptance criteria, evidence, and documentation.  

Stage, commit, push, open a pull request, or release only when the request includes that operation.  
The main agent conducts a retrospective from current evidence only when the user explicitly requests one.  
