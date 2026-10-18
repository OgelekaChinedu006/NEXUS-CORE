const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function timestamp() {
  return new Date().toISOString();
}

function write(stream, level, scope, message, meta) {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]${scope ? ` [${scope}]` : ''}`;
  if (meta === undefined) {
    stream.write(`${prefix} ${message}\n`);
    return;
  }
  let serialized;
  try {
    serialized = JSON.stringify(meta);
  } catch {
    serialized = '[unserializable metadata]';
  }
  stream.write(`${prefix} ${message} ${serialized}\n`);
}

export function createLogger({ level = 'info', scope = '' } = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;

  const logger = {
    level,
    error(message, meta) {
      if (threshold >= LEVELS.error) write(process.stderr, 'error', scope, message, meta);
    },
    warn(message, meta) {
      if (threshold >= LEVELS.warn) write(process.stderr, 'warn', scope, message, meta);
    },
    info(message, meta) {
      if (threshold >= LEVELS.info) write(process.stdout, 'info', scope, message, meta);
    },
    debug(message, meta) {
      if (threshold >= LEVELS.debug) write(process.stdout, 'debug', scope, message, meta);
    },
    child(childScope) {
      return createLogger({ level, scope: scope ? `${scope}:${childScope}` : childScope });
    },
  };

  return logger;
}
