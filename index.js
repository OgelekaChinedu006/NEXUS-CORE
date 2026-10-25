import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig, inspectOwnerJid } from './config/config.js';
import { createLogger } from './lib/logger.js';
import { NexusDatabase } from './lib/database.js';
import { loadCommands } from './lib/registry.js';
import { createHandler } from './handler/handler.js';
import { ConnectionManager } from './connection/connection.js';
import { createServices } from './services/index.js';
import { ensureStorage, InstanceLock } from './lib/storage.js';
import { loadEnv } from './lib/env.js';

function warnOwnerJid(logger, env) {
  const inspection = inspectOwnerJid(env.OWNER_JID);
  if (inspection.jid) return;
  if (!inspection.configured) {
    logger.warn('OWNER_JID is not configured. Owner-only commands will remain sealed.');
    return;
  }
  const hints = {
    malformed: 'OWNER_JID is malformed. Use digits plus @s.whatsapp.net (example 447700900123@s.whatsapp.net).',
    'not-private': 'OWNER_JID must be a private user JID, not a group, broadcast, or newsletter.',
    'unsupported-domain': 'OWNER_JID must use @s.whatsapp.net or @lid.',
  };
  logger.warn(hints[inspection.reason] || 'OWNER_JID is invalid. Owner-only commands will remain sealed.');
}

async function main() {
  loadEnv();
  const config = createConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  ensureStorage(config);
  const lock = new InstanceLock(path.join(config.sessionDir, config.instanceLockFile));
  lock.acquire();

  let db = null;
  let handler = null;
  let connection = null;
  let shuttingDown = false;

  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) {
      logger.warn('Forced shutdown requested.');
      lock.release();
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`${signal} received; releasing the vessel gracefully.`);
    try {
      handler?.shutdown();
      if (connection) await connection.stop();
    } catch (error) {
      logger.error(`Shutdown error: ${error.message}`);
    } finally {
      try {
        db?.close();
      } catch (error) {
        logger.error(`Database close error: ${error.message}`);
      }
      lock.release();
      process.exit(exitCode);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    void shutdown('uncaughtException', 1);
  });

  try {
    db = new NexusDatabase(config.dbPath);
    const registry = await loadCommands(config.commandsDir, logger);
    const services = createServices(config, logger);
    connection = new ConnectionManager({
      config,
      logger,
      getCommandCount: () => registry.size,
    });
    handler = createHandler({ config, db, logger, registry, connection, services });

    connection.on('socket', (socket) => handler.attach(socket));
    connection.on('state', ({ state }) => logger.debug(`Connection state: ${state}`));
    connection.on('logged-out', () => {
      logger.error('Reauthentication required: delete the session only after understanding the logout, then restart.');
      void shutdown('logged-out', 0);
    });
    connection.on('conflict', () => {
      logger.error('Another session owns this WhatsApp connection. Shut it down before starting NEXUS CORE.');
      void shutdown('conflict', 0);
    });
    connection.on('failed', ({ exhausted, permanent } = {}) => {
      if (exhausted) {
        logger.error('Reconnect attempts exhausted. Exiting so the process supervisor can retry later.');
        void shutdown('reconnect-exhausted', 1);
        return;
      }
      if (permanent) {
        logger.error('Permanent WhatsApp failure. The process will stay stopped until the session is repaired.');
        void shutdown('permanent-failure', 0);
      }
    });

    warnOwnerJid(logger, process.env);
    logger.info(`${config.botName} v${config.version} awakened with ${registry.size} commands.`);
    await connection.start();
  } catch (error) {
    lock.release();
    try {
      db?.close();
    } catch {
      // Best-effort close after a failed start.
    }
    throw error;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const current = fileURLToPath(import.meta.url);
if (entry === current) {
  main().catch((error) => {
    process.stderr.write(`[fatal] ${error.stack || error.message}\n`);
    process.exit(1);
  });
}

export { main };
