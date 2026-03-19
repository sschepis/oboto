/**
 * Review prompt builders — constructs AI prompts for code review and commit messages.
 */

// ── Shared review instructions ──────────────────────────────

const REVIEW_GUIDELINES = `## Review Guidelines
- Focus on: bugs, logic errors, security issues, performance problems, and code style
- For each issue found, classify severity as: CRITICAL, WARNING, or SUGGESTION
- Only report issues you are confident about (CRITICAL: 95%+, WARNING: 85%+, SUGGESTION: 75%+)
- Do NOT report issues that are matters of personal preference
- Consider the context of changes — don't flag pre-existing issues unless they interact with new code`;

const REVIEW_OUTPUT_FORMAT = `## Output Format
Provide your review in this structure:

### Summary
Brief overview of the changes.

### Issues Found
| # | Severity | File | Line | Description |
|---|----------|------|------|-------------|
(table of issues, or "None" if clean)

### Detailed Findings
For each issue:
#### Issue N: [Title]
- **Severity**: CRITICAL/WARNING/SUGGESTION
- **File**: \`path/to/file\`
- **Line**: N
- **Description**: What's wrong
- **Suggestion**: How to fix it

### Recommendation
APPROVE / APPROVE WITH SUGGESTIONS / NEEDS CHANGES

(If no issues: "LGTM — No significant issues found. The changes look clean.")`;

/**
 * Format parsed diff files into a human-readable diff section for the prompt.
 * @param {{ files: import('./diff-parser.mjs').DiffFile[] }} diffResult
 * @returns {string}
 */
function formatDiffForPrompt(diffResult) {
  if (!diffResult.files || diffResult.files.length === 0) {
    return '(no file changes)';
  }

  const parts = [];
  parts.push(`**Files changed: ${diffResult.files.length}**\n`);

  for (const file of diffResult.files) {
    const statusLabel = {
      added: '(new file)',
      deleted: '(deleted)',
      renamed: `(renamed from ${file.oldPath || '?'})`,
      modified: '(modified)',
    }[file.status] || '';

    parts.push(`### \`${file.path}\` ${statusLabel}`);

    if (file.hunks.length === 0) {
      parts.push('(no hunks — metadata-only change)\n');
      continue;
    }

    for (const hunk of file.hunks) {
      parts.push('```diff');
      parts.push(hunk.content.trimEnd());
      parts.push('```');
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Build the review prompt for uncommitted changes.
 * @param {Object} diffResult — parsed diff from parseDiff()
 * @param {Object} options — { branch, status }
 * @returns {string}
 */
export function buildUncommittedReviewPrompt(diffResult, options = {}) {
  const { branch = 'unknown', status = '' } = options;

  return `You are performing a code review of **uncommitted changes** (staged + unstaged).

**Branch**: \`${branch}\`

${status ? `**Git status**:\n\`\`\`\n${status}\n\`\`\`\n` : ''}
${REVIEW_GUIDELINES}

${REVIEW_OUTPUT_FORMAT}

---

## Diff to Review

${formatDiffForPrompt(diffResult)}`;
}

/**
 * Build the review prompt for branch comparison.
 * @param {Object} diffResult — parsed diff
 * @param {Object} options — { currentBranch, baseBranch }
 * @returns {string}
 */
export function buildBranchReviewPrompt(diffResult, options = {}) {
  const { currentBranch = 'unknown', baseBranch = 'main' } = options;

  return `You are performing a code review of all changes on branch \`${currentBranch}\` compared to \`${baseBranch}\`.

This represents the complete set of changes that would be merged.

${REVIEW_GUIDELINES}

${REVIEW_OUTPUT_FORMAT}

---

## Diff to Review (\`${currentBranch}\` vs \`${baseBranch}\`)

${formatDiffForPrompt(diffResult)}`;
}

/**
 * Build the review prompt for a specific commit.
 * @param {Object} diffResult — parsed diff
 * @param {string} commitHash — the commit being reviewed
 * @returns {string}
 */
export function buildCommitReviewPrompt(diffResult, commitHash) {
  return `You are performing a code review of commit \`${commitHash}\`.

${REVIEW_GUIDELINES}

${REVIEW_OUTPUT_FORMAT}

---

## Diff to Review (commit \`${commitHash}\`)

${formatDiffForPrompt(diffResult)}`;
}

/**
 * Build the commit message generation prompt.
 * @param {string} diff — staged changes diff (raw)
 * @param {Object} options — { branch, recentCommits, include_body, note }
 * @returns {string}
 */
export function buildCommitMessagePrompt(diff, options = {}) {
  const {
    branch = 'unknown',
    recentCommits = [],
    include_body = false,
    note = '',
  } = options;

  const recentSection = recentCommits.length > 0
    ? `## Recent Commits (for style/context reference)\n${recentCommits.map(c => `- ${c}`).join('\n')}\n`
    : '';

  const bodyInstruction = include_body
    ? `Include a detailed body after a blank line explaining **what** changed and **why**.`
    : `Provide ONLY the subject line (no body). Keep it under 72 characters.`;

  return `Generate a git commit message for the following staged changes.

## Conventions
- Use **Conventional Commits** format: \`type(scope): description\`
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Scope is optional but encouraged when changes are localized to a module/component
- Subject line: imperative mood, lowercase, no period at end
- ${bodyInstruction}

**Branch**: \`${branch}\`
${note ? `\n**Note**: ${note}\n` : ''}
${recentSection}

## Diff

\`\`\`diff
${diff}
\`\`\`

Respond with ONLY the commit message — no explanations, no markdown fences, no quotes.`;
}
