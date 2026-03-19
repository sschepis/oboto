// ToolBridge — converts ai-man ToolExecutor tools to lmscript ToolDefinition format
// lmscript's executeAgent() requires tools as ToolDefinition[] with Zod schemas,
// while ai-man's ToolExecutor provides OpenAI function-calling format with JSON Schema.

import { z } from 'zod';

/**
 * Bridges ai-man's ToolExecutor (OpenAI function-calling format) to
 * lmscript's ToolDefinition format (Zod schemas + execute functions).
 */
export class ToolBridge {
    /**
     * Cache for JSON Schema → Zod conversions.  Keyed by a deterministic
     * JSON.stringify of the input schema so identical schemas reuse the
     * same Zod type across calls and across tools.
     * @type {Map<string, import('zod').ZodType>}
     */
    static _zodCache = new Map();

    /** Maximum number of entries in the Zod schema cache before FIFO eviction. */
    static _zodCacheMaxSize = 500;

    /**
     * @param {object} toolExecutor — ai-man ToolExecutor instance
     * @param {object} context — execution context passed to toolExecutor.executeTool()
     *                           (e.g. { workingDir, ws, ... })
     */
    constructor(toolExecutor, context = {}) {
        this._toolExecutor = toolExecutor;
        this._context = context;
    }

    /**
     * Convert tools from the ToolExecutor into lmscript ToolDefinition[] format.
     *
     * @param {Object} [options]
     * @param {Set<string>|Array<string>} [options.filter] — if provided, only convert
     *        tools whose names are in this set/array. Reduces conversion overhead
     *        when only a subset of tools is needed.
     * @returns {Array<{name: string, description: string, parameters: z.ZodType, execute: (args: any) => Promise<any>}>}
     */
    toLmscriptTools(options = {}) {
        let openaiTools = this._toolExecutor.getAllToolDefinitions();

        // Filter to requested tool names if provided (#51)
        if (options.filter) {
            const filterSet = options.filter instanceof Set
                ? options.filter
                : new Set(options.filter);
            openaiTools = openaiTools.filter(t => filterSet.has(t.function?.name));
        }

        return openaiTools.map((tool) => {
            const fnDef = tool.function;
            const toolName = fnDef.name;

            return {
                name: toolName,
                description: fnDef.description || '',
                parameters: ToolBridge.jsonSchemaToZod(fnDef.parameters),
                execute: async (args) => {
                    try {
                        // ToolExecutor.executeTool() expects a toolCall object
                        // shaped like { id, function: { name, arguments } }
                        // where arguments is a JSON string.
                        // It returns { role, tool_call_id, name, content }.
                        const toolCall = {
                            id: `bridge-${Date.now()}`,
                            function: {
                                name: toolName,
                                arguments: JSON.stringify(args),
                            },
                        };
                        const result = await this._toolExecutor.executeTool(
                            toolCall,
                            this._context
                        );
                        // ToolExecutor returns errors inline in content prefixed with "[error]" or legacy "Error:"
                        if (
                            typeof result.content === 'string' &&
                            (result.content.startsWith('[error]') || result.content.startsWith('Error:'))
                        ) {
                            throw new Error(result.content);
                        }
                        return result.content;
                    } catch (err) {
                        throw new Error(
                            `ToolBridge: execution of "${toolName}" failed: ${err.message}`
                        );
                    }
                },
            };
        });
    }

    /**
     * Recursively convert a JSON Schema object to a Zod schema.
     *
     * Handles: object, string (with enum), number, integer, boolean,
     *          array, null, union types (e.g. ['string', 'null']), and
     *          falls back to z.any() for unknown types.
     *
     * @param {object} jsonSchema — JSON Schema definition
     * @returns {z.ZodType}
     */
    static jsonSchemaToZod(jsonSchema) {
        if (!jsonSchema || Object.keys(jsonSchema).length === 0) {
            return z.object({}).passthrough();
        }

        // Check cache for previously converted schemas (#50)
        const cacheKey = JSON.stringify(jsonSchema);
        const cached = ToolBridge._zodCache.get(cacheKey);
        if (cached) return cached;

        const schemaType = jsonSchema.type;
        let result;

        // Handle union types: type: ['string', 'null']
        if (Array.isArray(schemaType)) {
            const members = schemaType.map((t) =>
                ToolBridge.jsonSchemaToZod({ ...jsonSchema, type: t })
            );
            if (members.length === 0) result = z.any();
            else if (members.length === 1) result = members[0];
            else result = z.union(/** @type {[z.ZodType, z.ZodType, ...z.ZodType[]]} */ (members));
        } else {
            switch (schemaType) {
                case 'object':
                    result = ToolBridge._convertObjectSchema(jsonSchema);
                    break;

                case 'string':
                    result = ToolBridge._convertStringSchema(jsonSchema);
                    break;

                case 'number':
                case 'integer': {
                    let schema = z.number();
                    if (jsonSchema.description) schema = schema.describe(jsonSchema.description);
                    result = schema;
                    break;
                }

                case 'boolean': {
                    let schema = z.boolean();
                    if (jsonSchema.description) schema = schema.describe(jsonSchema.description);
                    result = schema;
                    break;
                }

                case 'array':
                    result = ToolBridge._convertArraySchema(jsonSchema);
                    break;

                case 'null': {
                    let schema = z.null();
                    if (jsonSchema.description) schema = schema.describe(jsonSchema.description);
                    result = schema;
                    break;
                }

                default:
                    result = z.any();
                    break;
            }
        }

        // Store in cache for reuse (#50) with FIFO eviction
        if (ToolBridge._zodCache.size >= ToolBridge._zodCacheMaxSize) {
            const firstKey = ToolBridge._zodCache.keys().next().value;
            ToolBridge._zodCache.delete(firstKey);
        }
        ToolBridge._zodCache.set(cacheKey, result);
        return result;
    }

    /**
     * Convert a JSON Schema object type to z.object().
     * @param {object} jsonSchema
     * @returns {z.ZodType}
     * @private
     */
    static _convertObjectSchema(jsonSchema) {
        const properties = jsonSchema.properties || {};
        const required = new Set(jsonSchema.required || []);
        const zodShape = {};

        for (const [key, propSchema] of Object.entries(properties)) {
            let zodProp = ToolBridge.jsonSchemaToZod(propSchema);

            // Apply description if present and not already applied by recursive call
            if (propSchema.description && !zodProp.description) {
                zodProp = zodProp.describe(propSchema.description);
            }

            // Mark optional if not in required array
            if (!required.has(key)) {
                zodProp = zodProp.optional();
            }

            zodShape[key] = zodProp;
        }

        let objectSchema = z.object(zodShape);

        // Allow additional properties unless explicitly disallowed
        if (jsonSchema.additionalProperties !== false) {
            objectSchema = objectSchema.passthrough();
        }

        if (jsonSchema.description) {
            objectSchema = objectSchema.describe(jsonSchema.description);
        }

        return objectSchema;
    }

    /**
     * Convert a JSON Schema string type (with optional enum) to Zod.
     * @param {object} jsonSchema
     * @returns {z.ZodType}
     * @private
     */
    static _convertStringSchema(jsonSchema) {
        let schema;
        if (jsonSchema.enum && jsonSchema.enum.length > 0) {
            schema = z.enum(/** @type {[string, ...string[]]} */ (jsonSchema.enum));
        } else {
            schema = z.string();
        }
        if (jsonSchema.description) {
            schema = schema.describe(jsonSchema.description);
        }
        return schema;
    }

    /**
     * Convert a JSON Schema array type to z.array().
     * @param {object} jsonSchema
     * @returns {z.ZodType}
     * @private
     */
    static _convertArraySchema(jsonSchema) {
        const itemSchema = jsonSchema.items
            ? ToolBridge.jsonSchemaToZod(jsonSchema.items)
            : z.any();
        let schema = z.array(itemSchema);
        if (jsonSchema.description) {
            schema = schema.describe(jsonSchema.description);
        }
        return schema;
    }
}
