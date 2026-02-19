# Skills System

The **Skills System** in Robodev allows the agent to learn and utilize specialized capabilities defined in markdown files. This provides a flexible way to extend the agent's knowledge and toolset without modifying the core codebase.

## 1. Concept

A "Skill" is a self-contained module that defines:
1.  **Metadata**: Name, description, version, author.
2.  **Capabilities**: List of functional capabilities (e.g., `math-evaluation`, `fact-retrieval`).
3.  **Instructions**: Detailed guidelines on how to act when performing tasks related to this skill.
4.  **Tools**: References to specific tools the skill uses.

Skills are stored as markdown files with YAML frontmatter.

## 2. Directory Structure

Skills can be defined in two locations:
1.  **Global Skills**: `skills/` (in the application root). Available to all projects.
2.  **Workspace Skills**: `.skills/` (in the current workspace root). Specific to the current project.

## 3. Skill Definition Format (`SKILL.md`)

A skill file uses the following format:

```markdown
---
id: my-skill-id
name: My Skill Name
version: 1.0.0
description: A short description of what the skill does.
author: Author Name
capabilities:
  - capability-1
  - capability-2
---

# Skill Name

Detailed instructions for the agent.

## Capabilities
Explanation of what the skill can do.

## Tools
List of tools relevant to this skill and how to use them.

## Strategy
Step-by-step strategy for solving problems in this domain.
```

## 4. Usage

The `SkillsManager` (`src/skills/skills-manager.mjs`) is responsible for:
1.  **Discovery**: Scanning the global and workspace directories for `SKILL.md` files.
2.  **Parsing**: Extracting metadata and content.
3.  **Context Injection**: Summarizing available skills in the system prompt.

The agent can use the following tools to interact with skills:
*   `list_skills`: See all available skills.
*   `read_skill`: Read the full instructions for a specific skill.
*   `use_skill`: Explicitly activate a skill for a task.

## 5. Example: Computational Knowledge

The `computational-knowledge` skill (in `skills/computational-knowledge/SKILL.md`) transforms the agent into a Wolfram Alpha-like engine capable of precise math and fact retrieval, utilizing tools like `evaluate_math` and `unit_conversion`.
