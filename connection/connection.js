import { EventEmitter } from 'node:events';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

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
  constructor({ config, logger }) {
    super();
    this.config = config;
    this.logger = logger;
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

    this.socket = socket;
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
      this.emit('ready', this.socket);
      return;
    }

    if (connection === 'close') {
      const code = closeCode(lastDisconnect);
      this.openedAt = null;
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

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.started = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer);
      this.pairingTimer = null;
    }
    const socket = this.socket;
    this._disposeSocket();
    if (socket) {
      try {
        socket.end(undefined);
      } catch (error) {
        this.logger.debug(`Socket end during shutdown failed: ${error.message}`);
      }
    }
    this._setState('closed');
    this.logger.info('Connection stopped.');
  }

  async restart() {
    if (this.starting) return;
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this._disposeSocket();
    if (socket) {
      try {
        socket.end(undefined);
      } catch {
        // Ignore.
      }
    }
    this.stopping = false;
    this.started = false;
    this.starting = false;
    this.reconnectAttempt = 0;
    this.openedAt = null;
    this._setState('idle');
    await this.start();
  }
}