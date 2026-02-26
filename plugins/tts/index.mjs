/**
 * Oboto TTS Plugin
 *
 * Provides text-to-speech via the ElevenLabs API.
 * Extracted from src/execution/handlers/workflow-handlers.mjs (speakText method)
 * and src/tools/definitions/tts-tools.mjs.
 *
 * @module @oboto/plugin-tts
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import os from 'os';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

const execFileAsync = util.promisify(execFile);

// ── Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    elevenlabsApiKey: '',
    defaultVoiceId: '21m00Tcm4TlvDq8ikWAM',
    defaultModel: 'eleven_monolingual_v1',
    outputFormat: 'mp3_44100_128',
};

const SETTINGS_SCHEMA = [
    {
        key: 'elevenlabsApiKey',
        label: 'ElevenLabs API Key',
        type: 'password',
        description: 'ElevenLabs API key',
        default: '',
    },
    {
        key: 'defaultVoiceId',
        label: 'Default Voice ID',
        type: 'text',
        description: 'Default voice ID',
        default: '21m00Tcm4TlvDq8ikWAM',
    },
    {
        key: 'defaultModel',
        label: 'Default TTS Model',
        type: 'select',
        description: 'Default TTS model',
        default: 'eleven_monolingual_v1',
        options: [
            { value: 'eleven_monolingual_v1', label: 'Monolingual v1' },
            { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
            { value: 'eleven_turbo_v2', label: 'Turbo v2' },
        ],
    },
    {
        key: 'outputFormat',
        label: 'Output Audio Format',
        type: 'select',
        description: 'Output audio format',
        default: 'mp3_44100_128',
        options: [
            { value: 'mp3_44100_128', label: 'MP3 44.1kHz 128kbps' },
            { value: 'mp3_44100_192', label: 'MP3 44.1kHz 192kbps' },
            { value: 'pcm_16000', label: 'PCM 16kHz' },
            { value: 'pcm_24000', label: 'PCM 24kHz' },
        ],
    },
];

// ── Tool Handler ─────────────────────────────────────────────────────────

async function handleSpeakText(apiKey, pluginSettings, args) {
    const {
        text,
        voice_id,
        stability = 0.5,
        similarity_boost = 0.75
    } = args;

    const voiceId = voice_id || pluginSettings.defaultVoiceId;
    const modelId = pluginSettings.defaultModel;

    if (!apiKey) {
        return 'Error: ElevenLabs API key is not configured. Set ELEVENLABS_API_KEY or configure in plugin settings.';
    }

    try {
        // Clean the text (remove markdown formatting)
        const cleanText = text
            .replace(/```[\s\S]*?```/g, '')       // Remove code blocks
            .replace(/`[^`]+`/g, '')               // Remove inline code
            .replace(/\*\*([^*]+)\*\*/g, '$1')     // Remove bold markdown
            .replace(/\*([^*]+)\*/g, '$1')         // Remove italic markdown
            .replace(/#{1,6}\s+/g, '')             // Remove headers
            .replace(/\|[^|\n]*\|/g, '')           // Remove table rows
            .replace(/\n+/g, ' ')                  // Replace newlines with spaces
            .trim();

        // Call ElevenLabs API
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            body: JSON.stringify({
                text: cleanText,
                model_id: modelId,
                voice_settings: {
                    stability,
                    similarity_boost
                }
            })
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
        }

        // Save audio file
        const audioBuffer = await response.arrayBuffer();
        const audioFilePath = path.join(process.cwd(), 'temp_speech.mp3');

        fs.writeFileSync(audioFilePath, Buffer.from(audioBuffer));

        // Play audio (platform-specific)
        const platform = os.platform();

        if (platform === 'darwin') {
            await execFileAsync('afplay', [audioFilePath]);
        } else if (platform === 'linux') {
            // Try mpg123 first, fall back to aplay, then paplay
            try {
                await execFileAsync('mpg123', [audioFilePath]);
            } catch {
                try {
                    await execFileAsync('aplay', [audioFilePath]);
                } catch {
                    await execFileAsync('paplay', [audioFilePath]);
                }
            }
        } else if (platform === 'win32') {
            // On Windows, use PowerShell with execFile (no shell interpolation)
            await execFileAsync('powershell', ['-c', `(New-Object Media.SoundPlayer '${audioFilePath.replace(/'/g, "''")}').PlaySync()`]);
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        // Clean up temp file
        setTimeout(() => {
            try {
                fs.unlinkSync(audioFilePath);
            } catch (_e) {
                // Ignore cleanup errors
            }
        }, 1000);

        return `Text converted to speech and played successfully. Used voice ${voiceId} with ${cleanText.length} characters.`;

    } catch (error) {
        return `Error converting text to speech: ${error.message}`;
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    // Pre-create instance object to avoid race condition with onSettingsChange callback
    const instanceState = { settings: null };
    api.setInstance(instanceState);

    const { pluginSettings } = await registerSettingsHandlers(
        api, 'tts', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
        () => {
            instanceState.settings = pluginSettings;
        }
    );

    instanceState.settings = pluginSettings;

    // Resolve API key: plugin settings first, then environment variable
    const getApiKey = async () =>
        (await api.settings.get('elevenlabsApiKey')) || process.env.ELEVENLABS_API_KEY || '';

    api.tools.register({
        useOriginalName: true,
        name: 'speak_text',
        description:
            'Converts text to speech using ElevenLabs and plays it aloud. Use this when the user asks to hear the response spoken or wants text-to-speech.',
        parameters: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'The text to convert to speech. Should be clean text without markdown formatting.'
                },
                voice_id: {
                    type: 'string',
                    description: `ElevenLabs voice ID to use. Default is '${pluginSettings.defaultVoiceId}'.`,
                    default: pluginSettings.defaultVoiceId
                },
                stability: {
                    type: 'number',
                    description: 'Voice stability (0.0-1.0). Higher values = more stable. Default: 0.5',
                    minimum: 0.0,
                    maximum: 1.0,
                    default: 0.5
                },
                similarity_boost: {
                    type: 'number',
                    description: 'Similarity boost (0.0-1.0). Higher values = more similar to original voice. Default: 0.75',
                    minimum: 0.0,
                    maximum: 1.0,
                    default: 0.75
                }
            },
            required: ['text']
        },
        handler: async (args) => handleSpeakText(await getApiKey(), pluginSettings, args)
    });

}

export async function deactivate(api) {
    api.setInstance(null);
}
