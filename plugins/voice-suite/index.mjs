import { OpenAIProvider } from './providers/openai.mjs';
import { ElevenLabsProvider } from './providers/elevenlabs.mjs';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultProvider: 'openai',
  defaultVoice: '',
  openaiApiKey: '',
  elevenlabsApiKey: '',
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable voice suite', default: true },
  { key: 'defaultProvider', label: 'Default TTS Provider', type: 'select', description: 'Default text-to-speech provider', default: 'openai', options: ['openai', 'elevenlabs'] },
  { key: 'defaultVoice', label: 'Default Voice', type: 'text', description: 'Default voice ID or name (provider-specific)', default: '' },
  { key: 'openaiApiKey', label: 'OpenAI API Key', type: 'password', description: 'API key for OpenAI TTS and Whisper (overrides global key)', default: '' },
  { key: 'elevenlabsApiKey', label: 'ElevenLabs API Key', type: 'password', description: 'API key for ElevenLabs voice services', default: '' },
];

export async function activate(api) {
  consoleStyler.log('plugin', `Activating plugin ${api.id}`);

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'voice-suite', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

  const openAIProvider = new OpenAIProvider(api);
  const elevenLabsProvider = new ElevenLabsProvider(api);

  api.tools.register({
    name: 'text_to_speech',
    description: 'Convert text to speech using either OpenAI or ElevenLabs. Returns the path to the generated audio file or base64 data.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to convert to speech' },
        provider: { type: 'string', enum: ['openai', 'elevenlabs'], description: 'The provider to use (default: from settings)' },
        voice: { type: 'string', description: 'The voice ID or name to use' }
      },
      required: ['text']
    },
    handler: async (args) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Voice suite plugin is disabled' };
      }
      const provider = args.provider || pluginSettings.defaultProvider;
      const voice = args.voice || pluginSettings.defaultVoice || undefined;
      if (provider === 'elevenlabs') {
        return await elevenLabsProvider.textToSpeech({
          text: args.text,
          voiceId: voice
        });
      } else {
        return await openAIProvider.textToSpeech({
          text: args.text,
          voice: voice
        });
      }
    }
  });

  api.tools.register({
    name: 'transcribe_audio',
    description: 'Transcribe audio to text using OpenAI Whisper. Provide audio data as a buffer.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        audioBuffer: { type: 'object', description: 'The audio buffer to transcribe (must pass as Buffer object)' }
      },
      required: ['audioBuffer']
    },
    handler: async (args) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Voice suite plugin is disabled' };
      }
      return await openAIProvider.transcribeAudio({
        audioBuffer: args.audioBuffer
      });
    }
  });

  api.tools.register({
    name: 'get_voices',
    description: 'Get available voices from ElevenLabs',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Force refresh from API instead of using cache' }
      }
    },
    handler: async (args) => {
      return await elevenLabsProvider.getVoices({ refresh: args.refresh });
    }
  });

  api.tools.register({
    name: 'clone_voice',
    description: 'Clone a voice (currently not fully implemented)',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async (args) => {
      return await elevenLabsProvider.cloneVoice(args);
    }
  });

  api.tools.register({
    name: 'generate_sound_effect',
    description: 'Generate sound effects (currently not fully implemented)',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async (args) => {
      return await elevenLabsProvider.generateSoundEffect(args);
    }
  });

  consoleStyler.log('plugin', `Tools registered: text_to_speech, transcribe_audio, get_voices, clone_voice, generate_sound_effect`);
}

export function deactivate(api) {
  consoleStyler.log('plugin', `Deactivating plugin ${api.id}`);
}
