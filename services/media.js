import { fetchJson } from '../lib/http.js';
import { CommandError } from '../lib/helpers.js';

function imageGenerationEndpoint(baseUrl) {
  if (!baseUrl) return '';
  if (baseUrl.endsWith('/images/generations')) return baseUrl;
  return `${baseUrl}/images/generations`;
}

export class MediaService {
  constructor(config, logger) {
    this.config = config.media;
    this.logger = logger;
  }

  get imageGenerationAvailable() {
    return Boolean(this.config.imageApiUrl && this.config.imageApiKey && this.config.imageModel);
  }

  async generateImage(prompt) {
    if (!this.imageGenerationAvailable) {
      throw new CommandError(
        'Image manifestation is dormant. Configure IMAGE_API_URL, IMAGE_API_KEY and IMAGE_MODEL.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(imageGenerationEndpoint(this.config.imageApiUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.imageApiKey}`,
        },
        body: JSON.stringify({
          model: this.config.imageModel,
          prompt: String(prompt).slice(0, 2000),
          n: 1,
          size: '1024x1024',
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new CommandError('The image service rejected its credentials.');
      }
      if (response.status === 429) {
        throw new CommandError('The image service is rate limiting requests. Try again later.');
      }
      if (!response.ok) {
        throw new CommandError(`The image service failed with HTTP ${response.status}.`);
      }
      const data = await response.json();
      const item = data?.data?.[0];
      if (item?.b64_json) {
        return { buffer: Buffer.from(item.b64_json, 'base64') };
      }
      if (item?.url) {
        return { url: item.url };
      }
      throw new CommandError('The image service returned no image.');
    } catch (error) {
      if (error instanceof CommandError) throw error;
      if (error?.name === 'AbortError') throw new CommandError('Image manifestation timed out.');
      throw new CommandError('The image service could not be reached.');
    } finally {
      clearTimeout(timer);
    }
  }

  async searchRelic(query) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: String(query).slice(0, 200),
      gsrnamespace: '6',
      gsrlimit: '5',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '1024',
      format: 'json',
      origin: '*',
    });
    const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, {
      timeoutMs: 15000,
    });
    const pages = Object.values(data?.query?.pages || {});
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      const url = info?.thumburl || info?.url;
      if (!url) continue;
      return {
        title: String(page.title || '').replace(/^File:/i, ''),
        url,
        description: info?.extmetadata?.ImageDescription?.value
          ? String(info.extmetadata.ImageDescription.value).replace(/<[^>]+>/g, '').slice(0, 400)
          : '',
        source: 'Wikimedia Commons',
      };
    }
    throw new CommandError('No relic answered that search.');
  }

  async searchKnowledge(query) {
    const searchParams = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: String(query).slice(0, 200),
      srlimit: '1',
      format: 'json',
      origin: '*',
    });
    const search = await fetchJson(`https://en.wikipedia.org/w/api.php?${searchParams}`, {
      timeoutMs: 15000,
    });
    const title = search?.query?.search?.[0]?.title;
    if (!title) throw new CommandError('No knowledge answered that search.');

    const summary = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { timeoutMs: 15000 },
    );
    return {
      title: summary.title || title,
      extract: summary.extract || '',
      url: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      thumbnail: summary.thumbnail?.source || null,
    };
  }

  async getWaifu(kind = 'waifu') {
    if (!['waifu', 'neko'].includes(kind)) throw new CommandError('Unknown relic type.');
    const data = await fetchJson(`${this.config.waifuApiUrl}/sfw/${kind}`, { timeoutMs: 15000 });
    if (!data?.url) throw new CommandError('The relic service returned no image.');
    return data.url;
  }
}
