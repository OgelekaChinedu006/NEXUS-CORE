import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PERMISSION_LEVELS } from './permissions.js';

export const CATEGORY_LABELS = Object.freeze({
  general: 'SHRINE',
  domain: 'DOMAIN CONTROL',
  security: 'SECURITY',
  sovereign: 'SOVEREIGN',
  'atlas-rune': 'ATLAS RUNES',
  economy: 'ECONOMY',
  fun: 'CURSES & GAMES',
  ai: 'CURSED INTELLIGENCE',
  media: 'RELICS & MEDIA',
  anime: 'ANIME & ART',
  utility: 'UTILITY',
});

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);
const NAME_PATTERN = /^[a-z][a-z0-9]{1,31}$/;

export class CommandRegistryError extends Error {}

async function collectFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizePermissions(permissions) {
  if (permissions === undefined) return ['public'];
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new CommandRegistryError('permissions must be a non-empty array');
  }
  for (const permission of permissions) {
    if (!(permission in PERMISSION_LEVELS)) {
      throw new CommandRegistryError(`unknown permission "${permission}"`);
    }
  }
  return [...new Set(permissions)];
}

function validateCommand(command, filePath) {
  if (!command || typeof command !== 'object') {
    throw new CommandRegistryError(`${filePath}: module must default-export an object`);
  }
  if (!NAME_PATTERN.test(command.name || '')) {
    throw new CommandRegistryError(`${filePath}: invalid command name "${command.name}"`);
  }
  if (typeof command.description !== 'string' || command.description.length < 3) {
    throw new CommandRegistryError(`${filePath}: description is required`);
  }
  if (typeof command.category !== 'string' || !command.category) {
    throw new CommandRegistryError(`${filePath}: category is required`);
  }
  if (typeof command.usage !== 'string' || !command.usage) {
    throw new CommandRegistryError(`${filePath}: usage is required`);
  }
  if (typeof command.execute !== 'function') {
    throw new CommandRegistryError(`${filePath}: execute function is required`);
  }
  const aliases = command.aliases === undefined ? [] : command.aliases;
  if (!Array.isArray(aliases) || aliases.some((alias) => !NAME_PATTERN.test(alias))) {
    throw new CommandRegistryError(`${filePath}: aliases must be valid command names`);
  }

  return Object.freeze({
    ...command,
    aliases: [...aliases],
    permissions: normalizePermissions(command.permissions),
    cooldownMs: Math.max(0, Number(command.cooldownMs) || 0),
    source: filePath,
  });
}

export class CommandRegistry {
  constructor(logger) {
    this.logger = logger;
    this.byName = new Map();
    this.byAlias = new Map();
    this.loadedAt = null;
  }

  get size() {
    return this.byName.size;
  }

  all() {
    return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(nameOrAlias) {
    const key = String(nameOrAlias || '').toLowerCase();
    return this.byName.get(key) || this.byAlias.get(key) || null;
  }

  categories() {
    const grouped = new Map();
    for (const command of this.all()) {
      if (!grouped.has(command.category)) grouped.set(command.category, []);
      grouped.get(command.category).push(command);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => {
        const leftIndex = CATEGORY_ORDER.indexOf(left);
        const rightIndex = CATEGORY_ORDER.indexOf(right);
        return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
      })
      .map(([id, commands]) => ({
        id,
        label: CATEGORY_LABELS[id] || id.toUpperCase(),
        commands,
      }));
  }

  async load(commandsDir) {
    const files = await collectFiles(commandsDir);
    const nextByName = new Map();
    const nextByAlias = new Map();
    const errors = [];
    const version = Date.now();

    for (const filePath of files.sort()) {
      try {
        const moduleUrl = `${pathToFileURL(filePath).href}?v=${version}`;
        const imported = await import(moduleUrl);
        const command = validateCommand(imported.default, filePath);
        if (nextByName.has(command.name)) {
          throw new CommandRegistryError(`duplicate command name "${command.name}"`);
        }
        nextByName.set(command.name, command);
        for (const alias of command.aliases) {
          if (alias === command.name || nextByName.has(alias) || nextByAlias.has(alias)) {
            throw new CommandRegistryError(`alias "${alias}" conflicts with another command`);
          }
          nextByAlias.set(alias, command);
        }
      } catch (error) {
        errors.push(error);
        this.logger.error(`Failed to load command module ${path.relative(process.cwd(), filePath)}: ${error.message}`);
      }
    }

    for (const [alias, command] of nextByAlias) {
      if (nextByName.has(alias)) {
        errors.push(new CommandRegistryError(`alias "${alias}" shadows command "${command.name}"`));
      }
    }

    if (errors.length) {
      throw new CommandRegistryError(`Command registry rejected ${errors.length} module(s).`);
    }

    this.byName = nextByName;
    this.byAlias = nextByAlias;
    this.loadedAt = version;
    return this;
  }
}

export async function loadCommands(commandsDir, logger) {
  const registry = new CommandRegistry(logger);
  await registry.load(commandsDir);
  return registry;
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
