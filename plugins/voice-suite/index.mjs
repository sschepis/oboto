import { OpenAIProvider } from './providers/openai.mjs';
import { ElevenLabsProvider } from './providers/elevenlabs.mjs';

export async function activate(api) {
  console.log(`[voice-suite] Activating plugin ${api.id}`);

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
        provider: { type: 'string', enum: ['openai', 'elevenlabs'], description: 'The provider to use (default: openai)' },
        voice: { type: 'string', description: 'The voice ID or name to use' }
      },
      required: ['text']
    },
    handler: async (args) => {
      const provider = args.provider || 'openai';
      if (provider === 'elevenlabs') {
        return await elevenLabsProvider.textToSpeech({
          text: args.text,
          voiceId: args.voice
        });
      } else {
        return await openAIProvider.textToSpeech({
          text: args.text,
          voice: args.voice
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

  console.log(`[voice-suite] Tools registered: text_to_speech, transcribe_audio, get_voices, clone_voice, generate_sound_effect`);
}

export function deactivate(api) {
  console.log(`[voice-suite] Deactivating plugin ${api.id}`);
}
