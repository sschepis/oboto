import { DesignResult } from './design-result.mjs';
import { CancellationError } from './cancellation-error.mjs';

/**
 * Design phase: Run the agent to produce a structured technical design document.
 */
export async function runDesign(createAssistant, statusAdapter, task, options = {}) {
    const designAssistant = createAssistant();
    await designAssistant.initializeCustomTools();

    statusAdapter.onToolStart('ai_man_design', { task });

    const designPrompt = `DESIGN-ONLY MODE. Produce a technical design document. NEVER write implementation code.

TASK: ${task}

STEPS:
1. Run \`init_structured_dev\` to initialize the working directory.
2. Use \`list_files\` and \`read_file\` to understand the existing codebase.
3. Break the task into features. Each feature MUST have:
   - Feature ID (e.g., FEAT-001), name, dependencies, priority (High/Medium/Low)
4. For each feature, specify:
   - Purpose, public API (signatures, types), internal architecture, data flow
   - File paths, naming conventions, edge cases, error handling
5. Run \`submit_technical_design\` per feature to register in manifest.
6. Define the dependency graph.
7. Return the complete design document as your final response.

CONSTRAINTS:
- NEVER create source files or test files — design document ONLY
- ONLY create SYSTEM_MAP.md manifest
- Include exact file paths, function signatures, and data structures
- Design MUST be detailed enough for a separate agent to implement without clarification`;

    try {
        const document = await designAssistant.run(designPrompt, { signal: options.signal });
        const result = new DesignResult({
            task,
            document,
            workingDir: designAssistant.workingDir
        });
        statusAdapter.onToolEnd('ai_man_design', result);
        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            const cancellation = new CancellationError(error.message);
            statusAdapter.log('system', 'Design phase was cancelled');
            throw cancellation;
        }
        statusAdapter.log('error', `Design failed: ${error.message}`);
        throw error;
    }
}

/**
 * Implementation phase: Take a design result and implement all features.
 */
export async function runImplement(createAssistant, statusAdapter, designResult, options = {}) {
    if (!designResult || !(designResult instanceof DesignResult)) {
        throw new Error('implement() requires a DesignResult from design(). Call design() first.');
    }

    const implAssistant = createAssistant();
    await implAssistant.initializeCustomTools();

    statusAdapter.onToolStart('ai_man_implement', { task: designResult.task });

    const implementPrompt = `IMPLEMENTATION MODE. Implement ALL features from the design document below.
FOLLOW the design EXACTLY — do not deviate from specified architecture, file paths, or interfaces.
Implement dependencies BEFORE dependents.

TASK: ${designResult.task}

DESIGN DOCUMENT:
${designResult.document}

STEPS:
1. Run \`read_manifest\` to review SYSTEM_MAP.md and all registered features.
2. For EACH feature (in dependency order):
   a. \`approve_design\` to move to Interface phase
   b. IF interfaces defined: \`lock_interfaces\`
   c. Write all source files via \`write_file\` with proper error handling
   d. Write unit tests
   e. Add JSDoc to all public APIs
3. After ALL features implemented:
   a. \`list_files\` to verify all expected files exist
   b. Run tests to confirm correctness
   c. Update SYSTEM_MAP.md to mark features completed
4. Return summary of all files created/modified and confirm completeness.`;

    try {
        const result = await implAssistant.run(implementPrompt, { signal: options.signal });
        statusAdapter.onToolEnd('ai_man_implement', result);
        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            const cancellation = new CancellationError(error.message);
            statusAdapter.log('system', 'Implementation phase was cancelled');
            throw cancellation;
        }
        statusAdapter.log('error', `Implementation failed: ${error.message}`);
        throw error;
    }
}

/**
 * Generate and run tests for an implementation.
 */
export async function runTest(createAssistant, implementationResult, options = {}) {
    const testAssistant = createAssistant();
    await testAssistant.initializeCustomTools();

    const implSummary = typeof implementationResult === 'string' ? implementationResult : implementationResult.result;

    const testPrompt = `TESTING MODE. Write and run tests for the implementation below.

IMPLEMENTATION SUMMARY:
${implSummary}

STEPS:
1. \`list_files\` to find all source files.
2. \`read_file\` to review each source file.
3. Write unit tests per module using the project's test framework (Jest/Mocha/Node test runner).
4. \`write_file\` to create test files.
5. \`run_command\` to execute tests.
6. IF tests fail: read errors, fix source via \`edit_file\`, re-run.
7. REPEAT step 6 MAX 3 TIMES. If still failing after 3 attempts, report remaining failures.
8. Return final test results.`;

    // Ensure run_command is available (it is part of standard tools now)
    return await testAssistant.run(testPrompt, { signal: options.signal });
}

/**
 * Review implementation against design.
 */
export async function runReview(createAssistant, designResult, implementationResult, options = {}) {
    const reviewAssistant = createAssistant();
    await reviewAssistant.initializeCustomTools();

    const implSummary = typeof implementationResult === 'string' ? implementationResult : implementationResult.result;

    const reviewPrompt = `CODE REVIEW MODE. Compare implementation against design. Find issues.

DESIGN DOCUMENT:
${designResult.document}

IMPLEMENTATION SUMMARY:
${implSummary}

STEPS:
1. \`list_files\` + \`read_file\` to read all source files.
2. Compare each file against the design specification.
3. Check for: missing features, interface deviations, missing error handling, missing tests, security issues, performance concerns.
4. Rate each finding: CRITICAL | HIGH | MEDIUM | LOW.
5. Return JSON:
{
  "overallScore": 0-10,
  "findings": [
    {"severity": "HIGH", "file": "src/auth.mjs", "line": 42, "issue": "...", "suggestion": "..."}
  ],
  "summary": "..."
}`;

    // Request JSON output
    const raw = await reviewAssistant.run(reviewPrompt, { 
        signal: options.signal,
        responseFormat: { type: 'json_object' }
    });
    
    try {
        return JSON.parse(raw);
    } catch {
        return { overallScore: null, findings: [], summary: raw };
    }
}
