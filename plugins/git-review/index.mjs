import { parseDiff } from './lib/diff-parser.mjs';
import * as git from './lib/git-utils.mjs';
import * as prompts from './lib/review-prompt.mjs';

export async function activate(api) {
  // ── Tool: review_uncommitted ──────────────────────────────
  api.tools.register({
    name: 'review_uncommitted',
    useOriginalName: true,
    description:
      'Review all uncommitted changes (staged + unstaged) in the current git repository. Provides AI-powered code review with severity ratings.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const cwd = api.workingDir;
      if (!git.isGitRepo(cwd)) {
        return { error: 'Not a git repository' };
      }

      const rawDiff = git.getUncommittedDiff(cwd);
      if (!rawDiff.trim()) {
        return { message: 'No uncommitted changes found.' };
      }

      const diffResult = parseDiff(rawDiff);
      const status = git.getGitStatus(cwd);
      const branch = git.getCurrentBranch(cwd);

      const prompt = prompts.buildUncommittedReviewPrompt(diffResult, {
        branch,
        status,
      });

      const review = await api.ai.ask(prompt);

      api.events.emit('review-completed', {
        type: 'uncommitted',
        filesReviewed: diffResult.files.length,
        branch,
      });

      return review;
    },
  });

  // ── Tool: review_branch ───────────────────────────────────
  api.tools.register({
    name: 'review_branch',
    useOriginalName: true,
    description:
      'Review all changes on the current branch compared to the base branch (main/master/develop). Performs AI-powered code review.',
    parameters: {
      type: 'object',
      properties: {
        base_branch: {
          type: 'string',
          description:
            'Base branch to compare against (auto-detected if not specified: main > master > dev > develop)',
        },
      },
      required: [],
    },
    handler: async ({ base_branch } = {}) => {
      const cwd = api.workingDir;
      if (!git.isGitRepo(cwd)) {
        return { error: 'Not a git repository' };
      }

      const currentBranch = git.getCurrentBranch(cwd);
      const baseBranch = base_branch || git.getBaseBranch(cwd);

      if (!baseBranch) {
        return {
          error:
            'Could not detect base branch. Please specify base_branch parameter.',
        };
      }

      if (currentBranch === baseBranch) {
        return {
          message: `Already on the base branch (${baseBranch}). Nothing to review.`,
        };
      }

      const rawDiff = git.getBranchDiff(cwd, baseBranch);
      if (!rawDiff.trim()) {
        return {
          message: `No differences found between ${currentBranch} and ${baseBranch}.`,
        };
      }

      const diffResult = parseDiff(rawDiff);
      const prompt = prompts.buildBranchReviewPrompt(diffResult, {
        currentBranch,
        baseBranch,
      });

      const review = await api.ai.ask(prompt);

      api.events.emit('review-completed', {
        type: 'branch',
        filesReviewed: diffResult.files.length,
        currentBranch,
        baseBranch,
      });

      return review;
    },
  });

  // ── Tool: review_commit ───────────────────────────────────
  api.tools.register({
    name: 'review_commit',
    useOriginalName: true,
    description:
      'Review a specific git commit by its hash. Provides AI-powered code review of the changes in that commit.',
    parameters: {
      type: 'object',
      properties: {
        commit_hash: {
          type: 'string',
          description:
            'The git commit hash to review (full or abbreviated)',
        },
      },
      required: ['commit_hash'],
    },
    handler: async ({ commit_hash }) => {
      const cwd = api.workingDir;
      if (!git.isGitRepo(cwd)) {
        return { error: 'Not a git repository' };
      }

      const rawDiff = git.getCommitDiff(cwd, commit_hash);
      if (!rawDiff.trim()) {
        return {
          error: `No diff found for commit ${commit_hash}. Check that the hash is valid.`,
        };
      }

      const diffResult = parseDiff(rawDiff);
      const prompt = prompts.buildCommitReviewPrompt(diffResult, commit_hash);

      const review = await api.ai.ask(prompt);

      api.events.emit('review-completed', {
        type: 'commit',
        filesReviewed: diffResult.files.length,
        commitHash: commit_hash,
      });

      return review;
    },
  });

  // ── Tool: git_diff ────────────────────────────────────────
  api.tools.register({
    name: 'git_diff',
    useOriginalName: true,
    description:
      'Get a structured or raw git diff. Returns parsed diff information including files changed, hunks, and line counts.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['uncommitted', 'staged', 'branch', 'commit'],
          description: 'Type of diff to get',
        },
        ref: {
          type: 'string',
          description:
            'Branch name (for branch mode) or commit hash (for commit mode)',
        },
        raw: {
          type: 'boolean',
          description:
            'Return raw unified diff text instead of parsed structure (default: false)',
        },
      },
      required: ['mode'],
    },
    handler: async ({ mode, ref, raw = false }) => {
      const cwd = api.workingDir;
      if (!git.isGitRepo(cwd)) {
        return { error: 'Not a git repository' };
      }

      let rawDiff;
      switch (mode) {
        case 'uncommitted':
          rawDiff = git.getUncommittedDiff(cwd);
          break;
        case 'staged':
          rawDiff = git.getStagedDiff(cwd);
          break;
        case 'branch': {
          const baseBranch = ref || git.getBaseBranch(cwd);
          if (!baseBranch) {
            return {
              error: 'Could not detect base branch. Specify ref parameter.',
            };
          }
          rawDiff = git.getBranchDiff(cwd, baseBranch);
          break;
        }
        case 'commit':
          if (!ref)
            return {
              error: 'commit_hash (ref) is required for commit mode',
            };
          rawDiff = git.getCommitDiff(cwd, ref);
          break;
        default:
          return { error: `Unknown mode: ${mode}` };
      }

      if (!rawDiff.trim()) {
        return { message: 'No changes found.', files: [], raw: '' };
      }

      if (raw) {
        return rawDiff;
      }

      const diffResult = parseDiff(rawDiff);
      return {
        filesChanged: diffResult.files.length,
        files: diffResult.files.map((f) => ({
          path: f.path,
          status: f.status,
          hunks: f.hunks.length,
          oldPath: f.oldPath || undefined,
        })),
        raw: rawDiff,
      };
    },
  });

  // ── Tool: generate_commit_message ─────────────────────────
  api.tools.register({
    name: 'generate_commit_message',
    useOriginalName: true,
    description:
      'Generate a conventional commit message based on the currently staged git changes. Uses AI to analyze the diff and produce a descriptive commit message.',
    parameters: {
      type: 'object',
      properties: {
        include_body: {
          type: 'boolean',
          description:
            'Include a detailed body in addition to the subject line (default: false)',
        },
      },
      required: [],
    },
    handler: async ({ include_body = false } = {}) => {
      const cwd = api.workingDir;
      if (!git.isGitRepo(cwd)) {
        return { error: 'Not a git repository' };
      }

      const stagedDiff = git.getStagedDiff(cwd);
      if (!stagedDiff.trim()) {
        // Fall back to all uncommitted changes
        const allDiff = git.getUncommittedDiff(cwd);
        if (!allDiff.trim()) {
          return {
            error: 'No changes found to generate a commit message for.',
          };
        }
        const branch = git.getCurrentBranch(cwd);
        const recentCommits = git.getRecentCommits(cwd, 5);
        const prompt = prompts.buildCommitMessagePrompt(allDiff, {
          branch,
          recentCommits,
          include_body,
          note: 'Note: These changes are NOT staged yet. The message should reflect what would be committed if all changes were staged.',
        });
        const message = await api.ai.ask(prompt);
        return {
          message: message.trim(),
          staged: false,
          note: 'Based on uncommitted changes (nothing is staged)',
        };
      }

      const branch = git.getCurrentBranch(cwd);
      const recentCommits = git.getRecentCommits(cwd, 5);
      const prompt = prompts.buildCommitMessagePrompt(stagedDiff, {
        branch,
        recentCommits,
        include_body,
      });
      const message = await api.ai.ask(prompt);

      api.events.emit('commit-message-generated', { branch });

      return { message: message.trim(), staged: true };
    },
  });

  // ── Tool: git_status_summary ──────────────────────────────
  api.tools.register({
    name: 'git_status_summary',
    useOriginalName: true,
    description:
      'Get a summary of the current git repository state — branch, status, recent commits.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const cwd = api.workingDir;
      if (!git.isGitRepo(cwd)) {
        return { error: 'Not a git repository' };
      }

      return {
        branch: git.getCurrentBranch(cwd),
        baseBranch: git.getBaseBranch(cwd),
        status: git.getGitStatus(cwd),
        recentCommits: git.getRecentCommits(cwd, 10),
      };
    },
  });

  // ── WS Handlers for UI integration ────────────────────────
  api.ws.register('review-uncommitted', async (_data, ctx) => {
    const cwd = api.workingDir;
    try {
      if (!git.isGitRepo(cwd)) {
        ctx.ws.send(
          JSON.stringify({
            type: 'plugin:git-review:error',
            payload: { error: 'Not a git repository' },
          })
        );
        return;
      }
      const rawDiff = git.getUncommittedDiff(cwd);
      const diffResult = parseDiff(rawDiff);
      const status = git.getGitStatus(cwd);
      const branch = git.getCurrentBranch(cwd);

      ctx.ws.send(
        JSON.stringify({
          type: 'plugin:git-review:diff-result',
          payload: {
            mode: 'uncommitted',
            branch,
            status,
            files: diffResult.files,
            raw: rawDiff,
          },
        })
      );
    } catch (err) {
      ctx.ws.send(
        JSON.stringify({
          type: 'plugin:git-review:error',
          payload: { error: err.message },
        })
      );
    }
  });

  api.ws.register('git-status', async (_data, ctx) => {
    const cwd = api.workingDir;
    try {
      ctx.ws.send(
        JSON.stringify({
          type: 'plugin:git-review:status',
          payload: {
            isRepo: git.isGitRepo(cwd),
            branch: git.getCurrentBranch(cwd),
            baseBranch: git.getBaseBranch(cwd),
            status: git.getGitStatus(cwd),
            recentCommits: git.getRecentCommits(cwd, 5),
          },
        })
      );
    } catch (err) {
      ctx.ws.send(
        JSON.stringify({
          type: 'plugin:git-review:error',
          payload: { error: err.message },
        })
      );
    }
  });
}

export async function deactivate(_api) {
  // All tools, WS handlers, and event listeners are auto-cleaned by the plugin system
}
