export const GENIMAGE_URL = 'https://prexzyapis.com/ai/genimage';
export const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';

export const GENIMAGE_DEFAULTS = Object.freeze({
  width: 1024,
  height: 1024,
  steps: 30,
});

export const GENIMAGE_LIMITS = Object.freeze({
  minDimension: 64,
  maxDimension: 2048,
  minSteps: 1,
  maxSteps: 100,
});

export const UNSPLASH_DEFAULTS = Object.freeze({
  perPage: 10,
});

export const UNSPLASH_LIMITS = Object.freeze({
  minPerPage: 1,
  maxPerPage: 30,
  minPage: 1,
  maxPage: 1000,
});
