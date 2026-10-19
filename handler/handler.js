import { getContentType, isJidGroup } from '@whiskeysockets/baileys';
import { errorResponse, compactFrame, fullFrame, welcomeMessage, goodbyeMessage } from '../lib/formatter.js';
import {
  CommandError,
  displayMention,
  formatTimestamp,
  normalizeJid,
  nowSeconds,
  randomInt,
  sanitizeField,
  truncate,
  withTimeout,
} from '../lib/helpers.js';
import { isGroupAdmin, isBotAdmin, checkPermissions, describePermissions } from '../lib/permissions.js';
import { warnUser } from '../lib/moderation.js';
import { createGameManager } from '../lib/games/manager.js';

const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
];

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/i;

export function unwrapMessage(message, depth = 0) {
  if (!message || depth > 6) return message;
  for (const key of WRAPPER_KEYS) {
    if (message[key]?.message) {
      return unwrapMessage(message[key].message, depth + 1);
    }
  }
  return message;
}

export function getMessageText(message) {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped) return '';
  const type = getContentType(unwrapped);
  if (!type) return '';
  const content = unwrapped[type];
  if (typeof content === 'string') return content;
  return (
    content?.text ||
    content?.caption ||
    content?.conversation ||
    content?.selectedDisplayText ||
    content?.selectedButtonId ||
    ''
  );
}

export function getContextInfo(message) {
  const unwrapped = unwrapMessage(message);
  const type = getContentType(unwrapped || {});
  return unwrapped?.[type]?.contextInfo || null;
}

export function parseCommand(text, prefix) {
  if (typeof text !== 'string' || !prefix || !text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length).trimStart();
  if (!rest) return null;
  const match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const argsText = (match[2] || '').trim();
  const args = argsText ? argsText.split(/\s+/) : [];
  return { name, args, argsText };
}

export function extractTargets({ message, text = '', mentions = [] }) {
  const found = [];
  const add = (value) => {
    const normalized = normalizeJid(value);
    if (!normalized) return;
    if (normalized.endsWith('@g.us') || normalized.endsWith('@broadcast')) return;
    if (normalized === '0@s.whatsapp.net') return;
    if (!found.includes(normalized)) found.push(normalized);
  };

  for (const mention of mentions || []) add(mention);

  const contextInfo = getContextInfo(message);
  if (contextInfo?.participant) add(contextInfo.participant);

  for (const token of String(text).split(/\s+/)) {
    if (!token) continue;
    const candidate = token.replace(/^@+/, '');
    if (candidate.includes('@')) add(candidate);
  }

  return found;
}

export function resolvePrefix({ group, db, config }) {
  return group?.prefix || db.getSetting('prefix', config.prefix) || config.prefix;
}

export function createHandler({ config, db, logger, registry, connection, services = {}, games }) {
  return new MessageHandler({ config, db, logger, registry, connection, services, games });
}

class MessageHandler {
  constructor({ config, db, logger, registry, connection, services, games }) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.registry = registry;
    this.connection = connection;
    this.services = services;
    this.socket = null;
    this.games = games || createGameManager({ getSocket: () => this.socket, logger });
    this.boundUpsert = null;
    this.boundParticipants = null;
    this.metadataCache = new Map();
    this.rateBuckets = new Map();
    this.cooldowns = new Map();
    this.spamBuckets = new Map();
    this.securityActions = new Map();
    this.noticeBuckets = new Map();
    this.pruneTimer = setInterval(() => this.pruneCaches(), 60000);
    this.pruneTimer.unref?.();
  }

  attach(socket) {
    this.detach();
    this.socket = socket;
    this.boundUpsert = (event) => {
      this.handleUpsert(socket, event).catch((error) => {
        this.logger.error(`Unhandled message batch failure: ${error.message}`);
      });
    };
    this.boundParticipants = (event) => {
      this.handleParticipants(socket, event).catch((error) => {
        this.logger.error(`Participant event failure: ${error.message}`);
      });
    };
    socket.ev.on('messages.upsert', this.boundUpsert);
    socket.ev.on('group-participants.update', this.boundParticipants);
  }

  detach() {
    if (this.socket && this.boundUpsert) {
      try {
        this.socket.ev.off('messages.upsert', this.boundUpsert);
      } catch {
        // Socket already disposed.
      }
    }
    if (this.socket && this.boundParticipants) {
      try {
        this.socket.ev.off('group-participants.update', this.boundParticipants);
      } catch {
        // Socket already disposed.
      }
    }
    this.socket = null;
    this.boundUpsert = null;
    this.boundParticipants = null;
  }

  shutdown() {
    this.games.shutdown();
    this.detach();
    clearInterval(this.pruneTimer);
  }

  pruneCaches() {
    const now = Date.now();
    for (const [key, entry] of this.metadataCache) {
      if (entry.expiresAt < now) this.metadataCache.delete(key);
    }
    for (const [key, timestamps] of this.spamBuckets) {
      const fresh = timestamps.filter((stamp) => now - stamp < this.config.security.spamWindowMs);
      if (fresh.length) this.spamBuckets.set(key, fresh);
      else this.spamBuckets.delete(key);
    }
    for (const [key, expiresAt] of this.cooldowns) {
      if (expiresAt < now) this.cooldowns.delete(key);
    }
    for (const [key, expiresAt] of this.securityActions) {
      if (expiresAt < now) this.securityActions.delete(key);
    }
    for (const [key, expiresAt] of this.noticeBuckets) {
      if (expiresAt < now) this.noticeBuckets.delete(key);
    }
    for (const [key, timestamps] of this.rateBuckets) {
      const fresh = timestamps.filter((stamp) => now - stamp < this.config.rateLimit.windowMs);
      if (fresh.length) this.rateBuckets.set(key, fresh);
      else this.rateBuckets.delete(key);
    }
    try {
      this.db.pruneProcessedMessages(86400);
    } catch (error) {
      this.logger.debug(`Message dedupe prune failed: ${error.message}`);
    }
  }

  async handleUpsert(socket, { messages, type }) {
    if (type !== 'notify' || !Array.isArray(messages)) return;
    for (const message of messages) {
      try {
        await this.processMessage(socket, message);
      } catch (error) {
        this.logger.error(`Message processing failure: ${error.message}`);
      }
    }
  }

  async processMessage(socket, msg) {
    const key = msg?.key;
    if (!key?.remoteJid) return;
    if (key.fromMe) return;

    const chatJid = key.remoteJid;
    if (chatJid === 'status@broadcast' || chatJid.endsWith('@broadcast') || chatJid.endsWith('@newsletter')) {
      return;
    }
    if (!key.id) return;
    if (!this.db.claimMessage(key.id, chatJid)) return;

    const senderJid = normalizeJid(key.participant || (isJidGroup(chatJid) ? null : chatJid));
    if (!senderJid) return;

    const botJid = normalizeJid(socket.user?.id);
    if (botJid && senderJid === botJid) return;

    const isOwner = Boolean(this.config.ownerJid && senderJid === this.config.ownerJid);
    const isSudo = this.db.isOperator(senderJid);

    if (!isOwner && this.db.isGloballyBanned(senderJid)) return;

    const isGroup = isJidGroup(chatJid);
    let groupMeta = null;
    if (isGroup) {
      groupMeta = await this.getGroupMetadata(socket, chatJid);
    }

    const group = isGroup
      ? this.db.ensureGroup(chatJid, groupMeta?.subject || null)
      : null;

    this.db.recordActivity(senderJid, { groupJid: isGroup ? chatJid : null });

    if (isGroup && this.db.isBannedFromGroup(chatJid, senderJid) && !isOwner && !isSudo) {
      if (isBotAdmin(groupMeta, botJid)) {
        try {
          await socket.groupParticipantsUpdate(chatJid, [senderJid], 'remove');
          this.db.logModeration(chatJid, 'exile-enforced', senderJid, botJid, 'Banned soul re-entered');
        } catch (error) {
          this.logger.warn(`Failed to enforce group exile: ${error.message}`);
        }
      }
      return;
    }

    const text = getMessageText(msg.message);
    const prefix = resolvePrefix({ group, db: this.db, config: this.config });
    const parsed = parseCommand(text, prefix);
    const mentions = getContextInfo(msg.message)?.mentionedJid || [];
    const targets = extractTargets({ message: msg.message, text: parsed?.argsText || text, mentions });
    const targetJid = targets[0] || null;

    const isAdmin = isGroup ? isGroupAdmin(groupMeta, senderJid) : false;
    const privileged = isOwner || isSudo || isAdmin || (isGroup && this.db.isAlly(chatJid, senderJid));

    if (isGroup && !privileged) {
      const filtered = await this.applySecurityFilters({
        socket,
        msg,
        chatJid,
        senderJid,
        group,
        groupMeta,
        botJid,
        text,
        isCommand: Boolean(parsed),
      });
      if (filtered) return;
    }

    if (!parsed) {
      await this.routeGameText({
        socket,
        msg,
        chatJid,
        isGroup,
        senderJid,
        botJid,
        group,
        groupMeta,
        text,
        isOwner,
        isSudo,
        isAdmin,
      });
      return;
    }

    const command = this.registry.get(parsed.name);
    if (!command) {
      if (this.throttleNotice(`unknown:${chatJid}:${senderJid}`, 10000)) {
        await this.safeReply(socket, chatJid, msg, compactFrame('☠️ UNKNOWN CURSE', [
          `No curse named "${truncate(parsed.name, 40)}" exists.`,
          `Use ${prefix}shrine to witness the bound curses.`,
        ]));
      }
      return;
    }

    if (this.db.getSettingBool('absence_enabled', false) && !isOwner && !isSudo) {
      if (this.throttleNotice(`absence:${senderJid}`, 60000)) {
        const message = this.db.getSetting(
          'absence_message',
          `${this.config.botName} is absent from the domain. Do not mistake silence for weakness.`,
        );
        await this.safeReply(socket, chatJid, msg, compactFrame('🌑 ABSENCE', [sanitizeField(message, 300)]));
      }
      return;
    }

    if (isGroup && group?.sealed && !isOwner && !isSudo && !isAdmin) {
      return;
    }

    if (!isOwner && !isSudo && this.isRateLimited(senderJid)) {
      if (this.throttleNotice(`rate:${chatJid}:${senderJid}`, 10000)) {
        await this.safeReply(socket, chatJid, msg, compactFrame('⛓ THROTTLED', [
          'Too many curses. The domain will not answer until your energy settles.',
        ]));
      }
      return;
    }

    const cooldownKey = `${senderJid}:${command.name}`;
    const cooldownUntil = this.cooldowns.get(cooldownKey) || 0;
    if (command.cooldownMs > 0 && cooldownUntil > Date.now()) {
      const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
      await this.safeReply(socket, chatJid, msg, compactFrame('⏳ CURSE SEALED', [
        `${prefix}${command.name} is sealed for another ${seconds}s.`,
      ]));
      return;
    }

    const permission = checkPermissions({
      required: command.permissions,
      isGroup,
      groupMeta,
      senderJid,
      botJid,
      isOwner,
      isSudo,
    });

    if (!permission.allowed) {
      await this.safeReply(socket, chatJid, msg, compactFrame('⛔ AUTHORITY DENIED', [
        truncate(permission.reason, 300),
        `Required: ${describePermissions(command.permissions)}.`,
      ]));
      return;
    }

    if (command.cooldownMs > 0) {
      this.cooldowns.set(cooldownKey, Date.now() + command.cooldownMs);
    }

    const ctx = this.createContext({
      socket,
      msg,
      chatJid,
      isGroup,
      senderJid,
      botJid,
      group,
      groupMeta,
      prefix,
      parsed,
      mentions,
      targets,
      targetJid,
      isOwner,
      isSudo,
      isAdmin,
      command,
    });

    const startedAt = Date.now();
    try {
      await withTimeout(
        Promise.resolve().then(() => command.execute(ctx)),
        this.config.executionTimeoutMs,
        `The curse ${command.name} exceeded its execution limit.`,
      );
      this.db.recordActivity(senderJid, { groupJid: isGroup ? chatJid : null, isCommand: true });
      this.logger.debug(`Executed ${command.name} in ${Date.now() - startedAt}ms (${isGroup ? 'group' : 'direct'})`);
    } catch (error) {
      if (error instanceof CommandError && error.expose) {
        await this.safeReply(socket, chatJid, msg, errorResponse(error.message));
      } else {
        this.logger.error(`Command ${command.name} failed: ${error.message}`);
        await this.safeReply(socket, chatJid, msg, errorResponse(
          'The curse collapsed before completion. Nothing was silently accepted.',
        ));
      }
    }
  }

  createContext({
    socket,
    msg,
    chatJid,
    isGroup,
    senderJid,
    botJid,
    group,
    groupMeta,
    prefix,
    parsed,
    mentions,
    targets,
    targetJid,
    isOwner,
    isSudo,
    isAdmin,
    command,
  }) {
    const contextInfo = getContextInfo(msg.message);
    return {
      sock: socket,
      message: msg,
      db: this.db,
      config: this.config,
      logger: this.logger,
      registry: this.registry,
      connection: this.connection,
      services: this.services,
      games: this.games,
      chatJid,
      isGroup,
      senderJid,
      botJid,
      group,
      groupMeta,
      prefix,
      command,
      commandName: parsed.name,
      args: parsed.args,
      argsText: parsed.argsText,
      mentions,
      targetJids: targets,
      targetJid,
      isOwner,
      isSudo,
      isAdmin,
      isBotAdmin: isBotAdmin(groupMeta, botJid),
      quoted: contextInfo
        ? {
            message: contextInfo.quotedMessage || null,
            participant: normalizeJid(contextInfo.participant),
            text: contextInfo.quotedMessage ? getMessageText(contextInfo.quotedMessage) : '',
          }
        : null,
      reply: (text, options = {}) => this.safeReply(socket, chatJid, msg, text, options),
      replyContent: (content, options = {}) =>
        socket.sendMessage(chatJid, content, { quoted: msg, ...options }),
      refreshGroupMeta: () => this.getGroupMetadata(socket, chatJid, { force: true }),
    };
  }

  // Routes a plain (non-command) message to the chat's active game, if any.
  // Runs after the ban, security-filter and parsing steps in processMessage, so
  // it only re-applies the absence and sealed-group gates that normally sit
  // after command lookup. Never throws.
  async routeGameText({
    socket,
    msg,
    chatJid,
    isGroup,
    senderJid,
    botJid,
    group,
    groupMeta,
    text,
    isOwner,
    isSudo,
    isAdmin,
  }) {
    try {
      if (!this.games.hasSession(chatJid)) return false;
      if (typeof text !== 'string' || !text.trim()) return false;
      if (this.db.getSettingBool('absence_enabled', false) && !isOwner && !isSudo) return false;
      if (isGroup && group?.sealed && !isOwner && !isSudo && !isAdmin) return false;
      return await this.games.handleText({
        socket,
        message: msg,
        chatJid,
        isGroup,
        senderJid,
        botJid,
        group,
        groupMeta,
        text,
        isOwner,
        isSudo,
        isAdmin,
      });
    } catch (error) {
      this.logger.error(`Game routing failure: ${error.message}`);
      return false;
    }
  }

  async safeReply(socket, chatJid, msg, text, options = {}) {
    try {
      const sendOptions = msg ? { quoted: msg } : undefined;
      return await socket.sendMessage(chatJid, { text, ...options }, sendOptions);
    } catch (error) {
      this.logger.warn(`Reply failed: ${error.message}`);
      return null;
    }
  }

  async getGroupMetadata(socket, groupJid, { force = false } = {}) {
    const now = Date.now();
    const cached = this.metadataCache.get(groupJid);
    if (!force && cached && cached.expiresAt > now) return cached.meta;
    try {
      const meta = await socket.groupMetadata(groupJid);
      this.metadataCache.set(groupJid, {
        meta,
        expiresAt: now + this.config.groupMetadataTtlMs,
      });
      return meta;
    } catch (error) {
      this.logger.debug(`Group metadata unavailable: ${error.message}`);
      return cached?.meta || null;
    }
  }

  isRateLimited(senderJid) {
    const now = Date.now();
    const windowMs = this.config.rateLimit.windowMs;
    const bucket = (this.rateBuckets.get(senderJid) || []).filter((stamp) => now - stamp < windowMs);
    if (bucket.length >= this.config.rateLimit.maxCommands) {
      this.rateBuckets.set(senderJid, bucket);
      return true;
    }
    bucket.push(now);
    this.rateBuckets.set(senderJid, bucket);
    return false;
  }

  throttleNotice(key, ms) {
    const now = Date.now();
    const until = this.noticeBuckets.get(key) || 0;
    if (until > now) return false;
    this.noticeBuckets.set(key, now + ms);
    return true;
  }

  async applySecurityFilters({ socket, msg, chatJid, senderJid, group, groupMeta, botJid, text, isCommand }) {
    if (!group) return false;

    const spamKey = `${chatJid}:${senderJid}`;
    const now = Date.now();
    const bucket = (this.spamBuckets.get(spamKey) || []).filter(
      (stamp) => now - stamp < this.config.security.spamWindowMs,
    );
    bucket.push(now);
    this.spamBuckets.set(spamKey, bucket);

    if (group.antispam && bucket.length >= this.config.security.spamThreshold) {
      return this.securityAction({
        socket,
        msg,
        chatJid,
        senderJid,
        group,
        groupMeta,
        botJid,
        actionKey: `spam:${spamKey}`,
        offense: 'Overwhelming cursed energy (message flood)',
      });
    }

    if (isCommand) return false;

    if (group.antilink && URL_PATTERN.test(text)) {
      return this.securityAction({
        socket,
        msg,
        chatJid,
        senderJid,
        group,
        groupMeta,
        botJid,
        actionKey: `link:${spamKey}`,
        offense: 'Smuggling an outside link into the domain',
      });
    }

    if (group.profanity && this.containsProfanity(text)) {
      return this.securityAction({
        socket,
        msg,
        chatJid,
        senderJid,
        group,
        groupMeta,
        botJid,
        actionKey: `profanity:${spamKey}`,
        offense: 'Foul language defiling the domain',
      });
    }

    return false;
  }

  containsProfanity(text) {
    const normalized = String(text).toLowerCase();
    return this.config.security.profanityWords.some((word) => {
      if (!word) return false;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalized);
    });
  }

  async securityAction({
    socket,
    msg,
    chatJid,
    senderJid,
    group,
    groupMeta,
    botJid,
    actionKey,
    offense,
  }) {
    try {
      if (msg.key) await socket.sendMessage(chatJid, { delete: msg.key });
    } catch (error) {
      this.logger.debug(`Security deletion failed: ${error.message}`);
    }

    if (!this.throttleNotice(actionKey, this.config.security.actionCooldownMs)) {
      return true;
    }

    await warnUser({
      db: this.db,
      sock: socket,
      logger: this.logger,
      group,
      groupMeta,
      groupJid: chatJid,
      targetJid: senderJid,
      actorJid: botJid,
      reason: offense,
      botJid,
      notify: true,
      autoKick: true,
    });
    return true;
  }

  async handleParticipants(socket, event) {
    const { id: groupJid, participants = [], action } = event || {};
    if (!groupJid || !Array.isArray(participants) || !participants.length) return;
    if (!['add', 'remove'].includes(action)) return;

    const groupMeta = await this.getGroupMetadata(socket, groupJid, { force: true });
    const group = this.db.ensureGroup(groupJid, groupMeta?.subject || null);
    const botJid = normalizeJid(socket.user?.id);

    if (action === 'remove' && typeof this.games?.handlePlayerLeave === 'function') {
      for (const participant of participants) {
        const target = normalizeJid(participant);
        if (!target) continue;
        await this.games.handlePlayerLeave(groupJid, target, { socket, groupMeta });
      }
    }

    if (action === 'add') {
      for (const participant of participants) {
        const target = normalizeJid(participant);
        if (!target) continue;

        if (this.db.isBannedFromGroup(groupJid, target) && isBotAdmin(groupMeta, botJid)) {
          try {
            await socket.groupParticipantsUpdate(groupJid, [target], 'remove');
            this.db.logModeration(groupJid, 'exile-enforced', target, botJid, 'Banned soul tried to re-enter');
          } catch (error) {
            this.logger.warn(`Failed to enforce exile on join: ${error.message}`);
          }
          continue;
        }

        if (target === botJid) {
          await this.safeReply(socket, groupJid, null, fullFrame('👹 DOMAIN CLAIMED', [
            `${this.config.botName} has taken residence.`,
            `Prefix: ${resolvePrefix({ group, db: this.db, config: this.config })}`,
            'Use the shrine to witness the bound curses.',
          ]));
          continue;
        }

        if (!group?.welcome_enabled) continue;
        const template = group.welcome_text || this.config.welcome.defaultText;
        const text = welcomeMessage({
          userJid: target,
          groupName: groupMeta?.subject || group.name || 'this domain',
          memberCount: groupMeta?.size || (groupMeta?.participants?.length ?? 0),
          rules: group.rules || groupMeta?.desc || '',
          time: formatTimestamp(nowSeconds(), {
            locale: this.config.locale,
            timezone: this.config.timezone,
          }),
          template,
          footer: this.config.footer,
        });
        try {
          await socket.sendMessage(groupJid, { text, mentions: [target] });
        } catch (error) {
          this.logger.warn(`Welcome message failed: ${error.message}`);
        }
      }
    }

    if (action === 'remove' && group?.goodbye_enabled) {
      for (const participant of participants) {
        const target = normalizeJid(participant);
        if (!target || target === botJid) continue;
        const template = group.goodbye_text || this.config.welcome.defaultGoodbyeText;
        const text = goodbyeMessage({
          userJid: target,
          groupName: groupMeta?.subject || group.name || 'this domain',
          memberCount: groupMeta?.size || (groupMeta?.participants?.length ?? 0),
          rules: group.rules || groupMeta?.desc || '',
          time: formatTimestamp(nowSeconds(), {
            locale: this.config.locale,
            timezone: this.config.timezone,
          }),
          template,
          footer: this.config.footer,
        });
        try {
          await socket.sendMessage(groupJid, { text, mentions: [target] });
        } catch (error) {
          this.logger.warn(`Goodbye message failed: ${error.message}`);
        }
      }
    }
  }
}

export { MessageHandler, describePermissions, displayMention, randomInt };
