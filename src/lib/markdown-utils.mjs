// Shared Markdown utilities
// Consolidated from duplicate implementations across project-management and structured-dev modules
// See docs/DUPLICATE_CODE_ANALYSIS.md — DUP-5, DUP-6

/**
 * Parse a markdown table section into an array of objects.
 * Each object uses normalized header names as keys.
 *
 * @param {string} text - The text containing the markdown table (may include other content)
 * @param {Object} [options]
 * @param {boolean} [options.preserveCase=false] - Keep header casing instead of lowercasing
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 *
 * @example
 *   const { headers, rows } = parseMarkdownTable(sectionText);
 *   // headers: ['id', 'name', 'status']
 *   // rows: [{ id: 'FEAT-001', name: 'Login', status: 'Active' }]
 */
export function parseMarkdownTable(text, options = {}) {
    const { preserveCase = false } = options;

    const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
    if (lines.length < 2) {
        return { headers: [], rows: [] };
    }

    // First line is header
    const rawHeaders = extractColumns(lines[0]);
    const headers = rawHeaders.map(h => {
        let normalized = h.replace(/\s+/g, '_');
        if (!preserveCase) normalized = normalized.toLowerCase();
        return normalized;
    }).filter(h => h && !h.includes('---'));

    if (headers.length === 0) {
        return { headers: [], rows: [] };
    }

    // Skip separator line (index 1), parse data rows
    const rows = [];
    for (let i = 2; i < lines.length; i++) {
        const cols = extractColumns(lines[i]);
        if (cols.length === 0 || !cols[0]) continue;

        // Skip separator rows that somehow appear later
        if (cols.every(c => /^-+$/.test(c))) continue;

        const row = {};
        headers.forEach((h, idx) => {
            row[h] = cols[idx] || '';
        });
        rows.push(row);
    }

    return { headers, rows };
}

/**
 * Build a markdown table string from headers and row arrays.
 *
 * @param {string[]} headers - Column headers
 * @param {(string | string[])[]} rows - Array of rows. Each row is either
 *   an array of column values or an object (keyed by header).
 * @returns {string} Formatted markdown table
 *
 * @example
 *   buildMarkdownTable(
 *     ['ID', 'Name', 'Status'],
 *     [['FEAT-001', 'Login', 'Active'], ['FEAT-002', 'Auth', 'Pending']]
 *   );
 */
export function buildMarkdownTable(headers, rows) {
    const headerLine = '| ' + headers.join(' | ') + ' |';
    const separatorLine = '|' + headers.map(() => '---|').join('');
    const dataLines = rows.map(row => {
        const cols = Array.isArray(row)
            ? row
            : headers.map(h => row[h] || row[h.toLowerCase()] || '');
        return '| ' + cols.join(' | ') + ' |';
    });

    return [headerLine, separatorLine, ...dataLines].join('\n');
}

/**
 * Extract column values from a single markdown table row.
 * Handles leading/trailing pipes and whitespace.
 *
 * @param {string} line - A single markdown table row (e.g., "| col1 | col2 |")
 * @returns {string[]} Array of trimmed column values
 */
export function extractColumns(line) {
    return line
        .split('|')
        .map(c => c.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
}

/**
 * Parse a markdown document into structured sections.
 * Extracts title, headings, and section content.
 *
 * @param {string} content - Raw markdown content
 * @returns {{ title: string, sections: Array<{heading: string, level: number, content: string}>, rawContent: string }}
 */
export function parseMarkdownSections(content) {
    const lines = content.split('\n');
    const sections = [];
    let title = '';
    let currentSection = null;

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            // Save previous section
            if (currentSection) {
                currentSection.content = currentSection.content.trim();
                sections.push(currentSection);
            }

            const level = headingMatch[1].length;
            const heading = headingMatch[2].replace(/\*\*/g, '').trim();

            // First H1 or H2 is the title
            if (!title && level <= 2) {
                title = heading;
            }

            currentSection = { heading, level, content: '' };
        } else if (currentSection) {
            currentSection.content += line + '\n';
        }
    }

    // Push final section
    if (currentSection) {
        currentSection.content = currentSection.content.trim();
        sections.push(currentSection);
    }

    return { title, sections, rawContent: content };
}

/**
 * Extract bullet points from markdown content.
 * Handles both `- item` / `* item` and `1. item` formats.
 *
 * @param {string} content - Markdown text
 * @param {Object} [options]
 * @param {number} [options.minLength=3] - Minimum text length to include
 * @param {number} [options.maxLength=200] - Maximum text length to include
 * @returns {Array<{text: string, detail: string}>}
 */
export function extractBullets(content, options = {}) {
    const { minLength = 3, maxLength = 200 } = options;
    const bullets = [];
    const lines = content.split('\n');

    for (const line of lines) {
        const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
        const numberedMatch = line.match(/^\s*\d+\.\s+(.+)/);

        const match = bulletMatch || numberedMatch;
        if (match) {
            let text = match[1].trim();
            // Remove markdown formatting
            text = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
            // Remove trailing punctuation
            text = text.replace(/[:\.]$/, '').trim();

            if (text.length >= minLength && text.length <= maxLength) {
                // Split on colon or dash for name:detail pattern
                const parts = text.split(/:\s*|—\s*|–\s*/);
                bullets.push({
                    text: parts[0].trim(),
                    detail: parts.length > 1 ? parts.slice(1).join(' ').trim() : ''
                });
            }
        }
    }

    return bullets;
}
