import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { inspectOwnerJid } from '../config/config.js';

export class EnvInitError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'EnvInitError';
    if (code) this.code = code;
  }
}

export function resolveProjectRoot(moduleUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..');
}

export function pairingDigits(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[^\d]/g, '');
}

function fillEmptyAssignment(content, key, value) {
  if (!key || value === undefined || value === null || value === '') return content;
  const pattern = new RegExp(`^${key}=$`, 'm');
  if (!pattern.test(content)) return content;
  return content.replace(pattern, `${key}=${value}`);
}

export function applyKnownIdentity(template, source = {}) {
  let next = template;
  const owner = inspectOwnerJid(source.OWNER_JID);
  if (owner.jid) {
    next = fillEmptyAssignment(next, 'OWNER_JID', owner.jid);
  }
  const pairing = pairingDigits(source.PAIRING_NUMBER);
  if (pairing) {
    next = fillEmptyAssignment(next, 'PAIRING_NUMBER', pairing);
  }
  return next;
}

export function initializeEnv({
  rootDir,
  envFileName = '.env',
  exampleFileName = '.env.example',
  source = process.env,
  fsImpl = fs,
} = {}) {
  if (!rootDir) {
    throw new EnvInitError('Cannot initialize environment: project root is unknown.');
  }

  const envPath = path.join(rootDir, envFileName);
  const examplePath = path.join(rootDir, exampleFileName);

  try {
    fsImpl.accessSync(envPath, fsImpl.constants?.F_OK ?? fs.constants.F_OK);
    return { created: false, path: envPath };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new EnvInitError(
        `Cannot access ${envFileName} at ${envPath}: ${error.message}. Check permissions and retry.`,
      );
    }
  }

  let template;
  try {
    template = fsImpl.readFileSync(examplePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new EnvInitError(
        `Missing ${exampleFileName} at ${examplePath}. Restore the template from the repository, then restart.`,
        { code: 'MISSING_EXAMPLE' },
      );
    }
    throw new EnvInitError(
      `Cannot read ${exampleFileName} at ${examplePath}: ${error.message}. Check permissions and retry.`,
    );
  }

  const content = applyKnownIdentity(template, source);
  const flags =
    (fsImpl.constants?.O_CREAT ?? fs.constants.O_CREAT) |
    (fsImpl.constants?.O_EXCL ?? fs.constants.O_EXCL) |
    (fsImpl.constants?.O_WRONLY ?? fs.constants.O_WRONLY);

  let fd;
  try {
    fd = fsImpl.openSync(envPath, flags, 0o600);
    fsImpl.writeSync(fd, content);
  } catch (error) {
    if (fd !== undefined) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // Close is best-effort after a failed write.
      }
      fd = undefined;
      try {
        fsImpl.unlinkSync(envPath);
      } catch {
        // Incomplete file removal is best-effort.
      }
    }
    if (error.code === 'EEXIST') {
      return { created: false, path: envPath };
    }
    throw new EnvInitError(
      `Failed to create ${envFileName} from ${exampleFileName}: ${error.message}. Check that the project root is writable.`,
    );
  } finally {
    if (fd !== undefined) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // Already closed.
      }
    }
  }

  return { created: true, path: envPath };
}

export function loadEnv(options = {}) {
  const rootDir = options.rootDir || resolveProjectRoot();
  const result = initializeEnv({ ...options, rootDir });
  const loaded = dotenv.config({
    path: result.path,
    override: false,
  });
  if (loaded.error && loaded.error.code !== 'ENOENT') {
    throw new EnvInitError(
      `Failed to load ${result.path}: ${loaded.error.message}. Fix the file and restart.`,
    );
  }
  return result;
}
