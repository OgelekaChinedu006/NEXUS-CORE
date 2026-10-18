import { fetchJson } from '../lib/http.js';
import { CommandError } from '../lib/helpers.js';

const LANG_PATTERN = /^(auto|[a-z]{2,3}(?:-[a-z]{2,4})?)$/i;

function translateEndpoint(baseUrl) {
  if (!baseUrl) return '';
  if (baseUrl.endsWith('/translate')) return baseUrl;
  return `${baseUrl}/translate`;
}

export class TranslationService {
  constructor(config) {
    this.config = config.translation;
  }

  get provider() {
    return this.config.apiUrl ? 'LibreTranslate' : 'MyMemory';
  }

  async translate({ text, source = 'auto', target }) {
    if (!text || !String(text).trim()) throw new CommandError('There is no text to transmute.');
    if (!LANG_PATTERN.test(source) || !LANG_PATTERN.test(target) || target === 'auto') {
      throw new CommandError('Use valid language codes, for example: en, es, fr, pt-BR.');
    }
    if (String(text).length > 5000) {
      throw new CommandError('The text is too large for a single transmutation.');
    }

    if (this.config.apiUrl) {
      const payload = {
        q: String(text),
        source,
        target,
        format: 'text',
      };
      if (this.config.apiKey) payload.api_key = this.config.apiKey;
      const data = await fetchJson(translateEndpoint(this.config.apiUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: this.config.timeoutMs,
      });
      if (!data?.translatedText) throw new CommandError('The translation service returned nothing.');
      return { text: data.translatedText, provider: 'LibreTranslate', target };
    }

    if (source === 'auto') {
      throw new CommandError(
        'Automatic language detection requires TRANSLATE_API_URL (LibreTranslate). Without it, name the source language: !lingua <from> <to> <text>.',
      );
    }

    const params = new URLSearchParams({
      q: String(text),
      langpair: `${source}|${target}`,
    });
    const data = await fetchJson(`https://api.mymemory.translated.net/get?${params}`, {
      timeoutMs: this.config.timeoutMs,
    });
    const translated = data?.responseData?.translatedText;
    if (!translated) throw new CommandError('The translation service returned nothing.');
    if (String(data.responseStatus) !== '200') {
      throw new CommandError('The translation service rejected this language pair.');
    }
    return { text: translated, provider: 'MyMemory', target };
  }
}
