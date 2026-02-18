export const ENHANCEMENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "evaluate_response_quality",
            description: "Evaluates whether the AI's response appropriately addresses the user's original query and resembles what a typical, helpful response should look like.",
            parameters: {
                type: "object",
                properties: {
                    original_query: {
                        type: "string",
                        description: "The user's original request/question."
                    },
                    ai_response: {
                        type: "string",
                        description: "The AI's generated response to evaluate."
                    },
                    quality_rating: {
                        type: "number",
                        minimum: 1,
                        maximum: 10,
                        description: "Quality rating from 1-10 where 10 = perfect response that fully addresses the query, 1 = completely inappropriate/unhelpful response."
                    },
                    evaluation_reasoning: {
                        type: "string",
                        description: "Brief explanation of why this rating was given."
                    },
                    remedy_suggestion: {
                        type: "string",
                        description: "If rating < 4, specific suggestion on how to improve the response or what should be done differently."
                    }
                },
                required: ["original_query", "ai_response", "quality_rating", "evaluation_reasoning"],
            },
        },
    }
];
