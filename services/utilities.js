import { fetchText } from '../lib/http.js';
import { CommandError, isHttpUrl } from '../lib/helpers.js';

export class UtilityService {
  constructor(logger) {
    this.logger = logger;
  }

  async shorten(url) {
    if (!isHttpUrl(url)) throw new CommandError('Provide a full http(s) URL to shorten.');
    if (String(url).length > 2000) throw new CommandError('That URL is too long.');
    const endpoint = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`;
    const result = (await fetchText(endpoint, { timeoutMs: 15000 })).trim();
    if (!result || /^error/i.test(result) || !isHttpUrl(result)) {
      throw new CommandError('The shortener rejected that URL.');
    }
    return result;
  }
}
