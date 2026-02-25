import * as https from 'https';
import { Buffer } from 'buffer';

export class OpenAIProvider {
  constructor(api) {
    this.api = api;
  }

  async getApiKey() {
    // In oboto, plugins might use api.settings for API keys instead of api.secrets
    const apiKey = await this.api.settings.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please set your API key in plugin settings.');
    }
    return apiKey;
  }

  async textToSpeech({ text, voice }) {
    const apiKey = await this.getApiKey();
    const defaultVoice = await this.api.settings.get('openaiDefaultVoice') || 'alloy';
    const selectedVoice = voice || defaultVoice;

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/speech',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            const buffer = Buffer.concat(chunks);
            reject(new Error(`OpenAI TTS Error: ${res.statusCode} - ${buffer.toString()}`));
            return;
          }
          const buffer = Buffer.concat(chunks);
          resolve({
            success: true,
            audioData: buffer.toString('base64'),
            format: 'mp3',
            provider: 'openai',
            voice: selectedVoice
          });
        });
      });

      req.on('error', reject);

      req.write(JSON.stringify({
        model: "tts-1",
        voice: selectedVoice,
        input: text,
      }));
      req.end();
    });
  }

  async transcribeAudio({ audioBuffer }) {
    const apiKey = await this.getApiKey();
    
    const boundary = '----OpenAIWhisperBoundary' + Math.random().toString(16);
    const filename = 'recording.wav';
    
    let content = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`),
      Buffer.from(audioBuffer),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': content.length
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 400) {
             reject(new Error(`OpenAI STT Error: ${res.statusCode} - ${buffer.toString()}`));
             return;
          }
          try {
            const data = JSON.parse(buffer.toString());
            resolve({ text: data.text });
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.write(content);
      req.end();
    });
  }
}
