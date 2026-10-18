import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoff, ConnectionManager } from '../connection/connection.js';
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

function createTestManager() {
  return new ConnectionManager({
    config: {
      sessionDir: '/tmp/nexus-core-test-session',
      reconnect: { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 2, jitter: 0 },
      auth: { method: 'qr', pairingNumber: '' },
    },
    logger: createLogger({ level: 'silent' }),
  });
}

function createFakeSocket() {
  const socket = {
    removeAllListenersCalls: 0,
    endCalls: 0,
    ev: {
      removeAllListeners() {
        socket.removeAllListenersCalls += 1;
      },
    },
    end() {
      socket.endCalls += 1;
    },
  };
  return socket;
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