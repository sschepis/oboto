import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { getDirectoryTree } from '../ws-helpers.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Resolve and validate that a file path is within the workspace root.
 * Prevents path traversal attacks via `../` or absolute paths.
 *
 * @param {string} inputPath - Raw path from the client
 * @param {string} workingDir - Workspace root directory
 * @returns {string} Resolved absolute path within the workspace
 * @throws {Error} If the resolved path escapes the workspace boundary
 */
function resolveWorkspacePath(inputPath, workingDir) {
    const resolved = path.resolve(workingDir, inputPath);
    const workspaceRoot = path.resolve(workingDir);
    if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
        throw new Error(`Path "${inputPath}" is outside the workspace`);
    }
    return resolved;
}

/**
 * Handles: get-files, read-file, save-file, delete-file, copy-file, upload-file, create-dir, list-dirs
 */

async function handleGetFiles(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const targetDir = data.payload || assistant.workingDir;
        const tree = await getDirectoryTree(targetDir, 2);
        wsSend(ws, 'file-tree', tree);
    } catch (err) {
        consoleStyler.log('error', `Failed to get file tree: ${err.message}`);
        wsSendError(ws, err.message);
    }
}

async function handleReadFile(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const filePath = data.payload;
        const fullPath = resolveWorkspacePath(filePath, assistant.workingDir);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        wsSend(ws, 'file-content', { path: filePath, content });
    } catch (err) {
        if (err.code === 'ENOENT') {
            wsSend(ws, 'file-not-found', { path: data.payload });
        } else {
            consoleStyler.log('error', `Failed to read file: ${err.message}`);
            wsSendError(ws, `Failed to read file: ${err.message}`);
        }
    }
}

async function handleSaveFile(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const { path: filePath, content, encoding } = data.payload;
        const fullPath = resolveWorkspacePath(filePath, assistant.workingDir);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        
        if (encoding === 'base64') {
             await fs.promises.writeFile(fullPath, Buffer.from(content, 'base64'));
        } else {
             await fs.promises.writeFile(fullPath, content, 'utf8');
        }
        
        wsSend(ws, 'file-saved', { path: filePath });
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to save file: ${err.message}`);
        wsSendError(ws, `Failed to save file: ${err.message}`);
    }
}

async function handleDeleteFile(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const targetPath = data.payload;
        const fullPath = resolveWorkspacePath(targetPath, assistant.workingDir);
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        wsSend(ws, 'file-deleted', targetPath);
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to delete file/dir: ${err.message}`);
        wsSendError(ws, `Failed to delete: ${err.message}`);
    }
}

async function handleCopyFile(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const { source, destination } = data.payload;
        const fullSource = resolveWorkspacePath(source, assistant.workingDir);
        const fullDest = resolveWorkspacePath(destination, assistant.workingDir);
        
        await fs.promises.cp(fullSource, fullDest, { recursive: true });
        wsSend(ws, 'file-copied', { source, destination });
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to copy file/dir: ${err.message}`);
        wsSendError(ws, `Failed to copy: ${err.message}`);
    }
}

async function handleUploadFile(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const { name, data: fileData, encoding } = data.payload;
        const uploadsDir = path.join(assistant.workingDir, '.uploads');
        await fs.promises.mkdir(uploadsDir, { recursive: true });
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const destPath = path.join(uploadsDir, `${Date.now()}-${safeName}`);
        const buffer = Buffer.from(fileData, encoding || 'base64');
        await fs.promises.writeFile(destPath, buffer);
        const relativePath = path.relative(assistant.workingDir, destPath);
        wsSend(ws, 'file-uploaded', { name: safeName, path: relativePath, size: buffer.length });
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to upload file: ${err.message}`);
        wsSendError(ws, `Failed to upload file: ${err.message}`);
    }
}

async function handleCreateDir(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const dirPath = data.payload;
        const fullPath = resolveWorkspacePath(dirPath, assistant.workingDir);
        await fs.promises.mkdir(fullPath, { recursive: true });
        wsSend(ws, 'dir-created', dirPath);
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to create dir: ${err.message}`);
        wsSendError(ws, `Failed to create dir: ${err.message}`);
    }
}

async function handleListDirs(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const targetDir = data.payload || '.';
        const fullPath = resolveWorkspacePath(targetDir, assistant.workingDir);
        const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
        const dirs = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => e.name)
            .sort((a, b) => a.localeCompare(b));
        wsSend(ws, 'dir-list', { path: targetDir, dirs });
    } catch (err) {
        consoleStyler.log('error', `Failed to list dirs: ${err.message}`);
        wsSendError(ws, `Failed to list dirs: ${err.message}`);
    }
}

async function handleReadMediaFile(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const filePath = data.payload;
        const fullPath = resolveWorkspacePath(filePath, assistant.workingDir);
        const buffer = await fs.promises.readFile(fullPath);
        const content = buffer.toString('base64');
        wsSend(ws, 'media-file-content', { path: filePath, content });
    } catch (err) {
        consoleStyler.log('error', `Failed to read media file: ${err.message}`);
        wsSendError(ws, `Failed to read media file: ${err.message}`);
    }
}

async function handleRenameFile(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const { oldPath, newPath } = data.payload;
        const fullOld = resolveWorkspacePath(oldPath, assistant.workingDir);
        const fullNew = resolveWorkspacePath(newPath, assistant.workingDir);
        await fs.promises.rename(fullOld, fullNew);
        wsSend(ws, 'file-renamed', { oldPath, newPath });
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to rename: ${err.message}`);
        wsSendError(ws, `Failed to rename: ${err.message}`);
    }
}

async function handleMoveFile(data, ctx) {
    const { ws, assistant, broadcastFileTree } = ctx;
    try {
        const { source, destination } = data.payload;
        const fullSource = resolveWorkspacePath(source, assistant.workingDir);
        const fullDest = resolveWorkspacePath(destination, assistant.workingDir);
        // If destination is a directory, move into it preserving the filename
        let targetPath = fullDest;
        try {
            const destStat = await fs.promises.stat(fullDest);
            if (destStat.isDirectory()) {
                targetPath = path.join(fullDest, path.basename(fullSource));
            }
        } catch {
            // Destination doesn't exist — treat as a full rename/move path
        }
        await fs.promises.rename(fullSource, targetPath);
        wsSend(ws, 'file-moved', { source, destination: path.relative(assistant.workingDir, targetPath) });
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to move file: ${err.message}`);
        wsSendError(ws, `Failed to move: ${err.message}`);
    }
}

async function handleRevealInFinder(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const targetPath = data.payload;
        const fullPath = resolveWorkspacePath(targetPath, assistant.workingDir);
        // Use execFile (not exec) to avoid shell injection.
        // macOS: open -R reveals the file in Finder
        // Linux: xdg-open opens the parent directory
        // Windows: explorer /select,
        const platform = process.platform;
        const execCb = (err) => { if (err) consoleStyler.log('warning', `reveal-in-finder failed: ${err.message}`); };
        if (platform === 'darwin') {
            execFile('open', ['-R', fullPath], execCb);
        } else if (platform === 'win32') {
            execFile('explorer', [`/select,${fullPath}`], execCb);
        } else {
            execFile('xdg-open', [path.dirname(fullPath)], execCb);
        }
        wsSend(ws, 'revealed-in-finder', { path: targetPath });
    } catch (err) {
        consoleStyler.log('error', `Failed to reveal in finder: ${err.message}`);
        wsSendError(ws, `Failed to reveal in finder: ${err.message}`);
    }
}

async function handleOpenWithDefault(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const targetPath = data.payload;
        const fullPath = resolveWorkspacePath(targetPath, assistant.workingDir);
        // Use execFile (not exec) to avoid shell injection.
        // macOS: open
        // Linux: xdg-open
        // Windows: start (via cmd /c start)
        const platform = process.platform;
        const execCb = (err) => { if (err) consoleStyler.log('warning', `open-with-default failed: ${err.message}`); };
        if (platform === 'darwin') {
            execFile('open', [fullPath], execCb);
        } else if (platform === 'win32') {
            execFile('cmd', ['/c', 'start', '', fullPath], execCb);
        } else {
            execFile('xdg-open', [fullPath], execCb);
        }
        wsSend(ws, 'opened-with-default', { path: targetPath });
    } catch (err) {
        consoleStyler.log('error', `Failed to open file: ${err.message}`);
        wsSendError(ws, `Failed to open file: ${err.message}`);
    }
}

export const handlers = {
    'get-files': handleGetFiles,
    'read-file': handleReadFile,
    'read-media-file': handleReadMediaFile,
    'save-file': handleSaveFile,
    'delete-file': handleDeleteFile,
    'copy-file': handleCopyFile,
    'upload-file': handleUploadFile,
    'create-dir': handleCreateDir,
    'list-dirs': handleListDirs,
    'rename-file': handleRenameFile,
    'move-file': handleMoveFile,
    'reveal-in-finder': handleRevealInFinder,
    'open-with-default': handleOpenWithDefault,
};
