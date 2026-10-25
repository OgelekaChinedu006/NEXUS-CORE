import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { BOT_NAME } from '../config/config.js';
import { isUserJid, normalizeJid } from '../lib/helpers.js';

const PERMANENT_CLOSE_CODES = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.forbidden,
  DisconnectReason.connectionReplaced,
]);

const CONNECTION_STATES = new Set([
  'idle',
  'connecting',
  'pairing',
  'qr',
  'open',
  'reconnecting',
  'closed',
  'logged_out',
  'conflict',
  'failed',
]);

export function resolvePrivateOwnerJid(value) {
  const jid = normalizeJid(value);
  if (!jid || !isUserJid(jid)) return null;
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) {
    return null;
  }
  return jid;
}

export function buildConnectionSuccessMessage({
  botName = BOT_NAME,
  prefix = '!',
  version,
  commandCount,
} = {}) {
  const lines = [
    `╭━━━〔 ${botName || BOT_NAME} 〕━━━╮`,
    '┃ STATUS: ONLINE',
    '┃ CONNECTION: SUCCESSFUL',
    `┃ PREFIX: ${prefix || '!'}`,
  ];
  if (version) lines.push(`┃ VERSION: ${version}`);
  if (commandCount != null && Number.isFinite(Number(commandCount))) {
    lines.push(`┃ COMMANDS: ${Number(commandCount)}`);
  }
  lines.push('┃ SYSTEM: READY', '╰━━━━━━━━━━━━━━━━━━━━╯');
  return lines.join('\n');
}

export async function notifyOwnerConnectionSuccess({
  socket,
  config,
  logger,
  commandCount,
} = {}) {
  const ownerJid = resolvePrivateOwnerJid(config?.ownerJid);
  if (!ownerJid) {
    logger?.warn('Owner JID is missing or invalid; connection notification skipped.');
    return { sent: false, reason: 'invalid-owner' };
  }
  if (!socket || typeof socket.sendMessage !== 'function') {
    logger?.warn('No socket available for owner connection notification.');
    return { sent: false, reason: 'no-socket' };
  }

  const text = buildConnectionSuccessMessage({
    botName: config?.botName,
    prefix: config?.prefix,
    version: config?.version,
    commandCount,
  });

  try {
    await socket.sendMessage(ownerJid, { text });
    return { sent: true, jid: ownerJid };
  } catch (error) {
    logger?.warn(`Owner connection notification failed: ${error.message}`);
    return { sent: false, reason: 'send-failed' };
  }
}

export function computeBackoff(attempt, {
  baseDelayMs = 3000,
  maxDelayMs = 60000,
  jitter = 0.2,
  random = Math.random,
} = {}) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (safeAttempt - 1));
  const spread = exponential * Math.max(0, Math.min(1, jitter));
  const value = exponential - spread + random() * spread * 2;
  return Math.max(0, Math.round(value));
}

function closeCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ??
    lastDisconnect?.error?.statusCode ??
    lastDisconnect?.error?.output?.payload?.statusCode ??
    null
  );
}

export class ConnectionManager extends EventEmitter {
  constructor({ config, logger, getCommandCount } = {}) {
    super();
    this.config = config;
    this.logger = logger;
    this.getCommandCount = typeof getCommandCount === 'function' ? getCommandCount : null;
    this.socket = null;
    this.state = 'idle';
    this.started = false;
    this.stopping = false;
    this.starting = false;
    this.reconnectTimer = null;
    this.pairingTimer = null;
    this.pairingRequested = false;
    this.pairingFailed = false;
    this.reconnectAttempt = 0;
    this.openedAt = null;
    this._ownerNotifySentForOpen = false;
    this._ownerNotifyInFlight = false;
    this._ownerNotifyPromise = null;
    this.baileysLogger = pino({ level: 'silent' });
  }

  get isOpen() {
    return this.state === 'open' && Boolean(this.socket);
  }

  get uptimeMs() {
    return this.openedAt ? Date.now() - this.openedAt : 0;
  }

  _setState(next) {
    if (!CONNECTION_STATES.has(next)) throw new Error(`Unknown connection state: ${next}`);
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.emit('state', { state: next, previous });
  }

  async start() {
    if (this.stopping) return;
    if (this.starting || ['connecting', 'pairing', 'qr', 'open', 'reconnecting'].includes(this.state)) {
      return;
    }
    this.started = true;
    this.starting = true;
    this._setState('connecting');
    try {
      await this._connect();
    } catch (error) {
      this.logger.error(`Socket creation failed: ${error.message}`);
      this._scheduleReconnect(false);
    } finally {
      this.starting = false;
    }
  }

  async _connect() {
    if (this.stopping) return;
    this._replaceSocket(null);
    fs.mkdirSync(this.config.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionDir);

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (error) {
      this.logger.warn(`Could not fetch the latest WA version; using the Baileys default.`);
    }

    if (this.stopping) return;

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      logger: this.baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    if (this.stopping) {
      try {
        socket.end(undefined);
      } catch {
        // Abandoned before listeners were attached.
      }
      return;
    }
    this._replaceSocket(socket);
    this.pairingRequested = false;
    this.pairingFailed = false;

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => this._handleUpdate(socket, update));
    this.emit('socket', socket);

    if (
      this.config.auth.method === 'pairing' &&
      this.config.auth.pairingNumber &&
      !state.creds.registered
    ) {
      this._requestPairingCode(socket);
    }
  }

  _requestPairingCode(socket) {
    if (this.pairingRequested || this.pairingTimer) return;
    this.pairingRequested = true;
    this._setState('pairing');
    this.pairingTimer = setTimeout(async () => {
      this.pairingTimer = null;
      if (this.socket !== socket || this.state === 'open' || this.stopping) return;
      try {
        const code = await socket.requestPairingCode(this.config.auth.pairingNumber);
        if (!code) throw new Error('empty pairing code');
        process.stdout.write(
          [
            '',
            '╭━━━〔 PAIRING CODE 〕━━━╮',
            `┃ ${code}`,
            '╰━━━━━━━━━━━━━━━━━━━━╯',
            'Enter this code in WhatsApp > Linked Devices.',
            'This code is shown once and is never written to logs or disk.',
            '',
          ].join('\n'),
        );
        this.emit('pairing-code');
      } catch (error) {
        this.pairingFailed = true;
        this.logger.warn(`Pairing-code request failed: ${error.message}`);
        this.emit('pairing-failed');
      }
    }, 3000);
  }

  _handleUpdate(socket, { connection, lastDisconnect, qr, isNewLogin }) {
    // Ignore events from a socket that is no longer the current one.
    if (this.socket !== socket) return;

    if (qr) {
      this.emit('qr');
      if (this.config.auth.method === 'qr' || this.pairingFailed) {
        this._setState('qr');
        qrcode.generate(qr, { small: true }, (rendered) => {
          process.stdout.write(`\n${rendered}\nScan with WhatsApp > Linked Devices.\n\n`);
        });
      }
    }

    if (connection === 'open') {
      this.reconnectAttempt = 0;
      this.openedAt = Date.now();
      this.pairingFailed = false;
      if (this.pairingTimer) {
        clearTimeout(this.pairingTimer);
        this.pairingTimer = null;
      }
      this._setState('open');
      this.logger.info('Connection opened.');
      if (isNewLogin) this.logger.info('New WhatsApp session registered.');
      this._notifyOwnerOnOpen(socket);
      this.emit('ready', this.socket);
      return;
    }

    if (connection === 'close') {
      const code = closeCode(lastDisconnect);
      this.openedAt = null;
      this._resetOwnerNotifyGate();
      this._disposeSocket();
      if (this.stopping) {
        this._setState('closed');
        return;
      }

      if (code === DisconnectReason.loggedOut) {
        this._setState('logged_out');
        this.logger.error('WhatsApp session logged out. Manual reauthentication is required; no reconnect will be attempted.');
        this.emit('logged-out', { code });
        return;
      }

      if (code === DisconnectReason.forbidden) {
        this._setState('failed');
        this.logger.error('WhatsApp rejected this session (403). No reconnect loop will be started.');
        this.emit('failed', { code, permanent: true });
        return;
      }

      if (code === DisconnectReason.connectionReplaced) {
        this._setState('conflict');
        this.logger.error('Connection replaced by another session. This socket will stay closed to prevent duplicates.');
        this.emit('conflict', { code });
        return;
      }

      if (PERMANENT_CLOSE_CODES.has(code)) {
        this._setState('failed');
        this.emit('failed', { code, permanent: true });
        return;
      }

      this.logger.warn(`Connection closed${code ? ` (code ${code})` : ''}; scheduling recovery.`);
      this._scheduleReconnect(code === DisconnectReason.restartRequired);
    }
  }

  _scheduleReconnect(immediate = false) {
    if (this.stopping || this.reconnectTimer) return;
    if (this.reconnectAttempt >= this.config.reconnect.maxAttempts) {
      this._setState('failed');
      this.logger.error(
        `Reconnect limit reached (${this.config.reconnect.maxAttempts} attempts). Awaiting manual reawakening.`,
      );
      this.emit('failed', { code: null, permanent: false, exhausted: true });
      return;
    }

    this.reconnectAttempt += 1;
    const delay = immediate
      ? 0
      : computeBackoff(this.reconnectAttempt, this.config.reconnect);

    this._setState('reconnecting');
    this.logger.info(`Reconnect attempt ${this.reconnectAttempt}/${this.config.reconnect.maxAttempts} in ${delay}ms.`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopping) return;
      this.starting = true;
      this._connect()
        .catch((error) => {
          this.logger.error(`Reconnect failed: ${error.message}`);
          this._scheduleReconnect(false);
        })
        .finally(() => {
          this.starting = false;
        });
    }, delay);
  }

  _endSocket(socket) {
    if (!socket) return;
    try {
      socket.end(undefined);
    } catch (error) {
      this.logger?.debug?.(`Socket end failed: ${error.message}`);
    }
  }

  _disposeSocket() {
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer);
      this.pairingTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.ev.removeAllListeners();
    } catch {
      // Already disposed.
    }
    this.emit('socket-disposed', socket);
  }

  _replaceSocket(nextSocket) {
    const previous = this.socket;
    if (previous && previous !== nextSocket) {
      this._disposeSocket();
      this._endSocket(previous);
    }
    this.socket = nextSocket;
  }

  _clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer);
      this.pairingTimer = null;
    }
  }

  async _awaitOwnerNotify() {
    if (!this._ownerNotifyPromise) return;
    try {
      await this._ownerNotifyPromise;
    } catch {
      // Notification failures are already logged.
    }
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.started = false;
    this._clearTimers();
    await this._awaitOwnerNotify();
    const socket = this.socket;
    this._disposeSocket();
    this._endSocket(socket);
    this._setState('closed');
    this.logger.info('Connection stopped.');
  }

  async restart() {
    if (this.starting) return;
    this.stopping = true;
    this._clearTimers();
    await this._awaitOwnerNotify();
    const socket = this.socket;
    this._disposeSocket();
    this._endSocket(socket);
    this.stopping = false;
    this.started = false;
    this.starting = false;
    this.reconnectAttempt = 0;
    this.openedAt = null;
    this._resetOwnerNotifyGate();
    this._setState('idle');
    await this.start();
  }

  _resolveCommandCount() {
    if (typeof this.getCommandCount !== 'function') return null;
    try {
      const value = this.getCommandCount();
      const count = Number(value);
      return Number.isFinite(count) ? count : null;
    } catch {
      return null;
    }
  }

  _resetOwnerNotifyGate() {
    this._ownerNotifySentForOpen = false;
    this._ownerNotifyInFlight = false;
  }

  _notifyOwnerOnOpen(socket) {
    if (this.stopping) return;
    if (this._ownerNotifySentForOpen || this._ownerNotifyInFlight) return;
    this._ownerNotifySentForOpen = true;
    this._ownerNotifyInFlight = true;
    this._ownerNotifyPromise = notifyOwnerConnectionSuccess({
      socket,
      config: this.config,
      logger: this.logger,
      commandCount: this._resolveCommandCount(),
    })
      .catch((error) => {
        this.logger.warn(`Owner connection notification failed: ${error.message}`);
        return { sent: false, reason: 'send-failed' };
      })
      .finally(() => {
        this._ownerNotifyInFlight = false;
      });
  }
}