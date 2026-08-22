---
name: stella-release
description: Publish verified Stella changes within the authorized scope only when the user explicitly names stella-release.
disable-model-invocation: true
---

# Stella Release

Use this skill only when the user explicitly names it.  
The main agent performs only authorized release operations.  
Requests such as "release it" that omit the skill name must not invoke it.  

## Fix the release scope

Read [release](../../references/workflows/release.md), [security](../../references/specifications/security.md), and [testing](../../references/workflows/testing.md).  
Confirm the user's authorized scope for staging, commits, pushes, tags, GitHub Releases, and distribution updates per operation.  
Invoking this skill does not authorize external writes or unspecified operations.  

Before publishing, verify the target commit, Git state, required checks, signatures, existing tags, and artifacts.  
Do not publish with check errors, network failures, expired exceptions, unresolved findings, or new tracked-file changes.  

## Publish and verify

Perform only authorized operations in the release procedure's order.  
Never force operations, skip validation, or overwrite existing tags or artifacts.  
After creation, reread external state to verify tags, GitHub Releases, artifacts, update metadata, and distribution targets.  
Stop and return to the user when an unauthorized operation, new permission, or external decision is required.  
