import { execFile } from 'child_process';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { convertHistoryToUIMessages, parseJestJsonOutput } from '../ws-helpers.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: get-history, delete-message, run-tests, code-completion-request, tool-confirmation-response
 */

async function handleGetHistory(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const history = assistant.historyManager.getHistory();
        const uiMessages = convertHistoryToUIMessages(history);
        wsSend(ws, 'history-loaded', uiMessages);
    } catch (err) {
        consoleStyler.log('error', `Failed to get history: ${err.message}`);
        wsSendError(ws, err.message);
    }
}

async function handleDeleteMessage(data, ctx) {
    const { assistant, broadcast } = ctx;
    try {
        const { id } = data.payload;
        const deleted = assistant.historyManager.deleteMessage(id);
        if (deleted) {
            await assistant.saveConversation();
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

        wsSend(ws, 'message', {
            id: `test-run-${Date.now()}`,
            role: 'ai',
            type: 'text',
            content: `🧪 Running tests: \`${testCommand}\`…`,
            timestamp: new Date().toLocaleTimeString()
        });

        const parts = testCommand.split(/\s+/);
        const bin = parts[0];
        const args = parts.slice(1);

        execFile(bin, args, { cwd, maxBuffer: 1024 * 1024 * 10, timeout: 120000 }, (error, stdout, stderr) => {
            const exitCode = error ? (error.code || 1) : 0;
            let testResults;

            try {
                const jestOutput = JSON.parse(stdout);
                testResults = parseJestJsonOutput(jestOutput, testCommand, exitCode, stderr || stdout);
            } catch {
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

            wsSend(ws, 'test-results', testResults);
        });
    } catch (err) {
        consoleStyler.log('error', `Failed to run tests: ${err.message}`);
        wsSendError(ws, `Failed to run tests: ${err.message}`);
    }
}

async function handleCodeCompletionRequest(data, ctx) {
    const { ws, assistant } = ctx;
    const { id, payload } = data;
    try {
        const completion = assistant.generateCodeCompletion 
            ? await assistant.generateCodeCompletion(payload.content, payload.cursorOffset, payload.filePath)
            : null;
            
        wsSend(ws, 'code-completion-response', { completion });
    } catch (e) {
        wsSend(ws, 'code-completion-response', { completion: null });
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
