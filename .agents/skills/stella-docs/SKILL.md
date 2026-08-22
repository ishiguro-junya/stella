---
name: stella-docs
description: Create or update only Stella documentation, documentation lint configuration, skills, role-agent definitions, or agent-product integration. Do not use for runtime behavior or publishing.
---

# Stella Docs

Treat implementation and configuration as authoritative, and make the smallest non-duplicative documentation change.  

## Update the authoritative source

Check Git state before work and preserve existing changes.  
Read the [writing workflow](../../references/workflows/writing.md), then load only the specification or workflow references relevant to the task.  
Integrate each fact into its existing authoritative source instead of duplicating it.  
Leave facts directly discoverable from the environment, configuration, or commands in those sources.  
Ask the user before creating a new source only when an ongoing responsibility fits nowhere existing.  

For skills, keep automatic routing distinct through the name and description, with details in shared references.  
Disable automatic selection for explicit-only skills.  
Keep product-specific role-agent definitions thin and point them to `.agents/references/roles/`.  

## Validate

For ordinary Markdown-only changes, run `mise run lint:docs` to check formatting, prose, and links.  
After changing a skill or product-specific role-agent definition, parse its YAML frontmatter and YAML files.  
Run `mise run lint` once after changing these definitions, documentation lint configuration, or agent integration.  
After moves or renames, verify that no references to old paths or names remain.  
Skip application tests and builds unless runtime semantics changed.  

Stage, commit, push, or open a pull request only when the request includes that operation.  
