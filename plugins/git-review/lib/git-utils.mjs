import { execSync, execFileSync } from 'node:child_process';

/** Default exec options for all git commands */
const EXEC_OPTS = (cwd) => ({
  cwd,
  encoding: 'utf-8',
  maxBuffer: 10 * 1024 * 1024, // 10 MB for large diffs
  stdio: ['pipe', 'pipe', 'pipe'],
});

/**
 * Sanitize a git ref (branch name, tag, or commit hash) to prevent shell injection.
 * Allows alphanumeric, `-`, `_`, `.`, `/`, `~`, `^`, and `@{` for valid git refspecs.
 * @param {string} ref
 * @returns {string}
 */
function sanitizeRef(ref) {
  return ref.replace(/[^a-zA-Z0-9_\-./~^@{}]/g, '');
}

/**
 * Run a git command safely, returning stdout or a fallback on error.
 * Accepts either a string command (uses execSync, for simple safe commands)
 * or an array of args (uses execFileSync with 'git', eliminating shell injection).
 * @param {string|string[]} cmdOrArgs — shell string or array of git arguments
 * @param {string} cwd
 * @param {*} fallback — value to return on error
 * @returns {string}
 */
function run(cmdOrArgs, cwd, fallback = '') {
  try {
    if (Array.isArray(cmdOrArgs)) {
      return execFileSync('git', cmdOrArgs, EXEC_OPTS(cwd)).trim();
    }
    return execSync(cmdOrArgs, EXEC_OPTS(cwd)).trim();
  } catch {
    return fallback;
  }
}

/**
 * Check if directory is a git repository.
 * @param {string} cwd
 * @returns {boolean}
 */
export function isGitRepo(cwd) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      ...EXEC_OPTS(cwd),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name.
 * @param {string} cwd
 * @returns {string}
 */
export function getCurrentBranch(cwd) {
  return run('git -c core.quotepath=false rev-parse --abbrev-ref HEAD', cwd, 'unknown');
}

/**
 * Auto-detect the base branch (main > master > dev > develop).
 * Checks remotes first, then local branches.
 * @param {string} cwd
 * @returns {string|null}
 */
export function getBaseBranch(cwd) {
  const candidates = ['main', 'master', 'dev', 'develop'];

  // Check remote branches first (origin/*)
  const remoteBranches = run('git -c core.quotepath=false branch -r --list', cwd, '');
  for (const name of candidates) {
    if (remoteBranches.split('\n').some(b => b.trim() === `origin/${name}`)) {
      return name;
    }
  }

  // Fall back to local branches
  const localBranches = run('git -c core.quotepath=false branch --list', cwd, '');
  for (const name of candidates) {
    // Branch list lines look like "  main" or "* main"
    if (localBranches.split('\n').some(b => b.replace(/^\*?\s*/, '') === name)) {
      return name;
    }
  }

  return null;
}

/**
 * Get uncommitted changes diff (staged + unstaged vs HEAD).
 * @param {string} cwd
 * @returns {string}
 */
export function getUncommittedDiff(cwd) {
  return run('git -c core.quotepath=false diff HEAD', cwd, '');
}

/**
 * Get branch diff (current branch vs base branch, using triple-dot merge-base).
 * @param {string} cwd
 * @param {string} baseBranch
 * @returns {string}
 */
export function getBranchDiff(cwd, baseBranch) {
  const safeBranch = sanitizeRef(baseBranch);
  if (!safeBranch) return '';
  return run(['-c', 'core.quotepath=false', 'diff', `${safeBranch}...HEAD`], cwd, '');
}

/**
 * Get diff for a specific commit.
 * Uses `git show` instead of `diff hash~1 hash` to handle root commits correctly.
 * @param {string} cwd
 * @param {string} commitHash
 * @returns {string}
 */
export function getCommitDiff(cwd, commitHash) {
  const safeHash = sanitizeRef(commitHash);
  if (!safeHash) return '';
  return run(['-c', 'core.quotepath=false', 'show', '--format=', '--patch', safeHash], cwd, '');
}

/**
 * Get staged changes diff.
 * @param {string} cwd
 * @returns {string}
 */
export function getStagedDiff(cwd) {
  return run('git -c core.quotepath=false diff --cached', cwd, '');
}

/**
 * Get git status (short format).
 * @param {string} cwd
 * @returns {string}
 */
export function getGitStatus(cwd) {
  return run('git -c core.quotepath=false status --short', cwd, '');
}

/**
 * Get recent commits (last N).
 * @param {string} cwd
 * @param {number} count
 * @returns {string[]}
 */
export function getRecentCommits(cwd, count = 10) {
  const n = Math.max(1, Math.min(Number(count) || 10, 100));
  const raw = run(
    ['-c', 'core.quotepath=false', 'log', '--oneline', '-n', String(n)],
    cwd,
    ''
  );
  if (!raw) return [];
  return raw.split('\n').filter(Boolean);
}

/**
 * Get file content at a specific ref.
 * @param {string} cwd
 * @param {string} ref
 * @param {string} filePath
 * @returns {string}
 */
export function getFileAtRef(cwd, ref, filePath) {
  const safeRef = sanitizeRef(ref);
  // Sanitize filePath: allow typical path characters but block shell metacharacters
  const safePath = filePath.replace(/[^a-zA-Z0-9_\-./\s]/g, '');
  if (!safeRef || !safePath) return '';
  return run(['-c', 'core.quotepath=false', 'show', `${safeRef}:${safePath}`], cwd, '');
}
