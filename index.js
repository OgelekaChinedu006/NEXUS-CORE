import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from './config/config.js';
import { createLogger } from './lib/logger.js';
import { NexusDatabase } from './lib/database.js';
import { loadCommands } from './lib/registry.js';
import { createHandler } from './handler/handler.js';
import { ConnectionManager } from './connection/connection.js';
import { createServices } from './services/index.js';

async function main() {
  const config = createConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  const db = new NexusDatabase(config.dbPath);
  const registry = await loadCommands(config.commandsDir, logger);
  const services = createServices(config, logger);
  const connection = new ConnectionManager({
    config,
    logger,
    getCommandCount: () => registry.size,
  });
  const handler = createHandler({ config, db, logger, registry, connection, services });

  connection.on('socket', (socket) => handler.attach(socket));
  connection.on('state', ({ state }) => logger.debug(`Connection state: ${state}`));
  connection.on('logged-out', () => {
    logger.error('Reauthentication required: delete the session only after understanding the logout, then restart.');
  });
  connection.on('conflict', () => {
    logger.error('Another session owns this WhatsApp connection. Shut it down before starting NEXUS CORE.');
  });

  if (!config.ownerJid) {
    logger.warn('OWNER_JID is not configured. Owner-only commands will remain sealed.');
  }
  logger.info(`${config.botName} v${config.version} awakened with ${registry.size} commands.`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      logger.warn('Forced shutdown requested.');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`${signal} received; releasing the vessel gracefully.`);
    try {
      handler.shutdown();
      await connection.stop();
    } catch (error) {
      logger.error(`Shutdown error: ${error.message}`);
    } finally {
      try {
        db.close();
      } catch (error) {
        logger.error(`Database close error: ${error.message}`);
      }
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    void shutdown('uncaughtException');
  });

  await connection.start();
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
