import fs from 'node:fs';
import path from 'node:path';

export function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function assertWritableDirectory(dirPath) {
  ensureDirectory(dirPath);
  fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
  const probe = path.join(dirPath, `.nexus-write-${process.pid}`);
  try {
    fs.writeFileSync(probe, String(process.pid), { flag: 'w' });
  } finally {
    try {
      fs.unlinkSync(probe);
    } catch {
      // Probe removal is best-effort.
    }
  }
  return dirPath;
}

export function ensureStorage(config) {
  const dbDir = path.dirname(config.dbPath);
  if (config.dbPath !== ':memory:') {
    assertWritableDirectory(dbDir);
  }
  assertWritableDirectory(config.sessionDir);
  return {
    dbDir: config.dbPath === ':memory:' ? null : dbDir,
    sessionDir: config.sessionDir,
  };
}

function readLockPid(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

export class InstanceLock {
  constructor(lockPath) {
    this.lockPath = lockPath;
    this.held = false;
  }

  acquire() {
    ensureDirectory(path.dirname(this.lockPath));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const fd = fs.openSync(
          this.lockPath,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
          0o600,
        );
        try {
          fs.writeSync(fd, `${process.pid}\n`);
        } finally {
          fs.closeSync(fd);
        }
        this.held = true;
        return this;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!this._reclaimStale()) {
          const pid = readLockPid(this.lockPath);
          const locked = new Error(
            `Another NEXUS CORE instance already holds this WhatsApp session${pid ? ` (pid ${pid})` : ''}.`,
          );
          locked.code = 'INSTANCE_LOCK';
          throw locked;
        }
      }
    }
    const failed = new Error('Could not acquire the WhatsApp session instance lock.');
    failed.code = 'INSTANCE_LOCK';
    throw failed;
  }

  _reclaimStale() {
    const pid = readLockPid(this.lockPath);
    if (pidIsAlive(pid)) return false;
    try {
      fs.unlinkSync(this.lockPath);
      return true;
    } catch (error) {
      return error.code === 'ENOENT';
    }
  }

  release() {
    if (!this.held) return;
    this.held = false;
    try {
      if (readLockPid(this.lockPath) === process.pid) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Lock file may already be gone.
    }
  }
}
