import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Utility to handle dry-run logic for tool execution
 * @param {boolean} dryRun - Whether dry-run mode is active
 * @param {Array} plannedChanges - Array to push planned changes to
 * @param {Object} planData - Object describing the planned change
 * @param {Function} handler - Function to execute if not in dry-run mode
 * @returns {Promise<string>} Result of execution or dry-run message
 */
export async function dryRunGuard(dryRun, plannedChanges, planData, handler) {
    if (dryRun) {
        plannedChanges.push(planData);
        consoleStyler.log('working', `[DRY RUN] ${planData.preview || planData.type}`);
        return `[DRY RUN] Would ${planData.preview || planData.type}`;
    }
    return handler();
}
