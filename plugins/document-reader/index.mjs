/**
 * Oboto Document Reader Plugin
 *
 * Ingest and analyze documents (PDF, DOCX, XLSX, Images, Text).
 * Extracts text, generates summaries using AI, and stores documents.
 * Ported from notaclaw/plugins/document-reader.
 *
 * @module @oboto/plugin-document-reader
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Dynamically import heavy extractors only when needed
let pdfParse;
let mammoth;
let xlsx;

// ── Storage Service ───────────────────────────────────────────────────────

class StorageService {
    constructor(api) {
        this.api = api;
        this.documents = [];
    }

    async init() {
        const storedDocs = await this.api.storage.get('documents');
        if (storedDocs && Array.isArray(storedDocs)) {
            this.documents = storedDocs;
        }
    }

    async saveDocument(doc) {
        const storedDoc = {
            ...doc,
            id: randomUUID(),
            ingestedAt: new Date().toISOString()
        };

        this.documents.push(storedDoc);
        await this.api.storage.set('documents', this.documents);

        console.log(`[document-reader] Saved document ${storedDoc.id}`);
        return storedDoc;
    }

    getDocuments() {
        return this.documents;
    }

    getDocument(id) {
        return this.documents.find(d => d.id === id);
    }
}

// ── Extraction Service ────────────────────────────────────────────────────

class ExtractionService {
    async extract(filePath) {
        const mimeType = this.getMimeType(filePath);
        const buffer = await fs.readFile(filePath);
        let content = '';
        let metadata = { title: path.basename(filePath) };

        console.log(`[document-reader] Extracting ${filePath} as ${mimeType}`);

        if (mimeType === 'application/pdf') {
            if (!pdfParse) pdfParse = (await import('pdf-parse')).default;
            const pdfData = await pdfParse(buffer);
            content = pdfData.text;
            metadata.pageCount = pdfData.numpages;
            if (pdfData.info && pdfData.info.Title) metadata.title = pdfData.info.Title;
        } 
        else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            if (!mammoth) mammoth = (await import('mammoth')).default;
            const result = await mammoth.extractRawText({ buffer });
            content = result.value;
        } 
        else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'application/vnd.ms-excel') {
            if (!xlsx) xlsx = (await import('xlsx')).default;
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const sheets = [];
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                sheets.push(`--- Sheet: ${sheetName} ---`);
                sheets.push(xlsx.utils.sheet_to_csv(sheet));
            }
            content = sheets.join('\n');
            metadata.sheetCount = workbook.SheetNames.length;
        } 
        else if (mimeType.startsWith('text/')) {
            content = buffer.toString('utf-8');
        } 
        else if (mimeType.startsWith('image/')) {
            // OCR placeholder returning file metadata
            const stats = await fs.stat(filePath);
            content = `[Image File: ${path.basename(filePath)}]\nSize: ${stats.size} bytes\n(OCR placeholder: actual text extraction not implemented yet)`;
        } 
        else {
            throw new Error(`Unsupported file type: ${mimeType}`);
        }

        return { content, metadata };
    }

    getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.txt': return 'text/plain';
            case '.md': return 'text/markdown';
            case '.csv': return 'text/csv';
            case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            case '.pdf': return 'application/pdf';
            case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            case '.xls': return 'application/vnd.ms-excel';
            case '.png': return 'image/png';
            case '.jpg':
            case '.jpeg': return 'image/jpeg';
            case '.webp': return 'image/webp';
            default: return 'application/octet-stream';
        }
    }
}

// ── Enrichment Service ────────────────────────────────────────────────────

class EnrichmentService {
    constructor(api) {
        this.api = api;
    }

    async enrich(document) {
        console.log('[document-reader] Enriching document...');
        const summary = await this.generateSummary(document.content);
        const entities = this.extractEntities(document.content);

        return {
            ...document,
            metadata: {
                ...document.metadata,
                summary,
                entities
            }
        };
    }

    async generateSummary(content) {
        if (!content || content.trim() === '') return '';

        // Try using AI if available
        try {
            const prompt = `Summarize the following document content concisely in a few sentences:\n\n${content.substring(0, 10000)}`;
            const response = await this.api.ai.ask(prompt);
            if (response && response.trim()) {
                return response.trim();
            }
        } catch (err) {
            console.warn('[document-reader] AI summarization failed, falling back to simple extraction', err.message);
        }

        // Fallback to simple extraction (first few sentences)
        const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
        return sentences.slice(0, 5).join(' ').trim();
    }

    extractEntities(content) {
        if (!content) return [];
        // Very basic mock entity extraction (capitalized words > 3 chars)
        const words = content.split(/\s+/);
        const entities = words.filter(w => /^[A-Z][a-z]+$/.test(w) && w.length > 3);
        return [...new Set(entities)].slice(0, 10);
    }
}

// ── Plugin Lifecycle ──────────────────────────────────────────────────────

export async function activate(api) {
    console.log('[document-reader] Activating...');

    const storageService = new StorageService(api);
    await storageService.init();

    const extractionService = new ExtractionService();
    const enrichmentService = new EnrichmentService(api);

    // ── Tool: ingest_document ─────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'ingest_document',
        description: 'Ingest a document from a file path. Supports PDF, DOCX, XLSX, Images, and Text files.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute or relative path to the file to ingest' }
            },
            required: ['filePath']
        },
        handler: async (args) => {
            try {
                // Ensure absolute path or resolve against cwd
                const targetPath = path.resolve(process.cwd(), args.filePath);
                
                const extracted = await extractionService.extract(targetPath);
                const enriched = await enrichmentService.enrich(extracted);
                const stored = await storageService.saveDocument(enriched);

                // Omit full content from tool response to prevent context blowing up, 
                // returning only metadata. The user can fetch content via get_document_content.
                return { 
                    success: true, 
                    documentId: stored.id,
                    metadata: stored.metadata
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    });

    // ── Tool: list_documents ──────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'list_documents',
        description: 'List all previously ingested documents.',
        parameters: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            return storageService.getDocuments().map(d => ({
                id: d.id,
                title: d.metadata.title,
                ingestedAt: d.ingestedAt,
                summary: d.metadata.summary
            }));
        }
    });

    // ── Tool: get_document_content ────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'get_document_content',
        description: 'Get the full text content of an ingested document by its ID.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Document ID from list_documents or ingest_document' }
            },
            required: ['id']
        },
        handler: async (args) => {
            const doc = storageService.getDocument(args.id);
            if (!doc) throw new Error(`Document not found: ${args.id}`);
            return {
                id: doc.id,
                metadata: doc.metadata,
                content: doc.content
            };
        }
    });

    // ── Tool: summarize_document ──────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'summarize_document',
        description: 'Generate a summary of arbitrary text content.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'The text content to summarize' },
                maxLength: { type: 'number', description: 'Approximate maximum length of the summary in characters' }
            },
            required: ['content']
        },
        handler: async (args) => {
            const maxLength = args.maxLength || 200;
            const summary = await enrichmentService.generateSummary(args.content);
            const finalSummary = summary.length > maxLength ? summary.substring(0, maxLength) + '...' : summary;
            
            return { 
                summary: finalSummary,
                originalLength: args.content.length 
            };
        }
    });

    console.log('[document-reader] Activated');
}

export async function deactivate(api) {
    console.log('[document-reader] Deactivated');
}
