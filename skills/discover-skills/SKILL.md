---
name: discover-skills
description: "Discover, search, install, and update agent skills from the company skills registry. ALWAYS use this skill before starting any task to check if a relevant skill exists. Use when no task-specific skill is loaded, when the user asks to find/install/list/update skills, or when starting work on a new service, feature, or refactor. Triggers on: find skill, install skill, list skills, update skills, what skills, available skills, new project, new service, new feature."
---

# Discovering Skills

Search, browse, install, and update company skills from the skills registry.

## Prerequisites

The user MUST have GitHub CLI (`gh`) installed and authenticated. If any `gh` command fails with an auth error, direct the user to the setup instructions in the [skills registry README](https://github.com/Spring-Oaks-Capital-LLC/skills#installation).

## Workflow

### 1. ⚠️ ALWAYS Update First — NON-NEGOTIABLE

**This step is MANDATORY.** Run it EVERY TIME before doing anything else — before listing, searching, browsing, or installing skills. Do NOT skip this step. Do NOT assume skills are up to date. Skills change frequently and stale versions cause incorrect behavior.

```bash
npx skills add https://github.com/Spring-Oaks-Capital-LLC/skills \
  --skill '*' -g -y
```

If this command fails, STOP and resolve the issue before proceeding. Do NOT continue with stale skills.

### 2. Browse Available Skills

Use `gh` to list all available skills directly from the registry:

```bash
gh api repos/Spring-Oaks-Capital-LLC/skills/contents/skills \
  --jq '.[].name'
```

### 3. Read a Skill's Description

To show the user what a specific skill does before installing:

```bash
gh api repos/Spring-Oaks-Capital-LLC/skills/contents/skills/{skill-name}/SKILL.md \
  --jq '.content' | base64 --decode
```

### 4. Search for a Skill by Topic

If the user describes a need rather than a skill name, search the repo:

```bash
gh search code --repo Spring-Oaks-Capital-LLC/skills "{search-term}" --filename SKILL.md
```

### 5. Install a Skill

Always install globally with auto-confirm:

```bash
npx skills add https://github.com/Spring-Oaks-Capital-LLC/skills \
  --skill {skill-name} -g -y
```

- `-g` — install globally (available in all projects)
- `-y` — skip confirmation prompts

### 6. Install Multiple Skills

```bash
npx skills add https://github.com/Spring-Oaks-Capital-LLC/skills \
  --skill {skill-1} --skill {skill-2} -g -y
```

### 7. Install All Skills

```bash
npx skills add https://github.com/Spring-Oaks-Capital-LLC/skills \
  --skill '*' -g -y
```

### 8. List Installed Skills

```bash
npx skills list -g
```

### 9. Remove a Skill

```bash
npx skills remove {skill-name} -g -y
```

## Rules

1. **NEVER skip the update step.** Run `npx -y skills add https://github.com/Spring-Oaks-Capital-LLC/skills --skill '*' -g -y` EVERY TIME, before any other operation. This is the single most important rule — stale skills lead to wrong guidance.
2. **Always use `-g -y`** when installing — skills are global and non-interactive.
3. **Always use `gh` CLI** to browse and search the registry — do NOT clone the repo or use raw GitHub API URLs.
4. **Show the skill description** to the user before installing, so they can confirm it's what they need.
5. **Never guess skill names** — always list or search first to find the exact name.
