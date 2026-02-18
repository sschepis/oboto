import { DesignResult } from './design-result.mjs';
import { CancellationError } from './cancellation-error.mjs';

/**
 * Design phase: Run the agent to produce a structured technical design document.
 */
export async function runDesign(createAssistant, statusAdapter, task, options = {}) {
    const designAssistant = createAssistant();
    await designAssistant.initializeCustomTools();

    statusAdapter.onToolStart('ai_man_design', { task });

    const designPrompt = `You are in DESIGN-ONLY mode. Your job is to produce a comprehensive technical design document for the following task. You must NOT write any implementation code.

TASK: ${task}

INSTRUCTIONS:
1. First, use the \`init_structured_dev\` tool to initialize structured development in the working directory.
2. Analyze the task requirements thoroughly. Use \`list_files\` and \`read_file\` to understand any existing codebase.
3. Break the task into discrete features/components. For each feature, identify:
   - A unique Feature ID (e.g., FEAT-001)
   - A descriptive name
   - Dependencies on other features
   - Priority (High/Medium/Low)
4. For each feature, write a detailed technical design covering:
   - Purpose and responsibilities
   - Public API / interfaces (function signatures, types, props)
   - Internal architecture and data flow
   - File locations and naming conventions
   - Edge cases and error handling strategy
5. Use \`submit_technical_design\` for each feature to register it in the manifest.
6. Define the dependency graph showing which features depend on which.
7. Produce a single comprehensive design document as your final response.

CONSTRAINTS:
- Do NOT write any implementation code (no source files, no tests)
- Do NOT create files other than the SYSTEM_MAP.md manifest
- Focus entirely on architecture, interfaces, and component design
- Be specific about file paths, function signatures, and data structures
- The design must be detailed enough that a separate agent can implement it without further clarification

Your final response must be the complete design document.`;

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

    const implementPrompt = `You are in IMPLEMENTATION mode. A design has already been completed for the following task. Your job is to implement EVERYTHING described in the design document below.

ORIGINAL TASK: ${designResult.task}

DESIGN DOCUMENT:
${designResult.document}

INSTRUCTIONS:
1. First, use \`read_manifest\` to review the current SYSTEM_MAP.md and understand all registered features.
2. For each feature in the design:
   a. Use \`approve_design\` to approve its design (moving it to Interface phase).
   b. If interfaces are defined, use \`lock_interfaces\` to lock them.
   c. Implement the feature by writing all source files using \`write_file\`.
   d. Write unit tests for the feature.
   e. Add JSDoc documentation to all public APIs.
3. After implementing all features:
   a. Use \`list_files\` to verify all expected files were created.
   b. Run any validation or tests to confirm correctness.
   c. Update the SYSTEM_MAP.md to mark features as completed.
4. Provide a comprehensive summary of everything you implemented.

CONSTRAINTS:
- Follow the design document precisely — do not deviate from the specified architecture, file paths, or interfaces.
- Implement ALL features, not just some of them.
- Every source file must include proper error handling.
- Write tests for every feature.
- If a feature depends on another, implement dependencies first.

Your final response must summarize all files created/modified and confirm implementation completeness.`;

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

    const testPrompt = `You are in TESTING mode. Review the implementation and write comprehensive tests.

IMPLEMENTATION SUMMARY:
${implSummary}

INSTRUCTIONS:
1. Use \`list_files\` to see all source files created.
2. Use \`read_file\` to review each source file.
3. For each module, write unit tests using the project's test framework (or a standard one like Jest/Mocha/Node native runner).
4. Use \`write_file\` to create test files.
5. Use \`run_command\` to execute the test suite.
6. If tests fail, read the error output and fix the source code (using \`edit_file\` or \`write_file\`).
7. Repeat until all tests pass.
8. Report final test results.`;

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

    const reviewPrompt = `You are a CODE REVIEWER. Your job is to review the implementation against the design and find issues.

DESIGN DOCUMENT:
${designResult.document}

IMPLEMENTATION SUMMARY:
${implSummary}

INSTRUCTIONS:
1. Read all implemented source files using \`list_files\` and \`read_file\`.
2. Compare each file against the design specification.
3. Check for:
   - Missing features or incomplete implementations
   - Deviations from specified interfaces
   - Missing error handling
   - Missing tests
   - Security issues
   - Performance concerns
4. Rate each finding as: CRITICAL, HIGH, MEDIUM, or LOW severity.
5. Return a structured JSON review with this format (use JSON mode):
{
  "overallScore": 8,
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
