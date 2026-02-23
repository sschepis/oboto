import path from 'path';
import fs from 'fs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { getDirectoryTree } from '../ws-helpers.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

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
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(assistant.workingDir, filePath);
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
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(assistant.workingDir, filePath);
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
        const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(assistant.workingDir, targetPath);
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
        const fullSource = path.isAbsolute(source) ? source : path.join(assistant.workingDir, source);
        const fullDest = path.isAbsolute(destination) ? destination : path.join(assistant.workingDir, destination);
        
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
    const { ws, broadcastFileTree } = ctx;
    try {
        const dirPath = data.payload;
        await fs.promises.mkdir(dirPath, { recursive: true });
        wsSend(ws, 'dir-created', dirPath);
        broadcastFileTree();
    } catch (err) {
        consoleStyler.log('error', `Failed to create dir: ${err.message}`);
        wsSendError(ws, `Failed to create dir: ${err.message}`);
    }
}

async function handleListDirs(data, ctx) {
    const { ws } = ctx;
    try {
        const targetDir = data.payload || '/';
        const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
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
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(assistant.workingDir, filePath);
        const buffer = await fs.promises.readFile(fullPath);
        const content = buffer.toString('base64');
        wsSend(ws, 'media-file-content', { path: filePath, content });
    } catch (err) {
        consoleStyler.log('error', `Failed to read media file: ${err.message}`);
        wsSendError(ws, `Failed to read media file: ${err.message}`);
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
    'list-dirs': handleListDirs
};
