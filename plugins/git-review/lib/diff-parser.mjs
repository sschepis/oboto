/**
 * Unified diff parser — parses raw `git diff` output into structured format.
 *
 * @typedef {{ oldStart: number, oldLines: number, newStart: number, newLines: number, content: string }} DiffHunk
 * @typedef {{ path: string, status: 'added'|'modified'|'deleted'|'renamed', hunks: DiffHunk[], oldPath?: string }} DiffFile
 */

const DIFF_HEADER_RE = /^diff --git a\/(.*?) b\/(.*?)$/m;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const BINARY_RE = /^Binary files .* differ$/;
const SUBMODULE_RE = /^Subproject commit /;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;

/**
 * Parse unified diff output into structured format.
 * @param {string} rawDiff — raw output from `git diff`
 * @returns {{ files: DiffFile[], raw: string }}
 */
export function parseDiff(rawDiff) {
  if (!rawDiff || !rawDiff.trim()) {
    return { files: [], raw: '' };
  }

  const files = [];
  // Split on diff headers, keeping the header line with each section
  const sections = rawDiff.split(/(?=^diff --git )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Must start with a diff header
    const headerMatch = trimmed.match(DIFF_HEADER_RE);
    if (!headerMatch) continue;

    const [, aPath, bPath] = headerMatch;
    const lines = trimmed.split('\n');

    // Skip binary files
    if (lines.some(l => BINARY_RE.test(l))) continue;

    // Skip submodule changes
    if (lines.some(l => SUBMODULE_RE.test(l))) continue;

    // Determine file status
    let status = 'modified';
    let oldPath;

    const hasDevNullOld = lines.some(l => l === '--- /dev/null');
    const hasDevNullNew = lines.some(l => l === '+++ /dev/null');
    const renameFromLine = lines.find(l => RENAME_FROM_RE.test(l));
    const renameToLine = lines.find(l => RENAME_TO_RE.test(l));

    if (hasDevNullOld) {
      status = 'added';
    } else if (hasDevNullNew) {
      status = 'deleted';
    } else if (renameFromLine && renameToLine) {
      status = 'renamed';
      const fromMatch = renameFromLine.match(RENAME_FROM_RE);
      if (fromMatch) oldPath = fromMatch[1];
    }

    // Parse hunks
    const hunks = [];
    let currentHunk = null;
    let inHunk = false;

    for (const line of lines) {
      const hunkMatch = line.match(HUNK_HEADER_RE);
      if (hunkMatch) {
        // Save previous hunk
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || '1', 10),
          content: line + '\n',
        };
        inHunk = true;
        continue;
      }

      if (inHunk && currentHunk) {
        // Hunk content lines start with +, -, space, or \ (no newline at end of file)
        if (
          line.startsWith('+') ||
          line.startsWith('-') ||
          line.startsWith(' ') ||
          line.startsWith('\\')
        ) {
          currentHunk.content += line + '\n';
        } else if (line.startsWith('diff --git')) {
          // Shouldn't happen since we split on headers, but guard
          break;
        }
        // Other metadata lines within a hunk section (like index, mode) — skip
      }
    }

    // Push the last hunk
    if (currentHunk) {
      hunks.push(currentHunk);
    }

    files.push({
      path: bPath,
      status,
      hunks,
      ...(oldPath ? { oldPath } : {}),
    });
  }

  return { files, raw: rawDiff };
}
