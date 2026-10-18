import { fetchJson } from '../lib/http.js';
import { CommandError, truncate } from '../lib/helpers.js';

const BASE = 'https://api.jikan.moe/v4';

export class AnimeService {
  constructor(logger) {
    this.logger = logger;
    this.cache = new Map();
  }

  async cached(key, loader) {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = await loader();
    this.cache.set(key, { value, expiresAt: now + 5 * 60_000 });
    if (this.cache.size > 100) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    return value;
  }

  async searchAnime(query) {
    const key = `anime:${query.toLowerCase()}`;
    return this.cached(key, async () => {
      const params = new URLSearchParams({ q: query, limit: '1', sfw: 'true' });
      const data = await fetchJson(`${BASE}/anime?${params}`, { timeoutMs: 20000 });
      const anime = data?.data?.[0];
      if (!anime) throw new CommandError('No anime answered that query.');
      return {
        title: anime.title_english || anime.title || 'Unknown title',
        originalTitle: anime.title_japanese || '',
        synopsis: truncate(anime.synopsis || 'No synopsis recorded.', 1200),
        episodes: anime.episodes || 'unknown',
        score: anime.score ?? 'unrated',
        year: anime.year || (anime.aired?.prop?.from?.year ?? 'unknown'),
        status: anime.status || 'unknown',
        genres: (anime.genres || []).map((genre) => genre.name).join(', ') || 'unclassified',
        url: anime.url || '',
        image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null,
      };
    });
  }

  async searchCharacter(query) {
    const key = `character:${query.toLowerCase()}`;
    return this.cached(key, async () => {
      const params = new URLSearchParams({ q: query, limit: '1' });
      const data = await fetchJson(`${BASE}/characters?${params}`, { timeoutMs: 20000 });
      const character = data?.data?.[0];
      if (!character) throw new CommandError('No vessel answered that name.');
      return {
        name: character.name || 'Unknown vessel',
        nicknames: (character.nicknames || []).join(', ') || 'none',
        about: truncate((character.about || 'No lore recorded.').replace(/\s+/g, ' '), 1200),
        favorites: character.favorites ?? 0,
        url: character.url || '',
        image: character.images?.jpg?.image_url || null,
      };
    });
  }

  async randomAnime() {
    const data = await fetchJson(`${BASE}/random/anime`, { timeoutMs: 20000 });
    const anime = data?.data;
    if (!anime) throw new CommandError('The anime oracle returned nothing.');
    return {
      title: anime.title_english || anime.title || 'Unknown title',
      synopsis: truncate(anime.synopsis || 'No synopsis recorded.', 900),
      score: anime.score ?? 'unrated',
      year: anime.year || 'unknown',
      url: anime.url || '',
      image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null,
    };
  }
}
