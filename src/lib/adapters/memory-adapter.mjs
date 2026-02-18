/**
 * Abstract base class for memory adapters
 */
export class MemoryAdapter {
    /**
     * Store a text chunk with metadata
     * @param {string} text 
     * @param {Object} metadata 
     */
    async store(text, metadata = {}) {
        throw new Error('store() not implemented');
    }

    /**
     * Retrieve top-K relevant chunks for a query
     * @param {string} query 
     * @param {number} topK 
     * @returns {Promise<Array<{text: string, score: number, metadata: Object}>>}
     */
    async retrieve(query, topK = 5) {
        throw new Error('retrieve() not implemented');
    }
}
