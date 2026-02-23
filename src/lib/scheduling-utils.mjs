// Shared topological scheduling utility
// Consolidated from ImplementationPlanner.scheduleTasks() and TaskScheduler.createExecutionPlan()
// See docs/DUPLICATE_CODE_ANALYSIS.md — DUP-3

/**
 * @typedef {Object} SchedulableItem
 * @property {string} id - Unique identifier
 * @property {string[]} dependencies - IDs of items this depends on
 * @property {string} [status] - Current status (items with doneStatus are excluded from pending)
 */

/**
 * @typedef {Object} ScheduleStage
 * @property {number} id - Stage number (1-based)
 * @property {Array} tasks - Items scheduled for this stage
 */

/**
 * Perform topological sort with parallel staging and resource constraints.
 *
 * Groups items into stages where each stage contains up to `numParallel` items
 * that can execute concurrently. Items are only scheduled when all their pending
 * dependencies have been scheduled in earlier stages.
 *
 * @param {SchedulableItem[]} items - All items to schedule (including completed ones)
 * @param {Object} [options]
 * @param {number} [options.numParallel=3] - Max items per stage
 * @param {string} [options.doneStatus='Completed'] - Status value meaning "done" (excluded from scheduling)
 * @param {function} [options.sortFn] - Custom sort function for ready queue (default: by dependent count desc)
 * @param {function} [options.getDeps] - Custom function to extract dependencies: (item) => string[]
 * @returns {{ stages: ScheduleStage[], unscheduled: string[] }}
 *   - stages: Ordered execution stages with items
 *   - unscheduled: IDs that couldn't be scheduled (cyclic dependencies)
 *
 * @throws {Error} If cyclic dependencies are detected (when throwOnCycle is true)
 *
 * @example
 *   const items = [
 *     { id: 'A', dependencies: [] },
 *     { id: 'B', dependencies: ['A'] },
 *     { id: 'C', dependencies: ['A'] },
 *     { id: 'D', dependencies: ['B', 'C'] }
 *   ];
 *   const { stages } = topologicalSchedule(items, { numParallel: 2 });
 *   // stages[0].tasks = [A]
 *   // stages[1].tasks = [B, C]
 *   // stages[2].tasks = [D]
 */
export function topologicalSchedule(items, options = {}) {
    const {
        numParallel = 3,
        doneStatus = 'Completed',
        sortFn = null,
        getDeps = (item) => item.dependencies || []
    } = options;

    const pendingItems = items.filter(i => i.status !== doneStatus);
    const completedIds = new Set(
        items.filter(i => i.status === doneStatus).map(i => i.id)
    );

    // Build adjacency list and in-degree map
    const graph = new Map();    // id -> [dependent ids]
    const inDegree = new Map(); // id -> count of pending dependencies
    const itemMap = new Map();  // id -> item object

    // Initialize
    for (const item of pendingItems) {
        itemMap.set(item.id, item);
        inDegree.set(item.id, 0);
        if (!graph.has(item.id)) graph.set(item.id, []);
    }

    // Populate graph based on dependencies
    for (const item of pendingItems) {
        const deps = getDeps(item);
        for (const depId of deps) {
            // Skip completed dependencies
            if (completedIds.has(depId)) continue;

            // If dependency is pending, add edge
            if (itemMap.has(depId)) {
                if (!graph.has(depId)) graph.set(depId, []);
                graph.get(depId).push(item.id);
                inDegree.set(item.id, (inDegree.get(item.id) || 0) + 1);
            }
            // Unknown dependencies are silently ignored (external or typo)
        }
    }

    const stages = [];
    let readyQueue = [];

    // Initial set of ready items (in-degree 0)
    for (const [id, count] of inDegree) {
        if (count === 0) readyQueue.push(id);
    }

    // Default sort: by number of dependents descending (prioritize items that unlock more work)
    const defaultSort = (a, b) => {
        const depsA = graph.get(a)?.length || 0;
        const depsB = graph.get(b)?.length || 0;
        return depsB - depsA;
    };

    const actualSortFn = sortFn || defaultSort;

    // List Scheduling Algorithm
    while (readyQueue.length > 0) {
        readyQueue.sort(actualSortFn);

        const stageTasks = readyQueue.splice(0, numParallel);
        const stageItems = stageTasks.map(id => itemMap.get(id)).filter(Boolean);

        stages.push({
            id: stages.length + 1,
            tasks: stageItems
        });

        // Update degrees for dependents of completed items
        const nextReady = [];
        for (const completedId of stageTasks) {
            const dependents = graph.get(completedId) || [];
            for (const depId of dependents) {
                if (!inDegree.has(depId)) continue;
                inDegree.set(depId, inDegree.get(depId) - 1);
                if (inDegree.get(depId) === 0) {
                    nextReady.push(depId);
                }
            }
        }

        readyQueue.push(...nextReady);
    }

    // Detect cycles: items with remaining in-degree > 0
    const unscheduled = [];
    for (const [id, count] of inDegree) {
        if (count > 0) unscheduled.push(id);
    }

    return { stages, unscheduled };
}
