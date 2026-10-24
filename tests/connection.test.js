import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoff,
  ConnectionManager,
  buildConnectionSuccessMessage,
  notifyOwnerConnectionSuccess,
  resolvePrivateOwnerJid,
} from '../connection/connection.js';
import { createLogger } from '../lib/logger.js';

test('computeBackoff grows exponentially and respects the ceiling', () => {
  const options = { baseDelayMs: 1000, maxDelayMs: 8000, jitter: 0.2, random: () => 0.5 };
  assert.equal(computeBackoff(1, options), 1000);
  assert.equal(computeBackoff(2, options), 2000);
  assert.equal(computeBackoff(3, options), 4000);
  assert.equal(computeBackoff(4, options), 8000);
  assert.equal(computeBackoff(20, options), 8000);
});

test('computeBackoff applies bounded jitter around the exponential value', () => {
  const base = { baseDelayMs: 1000, maxDelayMs: 60000, jitter: 0.2 };
  assert.equal(computeBackoff(2, { ...base, random: () => 0 }), 1600);
  assert.equal(computeBackoff(2, { ...base, random: () => 1 }), 2400);
  assert.equal(computeBackoff(2, { ...base, random: () => 0.5 }), 2000);
});

test('computeBackoff normalizes invalid attempts and never returns a negative delay', () => {
  const options = { baseDelayMs: 1000, maxDelayMs: 60000, jitter: 0.2, random: () => 0.5 };
  assert.equal(computeBackoff(0, options), 1000);
  assert.equal(computeBackoff(-4, options), 1000);
  assert.equal(computeBackoff(Number.NaN, options), 1000);
});

test('ConnectionManager starts idle and stop is idempotent', async () => {
  const manager = new ConnectionManager({
    config: {
      sessionDir: '/tmp/nexus-core-test-session',
      reconnect: { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 2 },
      auth: { method: 'qr', pairingNumber: '' },
    },
    logger: createLogger({ level: 'silent' }),
  });
  const states = [];
  manager.on('state', ({ state }) => states.push(state));
  assert.equal(manager.state, 'idle');
  assert.equal(manager.isOpen, false);
  assert.equal(manager.uptimeMs, 0);
  await manager.stop();
  await manager.stop();
  assert.equal(manager.state, 'closed');
  assert.deepEqual(states, ['closed']);
});

const OWNER = '2349159530797@s.whatsapp.net';

function createCapturingLogger() {
  const warnings = [];
  const errors = [];
  const logger = {
    warnings,
    errors,
    error(message) {
      errors.push(message);
    },
    warn(message) {
      warnings.push(message);
    },
    info() {},
    debug() {},
    child() {
      return logger;
    },
  };
  return logger;
}

function createTestManager(overrides = {}) {
  return new ConnectionManager({
    config: {
      sessionDir: '/tmp/nexus-core-test-session',
      reconnect: { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 2, jitter: 0 },
      auth: { method: 'qr', pairingNumber: '' },
      ownerJid: OWNER,
      prefix: '!',
      version: '1.0.0',
      botName: 'ΠΣXUS CΩRΣ',
      ...overrides.config,
    },
    logger: overrides.logger || createLogger({ level: 'silent' }),
    getCommandCount: overrides.getCommandCount ?? (() => 42),
  });
}

function createFakeSocket({ sendImpl } = {}) {
  const socket = {
    removeAllListenersCalls: 0,
    endCalls: 0,
    sent: [],
    ev: {
      removeAllListeners() {
        socket.removeAllListenersCalls += 1;
      },
    },
    end() {
      socket.endCalls += 1;
    },
    async sendMessage(jid, content) {
      if (sendImpl) return sendImpl(jid, content);
      socket.sent.push({ jid, content });
      return { key: { id: `sent-${socket.sent.length}` } };
    },
  };
  return socket;
}

async function flushOwnerNotify(manager) {
  if (manager._ownerNotifyPromise) await manager._ownerNotifyPromise;
}

test('close event from an obsolete socket cannot dispose the current socket, change state, or schedule a reconnect', async () => {
  const manager = createTestManager();
  const staleSocket = createFakeSocket();
  const currentSocket = createFakeSocket();

  // Install the current socket without opening a real WhatsApp connection.
  manager.socket = currentSocket;
  manager._setState('open');

  const events = [];
  manager.on('state', (e) => events.push(['state', e.state]));
  manager.on('socket-disposed', () => events.push(['socket-disposed']));
  manager.on('failed', () => events.push(['failed']));
  manager.on('logged-out', () => events.push(['logged-out']));

  try {
    // A non-permanent close code would normally schedule a reconnect.
    manager._handleUpdate(staleSocket, {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });

    assert.equal(manager.socket, currentSocket);
    assert.equal(manager.state, 'open');
    assert.equal(manager.reconnectTimer, null);
    assert.equal(manager.reconnectAttempt, 0);
    assert.equal(currentSocket.removeAllListenersCalls, 0);
    assert.equal(staleSocket.removeAllListenersCalls, 0);
    assert.deepEqual(events, []);
  } finally {
    await manager.stop(); // clears any timer so a failing run cannot hang
  }
});

test('close event from the current socket is still handled', async () => {
  const manager = createTestManager();
  const currentSocket = createFakeSocket();
  manager.socket = currentSocket;
  manager._setState('open');

  // loggedOut is permanent, so no reconnect timer is created.
  manager._handleUpdate(currentSocket, {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } },
  });

  assert.equal(manager.socket, null);
  assert.equal(manager.state, 'logged_out');
  assert.equal(currentSocket.removeAllListenersCalls, 1);
  assert.equal(manager.reconnectTimer, null);
});

test('resolvePrivateOwnerJid accepts only a private user JID', () => {
  assert.equal(resolvePrivateOwnerJid(OWNER), OWNER);
  assert.equal(resolvePrivateOwnerJid('2349159530797:12@s.whatsapp.net'), OWNER);
  assert.equal(resolvePrivateOwnerJid('123456789012345@lid'), '123456789012345@lid');
  assert.equal(resolvePrivateOwnerJid(null), null);
  assert.equal(resolvePrivateOwnerJid(''), null);
  assert.equal(resolvePrivateOwnerJid('not-a-jid'), null);
  assert.equal(resolvePrivateOwnerJid('120363000000000000@g.us'), null);
  assert.equal(resolvePrivateOwnerJid('status@broadcast'), null);
  assert.equal(resolvePrivateOwnerJid('123@broadcast'), null);
});

test('buildConnectionSuccessMessage uses live prefix, version and command count', () => {
  const text = buildConnectionSuccessMessage({
    botName: 'ΠΣXUS CΩRΣ',
    prefix: '!',
    version: '1.0.0',
    commandCount: 42,
  });
  assert.match(text, /ΠΣXUS CΩRΣ/);
  assert.match(text, /STATUS: ONLINE/);
  assert.match(text, /CONNECTION: SUCCESSFUL/);
  assert.match(text, /PREFIX: !/);
  assert.match(text, /VERSION: 1\.0\.0/);
  assert.match(text, /COMMANDS: 42/);
  assert.match(text, /SYSTEM: READY/);
  assert.equal(text.includes('▸'), false);
});

test('notifyOwnerConnectionSuccess sends only to the configured private owner', async () => {
  const socket = createFakeSocket();
  const result = await notifyOwnerConnectionSuccess({
    socket,
    config: { ownerJid: OWNER, prefix: '!', version: '1.0.0', botName: 'ΠΣXUS CΩRΣ' },
    commandCount: 7,
  });
  assert.equal(result.sent, true);
  assert.equal(result.jid, OWNER);
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].jid, OWNER);
  assert.match(socket.sent[0].content.text, /CONNECTION: SUCCESSFUL/);
  assert.match(socket.sent[0].content.text, /COMMANDS: 7/);
});

test('notifyOwnerConnectionSuccess skips missing or invalid owner JIDs without crashing', async () => {
  const socket = createFakeSocket();
  const logger = createCapturingLogger();
  for (const ownerJid of [null, '', 'not-a-jid', '120363000000000000@g.us', 'status@broadcast']) {
    const result = await notifyOwnerConnectionSuccess({
      socket,
      config: { ownerJid, prefix: '!' },
      logger,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'invalid-owner');
  }
  assert.equal(socket.sent.length, 0);
  assert.ok(logger.warnings.length >= 1);
  assert.match(logger.warnings[0], /Owner JID is missing or invalid/);
});

test('notifyOwnerConnectionSuccess swallows send failures without retrying', async () => {
  const logger = createCapturingLogger();
  const socket = createFakeSocket({
    sendImpl: async () => {
      throw new Error('network down');
    },
  });
  const result = await notifyOwnerConnectionSuccess({
    socket,
    config: { ownerJid: OWNER, prefix: '!' },
    logger,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'send-failed');
  assert.match(logger.warnings.join('\n'), /Owner connection notification failed/);
});

test('owner notification is sent after a successful connection', async () => {
  const manager = createTestManager();
  const socket = createFakeSocket();
  manager.socket = socket;
  manager._setState('connecting');

  manager._handleUpdate(socket, { connection: 'open' });
  await flushOwnerNotify(manager);

  assert.equal(manager.state, 'open');
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].jid, OWNER);
  assert.match(socket.sent[0].content.text, /STATUS: ONLINE/);
  assert.match(socket.sent[0].content.text, /PREFIX: !/);
  assert.match(socket.sent[0].content.text, /VERSION: 1\.0\.0/);
  assert.match(socket.sent[0].content.text, /COMMANDS: 42/);
  await manager.stop();
});

test('owner notification is not sent before authentication succeeds', async () => {
  const manager = createTestManager();
  const socket = createFakeSocket();
  manager.socket = socket;
  manager._setState('connecting');

  manager._handleUpdate(socket, { qr: 'qr-payload' });
  manager._handleUpdate(socket, { connection: 'connecting' });
  await flushOwnerNotify(manager);

  assert.equal(socket.sent.length, 0);
  assert.notEqual(manager.state, 'open');
  await manager.stop();
});

test('duplicate open events do not send duplicate owner notifications', async () => {
  const manager = createTestManager();
  const socket = createFakeSocket();
  manager.socket = socket;
  manager._setState('connecting');

  manager._handleUpdate(socket, { connection: 'open' });
  manager._handleUpdate(socket, { connection: 'open' });
  manager._handleUpdate(socket, { connection: 'open' });
  await flushOwnerNotify(manager);

  assert.equal(socket.sent.length, 1);
  await manager.stop();
});

test('a genuine reconnection notifies the owner again', async () => {
  const manager = createTestManager();
  const first = createFakeSocket();
  manager.socket = first;
  manager._setState('connecting');
  manager._handleUpdate(first, { connection: 'open' });
  await flushOwnerNotify(manager);
  assert.equal(first.sent.length, 1);

  manager._handleUpdate(first, {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 500 } } },
  });
  assert.equal(manager.state, 'reconnecting');
  if (manager.reconnectTimer) {
    clearTimeout(manager.reconnectTimer);
    manager.reconnectTimer = null;
  }

  const second = createFakeSocket();
  manager.socket = second;
  manager._handleUpdate(second, { connection: 'open' });
  await flushOwnerNotify(manager);

  assert.equal(second.sent.length, 1);
  assert.equal(second.sent[0].jid, OWNER);
  assert.match(second.sent[0].content.text, /CONNECTION: SUCCESSFUL/);
  await manager.stop();
});

test('missing owner JID on open logs a warning and does not crash', async () => {
  const logger = createCapturingLogger();
  const manager = createTestManager({
    config: { ownerJid: null },
    logger,
  });
  const socket = createFakeSocket();
  manager.socket = socket;
  manager._setState('connecting');

  manager._handleUpdate(socket, { connection: 'open' });
  await flushOwnerNotify(manager);

  assert.equal(manager.state, 'open');
  assert.equal(socket.sent.length, 0);
  assert.match(logger.warnings.join('\n'), /Owner JID is missing or invalid/);
  await manager.stop();
});

test('owner notification send failure keeps the connection open without retries', async () => {
  const logger = createCapturingLogger();
  let sendCalls = 0;
  const manager = createTestManager({ logger });
  const socket = createFakeSocket({
    sendImpl: async () => {
      sendCalls += 1;
      throw new Error('wa send failed');
    },
  });
  manager.socket = socket;
  manager._setState('connecting');

  manager._handleUpdate(socket, { connection: 'open' });
  await flushOwnerNotify(manager);
  manager._handleUpdate(socket, { connection: 'open' });
  await flushOwnerNotify(manager);

  assert.equal(manager.state, 'open');
  assert.equal(sendCalls, 1);
  assert.match(logger.warnings.join('\n'), /Owner connection notification failed/);
  await manager.stop();
});
