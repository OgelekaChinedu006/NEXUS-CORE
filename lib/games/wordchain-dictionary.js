import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORD_PATTERN = /^[a-z]{3,32}$/;

export const WORD_CHAIN_WORD_LIST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'wordchain-words.txt',
);

export function parseWordList(text) {
  const words = new Set();
  if (typeof text !== 'string') return words;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const word = trimmed.toLowerCase();
    if (WORD_PATTERN.test(word)) words.add(word);
  }
  return words;
}

export function loadWordSet(filePath = WORD_CHAIN_WORD_LIST_PATH) {
  return parseWordList(fs.readFileSync(filePath, 'utf8'));
}

const knownWords = loadWordSet();

export function isKnownWord(word, words = knownWords) {
  if (typeof word !== 'string') return false;
  const normalized = word.trim().toLowerCase();
  return WORD_PATTERN.test(normalized) && words.has(normalized);
}
