import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as https from 'https';

const ELEVENLABS_API_BASE = 'api.elevenlabs.io';

export class ElevenLabsProvider {
  constructor(api) {
    this.api = api;
    this.outputDir = path.join(os.tmpdir(), 'aleph-voice-suite');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    this.voicesCache = null;
    this.voicesCacheTime = 0;
    this.CACHE_TTL = 5 * 60 * 1000;
  }

  async getApiKey() {
    let apiKey = await this.api.settings.get('ELEVENLABS_API_KEY');
    if (!apiKey) {
      apiKey = await this.api.settings.get('elevenlabsApiKey');
    }
    if (!apiKey) {
      apiKey = await this.api.settings.get('apiKey');
    }
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured. Please set your API key in plugin settings.');
    }
    return apiKey;
  }

  async makeRequest(method, endpoint, data = null, isFormData = false) {
    const apiKey = await this.getApiKey();
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: ELEVENLABS_API_BASE,
        port: 443,
        path: endpoint,
        method: method,
        headers: {
          'xi-api-key': apiKey,
          'Accept': 'application/json'
        }
      };

      let reqData = data;

      if (data && !isFormData) {
        options.headers['Content-Type'] = 'application/json';
      }

      if (isFormData && data.headers) {
          options.headers = { ...options.headers, ...data.headers };
          reqData = data.body;
      }

      const req = https.request(options, (res) => {
        const chunks = [];
        
        res.on('data', (chunk) => chunks.push(chunk));
        
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const contentType = res.headers['content-type'] || '';
          
          if (res.statusCode && res.statusCode >= 400) {
            let errorMessage;
            try {
              const errorBody = JSON.parse(buffer.toString());
              errorMessage = errorBody.detail?.message || errorBody.message || buffer.toString();
            } catch {
              errorMessage = buffer.toString() || `HTTP ${res.statusCode}`;
            }
            reject(new Error(`ElevenLabs API error (${res.statusCode}): ${errorMessage}`));
            return;
          }
          
          if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
            resolve({ type: 'audio', data: buffer, contentType });
          } else {
            try {
              resolve({ type: 'json', data: JSON.parse(buffer.toString()) });
            } catch {
              resolve({ type: 'text', data: buffer.toString() });
            }
          }
        });
      });

      req.on('error', reject);
      
      if (reqData) {
        if (isFormData) {
          req.write(reqData);
        } else {
          req.write(JSON.stringify(reqData));
        }
      }
      
      req.end();
    });
  }

  async getVoiceSettings() {
    const stability = (await this.api.settings.get('stability')) ?? 0.5;
    const similarityBoost = (await this.api.settings.get('similarityBoost')) ?? 0.75;
    const style = (await this.api.settings.get('style')) ?? 0;
    const useSpeakerBoost = (await this.api.settings.get('useSpeakerBoost')) ?? true;
    
    return {
      stability,
      similarity_boost: similarityBoost,
      style,
      use_speaker_boost: useSpeakerBoost
    };
  }

  generateFilename(prefix, format) {
    const id = crypto.randomBytes(8).toString('hex');
    const ext = format.startsWith('mp3') ? 'mp3' : 'wav';
    return path.join(this.outputDir, `${prefix}_${id}.${ext}`);
  }

  async textToSpeech({ text, voiceId, model, stability, similarityBoost, style, useSpeakerBoost }) {
    const defaultVoiceId = await this.api.settings.get('elevenlabsDefaultVoiceId') || '21m00Tcm4TlvDq8ikWAM';
    const defaultModel = 'eleven_multilingual_v2';
    const defaultFormat = 'mp3_44100_128';
    
    const finalVoiceId = voiceId || defaultVoiceId;
    const finalModel = model || defaultModel;
    const finalFormat = defaultFormat;
    
    const voiceSettings = await this.getVoiceSettings();
    
    const requestBody = {
      text,
      model_id: finalModel,
      voice_settings: {
        stability: stability ?? voiceSettings.stability,
        similarity_boost: similarityBoost ?? voiceSettings.similarity_boost,
        style: style ?? voiceSettings.style,
        use_speaker_boost: useSpeakerBoost ?? voiceSettings.use_speaker_boost
      }
    };

    const response = await this.makeRequest(
      'POST',
      `/v1/text-to-speech/${finalVoiceId}?output_format=${finalFormat}`,
      requestBody
    );

    if (response.type !== 'audio') {
      throw new Error('Unexpected response type from ElevenLabs API');
    }

    const filename = this.generateFilename('tts', finalFormat);
    await fs.promises.writeFile(filename, response.data);

    const estimatedDuration = Math.ceil(text.split(' ').length / 2.5);

    return {
      success: true,
      audioFile: filename,
      format: finalFormat,
      voiceId: finalVoiceId,
      model: finalModel,
      textLength: text.length,
      estimatedDurationSeconds: estimatedDuration,
      message: `Generated speech saved to ${filename}`,
      provider: 'elevenlabs'
    };
  }

  async getVoices({ refresh = false } = {}) {
     if (!refresh && this.voicesCache && (Date.now() - this.voicesCacheTime) < this.CACHE_TTL) {
      return this.voicesCache;
    }

    const response = await this.makeRequest('GET', '/v1/voices');
    
    if (response.type !== 'json') {
      throw new Error('Unexpected response from voices endpoint');
    }

    const voices = response.data.voices.map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category,
      description: voice.description,
      previewUrl: voice.preview_url,
      labels: voice.labels,
      settings: voice.settings
    }));

    this.voicesCache = { voices, count: voices.length };
    this.voicesCacheTime = Date.now();

    return this.voicesCache;
  }
  
  async cloneVoice(args) {
      throw new Error("Clone voice not yet implemented in consolidated plugin");
  }
  
  async generateSoundEffect(args) {
       throw new Error("Sound effect generation not yet implemented in consolidated plugin");
  }
}
