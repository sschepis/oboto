import { execFile } from 'child_process';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { convertHistoryToUIMessages, parseJestJsonOutput } from '../ws-helpers.mjs';

/**
 * Handles: get-history, delete-message, run-tests, code-completion-request, tool-confirmation-response
 */

async function handleGetHistory(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const history = assistant.historyManager.getHistory();
        const uiMessages = convertHistoryToUIMessages(history);
        ws.send(JSON.stringify({ type: 'history-loaded', payload: uiMessages }));
    } catch (err) {
        consoleStyler.log('error', `Failed to get history: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: err.message }));
    }
}

async function handleDeleteMessage(data, ctx) {
    const { assistant, broadcast } = ctx;
    try {
        const { id } = data.payload;
        const deleted = assistant.historyManager.deleteMessage(id);
        if (deleted) {
            await assistant.saveConversation();
            // Broadcast updated history to all clients
            const history = assistant.historyManager.getHistory();
            const uiMessages = convertHistoryToUIMessages(history);
            broadcast('history-loaded', uiMessages);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to delete message: ${err.message}`);
    }
}

async function handleRunTests(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const { command } = data.payload || {};
        const testCommand = command || 'npx jest --json --no-coverage';
        const cwd = assistant.workingDir;

        consoleStyler.log('system', `Running tests: ${testCommand} in ${cwd}`);

        // Send a status message so the UI knows tests are running
        ws.send(JSON.stringify({
            type: 'message',
            payload: {
                id: `test-run-${Date.now()}`,
                role: 'ai',
                type: 'text',
                content: `🧪 Running tests: \`${testCommand}\`…`,
                timestamp: new Date().toLocaleTimeString()
            }
        }));

        // Split command for execFile
        const parts = testCommand.split(/\s+/);
        const bin = parts[0];
        const args = parts.slice(1);

        execFile(bin, args, { cwd, maxBuffer: 1024 * 1024 * 10, timeout: 120000 }, (error, stdout, stderr) => {
            const exitCode = error ? (error.code || 1) : 0;
            let testResults;

            try {
                // Jest --json prints JSON to stdout
                const jestOutput = JSON.parse(stdout);
                testResults = parseJestJsonOutput(jestOutput, testCommand, exitCode, stderr || stdout);
            } catch {
                // Fallback: couldn't parse JSON — send raw output
                testResults = {
                    suites: [],
                    totalPassed: 0,
                    totalFailed: exitCode ? 1 : 0,
                    totalPending: 0,
                    totalDuration: 0,
                    testCommand,
                    exitCode,
                    rawOutput: stdout || stderr || 'No output captured'
                };
            }

            ws.send(JSON.stringify({
                type: 'test-results',
                payload: testResults
            }));
        });
    } catch (err) {
        consoleStyler.log('error', `Failed to run tests: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to run tests: ${err.message}` }));
    }
}

async function handleCodeCompletionRequest(data, ctx) {
    const { ws, assistant } = ctx;
    const { id, payload } = data;
    try {
        // Delegate to assistant
        // If method doesn't exist yet, return null
        const completion = assistant.generateCodeCompletion 
            ? await assistant.generateCodeCompletion(payload.content, payload.cursorOffset, payload.filePath)
            : null;
            
        ws.send(JSON.stringify({
            type: 'code-completion-response',
            id,
            payload: { completion }
        }));
    } catch (e) {
         ws.send(JSON.stringify({
            type: 'code-completion-response',
            id,
            payload: { completion: null }
        }));
    }
}

async function handleToolConfirmationResponse(data, ctx) {
    const { assistant } = ctx;
    const { id, decision } = data.payload;
    if (assistant.toolExecutor) {
        assistant.toolExecutor.resolveConfirmation(id, decision);
    }
}

export const handlers = {
    'get-history': handleGetHistory,
    'delete-message': handleDeleteMessage,
    'run-tests': handleRunTests,
    'code-completion-request': handleCodeCompletionRequest,
    'tool-confirmation-response': handleToolConfirmationResponse
};
