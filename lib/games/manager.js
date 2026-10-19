import crypto from 'node:crypto';
import { CommandError, normalizeJid } from '../helpers.js';

/**
 * Per-chat game session manager.
 *
 * One session per chat. A session owns its timers, which are cleared when the
 * session ends or the manager shuts down, and which only fire while that exact
 * session (by id) is still the current one for its chat.
 *
 * A game object only needs `onText(session, input, api)`. `api` offers:
 *   api.send(content, options) -> resolves the socket at call time; never throws;
 *                                 returns null when nothing could be sent.
 *   api.end()                  -> ends this session (no-op if already replaced/ended).
 */
export class GameManager {
  constructor({ getSocket = () => null, logger = null } = {}) {
    this.getSocket = typeof getSocket === 'function' ? getSocket : () => null;
    this.logger = logger;
    this.sessions = new Map();
  }

  start(chatJid, { type, game, starterJid = null, data = {}, socket = null } = {}) {
    if (!chatJid || typeof chatJid !== 'string') {
      throw new TypeError('A game session needs a chat JID.');
    }
    if (!game || typeof game.onText !== 'function') {
      throw new TypeError('A game must provide an onText(session, input, api) function.');
    }
    const existing = this.sessions.get(chatJid);
    if (existing) {
      throw new CommandError(
        `A ${existing.type} game is already running in this chat. Finish it or end it with endgame first.`,
      );
    }

    const session = {
      id: crypto.randomUUID(),
      chatJid,
      type: String(type || 'game'),
      game,
      starterJid: normalizeJid(starterJid),
      data,
      startedAt: Date.now(),
      socket: socket || this.#currentSocket(),
      ended: false,
      timers: new Map(),
    };
    session.setTimer = (name, ms, fn) => this.#setTimer(session, name, ms, fn);
    session.clearTimer = (name) => this.#clearTimer(session, name);
    session.api = {
      send: (content, options) => this.#send(session, content, options),
      end: () => this.#finish(session),
    };

    this.sessions.set(chatJid, session);
    return session;
  }

  get(chatJid) {
    return this.sessions.get(chatJid) || null;
  }

  hasSession(chatJid) {
    return this.sessions.has(chatJid);
  }

  /** Ends the chat's session (clearing its timers). Returns it, or null if none. */
  end(chatJid) {
    const session = this.sessions.get(chatJid);
    if (!session) return null;
    this.#finish(session);
    return session;
  }

  /**
   * Routes a plain (non-command) message to the chat's game, if any.
   * Resolves true when a session handled it, false otherwise. Never rejects:
   * errors thrown by a game are logged and isolated.
   */
  async handleText(input) {
    const chatJid = input?.chatJid;
    const session = chatJid ? this.sessions.get(chatJid) : null;
    if (!session) return false;
    try {
      await session.game.onText(session, input, session.api);
    } catch (error) {
      this.#logError(`Game "${session.type}" failed in handleText: ${error?.message}`);
    }
    return true;
  }

  shutdown() {
    for (const session of [...this.sessions.values()]) this.#finish(session);
    this.sessions.clear();
  }

  #currentSocket() {
    try {
      return this.getSocket() || null;
    } catch {
      return null;
    }
  }

  #logError(message) {
    try {
      this.logger?.error?.(message);
    } catch {
      // Logging must never break game handling.
    }
  }

  #finish(session) {
    const wasCurrent = this.sessions.get(session.chatJid) === session;
    if (wasCurrent) this.sessions.delete(session.chatJid);
    session.ended = true;
    for (const timer of session.timers.values()) clearTimeout(timer);
    session.timers.clear();
    return wasCurrent;
  }

  #clearTimer(session, name) {
    const timer = session.timers.get(name);
    if (timer === undefined) return false;
    clearTimeout(timer);
    session.timers.delete(name);
    return true;
  }

  #setTimer(session, name, ms, fn) {
    if (typeof fn !== 'function') throw new TypeError('A session timer needs a callback.');
    if (!Number.isFinite(ms) || ms < 0) throw new TypeError('A session timer needs a non-negative delay.');
    if (session.ended) return false;
    this.#clearTimer(session, name);

    const timer = setTimeout(() => {
      if (session.timers.get(name) === timer) session.timers.delete(name);
      const current = this.sessions.get(session.chatJid);
      if (session.ended || !current || current.id !== session.id) return;
      try {
        const result = fn(session, session.api);
        if (result && typeof result.then === 'function') {
          result.then(undefined, (error) => {
            this.#logError(`Game "${session.type}" timer "${name}" failed: ${error?.message}`);
          });
        }
      } catch (error) {
        this.#logError(`Game "${session.type}" timer "${name}" failed: ${error?.message}`);
      }
    }, ms);
    timer?.unref?.();
    session.timers.set(name, timer);
    return true;
  }

  async #send(session, content, options) {
    try {
      const socket = this.#currentSocket() || session.socket;
      if (!socket || typeof socket.sendMessage !== 'function') return null;
      const payload = typeof content === 'string' ? { text: content } : content;
      if (!payload || typeof payload !== 'object') return null;
      return await socket.sendMessage(session.chatJid, payload, options ?? undefined);
    } catch (error) {
      try {
        this.logger?.warn?.(`Game message failed: ${error?.message}`);
      } catch {
        // Ignore logger failures.
      }
      return null;
    }
  }
}

export function createGameManager(options = {}) {
  return new GameManager(options);
}
