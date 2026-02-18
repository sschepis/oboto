export const TTS_TOOLS = [
    {
        type: "function",
        function: {
            name: "speak_text",
            description: "Converts text to speech using ElevenLabs and plays it aloud. Use this when the user asks to hear the response spoken or wants text-to-speech.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "The text to convert to speech. Should be clean text without markdown formatting."
                    },
                    voice_id: {
                        type: "string",
                        description: "ElevenLabs voice ID to use. Default is 'tQ4MEZFJOzsahSEEZtHK'.",
                        default: "tQ4MEZFJOzsahSEEZtHK"
                    },
                    stability: {
                        type: "number",
                        description: "Voice stability (0.0-1.0). Higher values = more stable. Default: 0.5",
                        minimum: 0.0,
                        maximum: 1.0,
                        default: 0.5
                    },
                    similarity_boost: {
                        type: "number",
                        description: "Similarity boost (0.0-1.0). Higher values = more similar to original voice. Default: 0.75",
                        minimum: 0.0,
                        maximum: 1.0,
                        default: 0.75
                    }
                },
                required: ["text"],
            },
        },
    }
];
