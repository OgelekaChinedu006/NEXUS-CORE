import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { NexusDatabase } from '../lib/database.js';
import { CommandError } from '../lib/helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const logger = createLogger({ level: 'silent' });

const PRIORITY_COMMANDS = [
  'arise', 'beg', 'pulse', 'manifest', 'eternity', 'sovereign', 'territory', 'dominion',
  'footprint', 'soulscan', 'vessel', 'oracle', 'sigil',
  'cleave', 'silence', 'release', 'ascend', 'crush', 'dismantle', 'summon', 'shadowtag', 'converge',
  'condemn', 'pardon', 'domainlink',
  'malevolent', 'profanity', 'overwhelm', 'vigil', 'judgment', 'welcome', 'departure',
  'linkrune', 'mentionrune', 'spamrune', 'botrune', 'callrune',
  'farewell', 'law', 'doctrine',
  'regime', 'edictor', 'bind', 'unbind', 'mode', 'reawaken', 'alliance', 'absence',
];

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function baseConfig(overrides = {}) {
  return {
    prefix: '!',
    ownerJid: 'owner@s.whatsapp.net',
    ownerDisplay: 'The Sovereign',
    botName: 'TEST CORE',
    version: '1.0.0',
    baileysVersion: '7.0.0-rc14',
    locale: 'en-GB',
    timezone: 'UTC',
    shrine: { slogan: 'The King does not ask.' },
    security: { maxMentions: 500 },
    ...overrides,
  };
}

function context(overrides = {}) {
  const replies = [];
  const ctx = {
    prefix: '!',
    args: [],
    argsText: '',
    senderJid: 'admin@s.whatsapp.net',
    botJid: 'bot@s.whatsapp.net',
    targetJid: null,
    targetJids: [],
    isGroup: true,
    isOwner: false,
    isSudo: false,
    isAdmin: true,
    isBotAdmin: true,
    chatJid: '120363000000000000@g.us',
    config: baseConfig(),
    groupMeta: {
      owner: 'creator@s.whatsapp.net',
      participants: [
        { id: 'admin@s.whatsapp.net', admin: 'admin' },
        { id: 'member@s.whatsapp.net' },
        { id: 'bot@s.whatsapp.net', admin: 'admin' },
        { id: 'creator@s.whatsapp.net', admin: 'superadmin' },
      ],
    },
    group: { max_warnings: 3, welcome_enabled: 0, goodbye_enabled: 0, rules: null, sealed: 0 },
    connection: {},
    registry: null,
    logger,
    reply: async (text, options = {}) => {
      replies.push({ text, options });
      return { ok: true };
    },
    ...overrides,
  };
  return { ctx, replies };
}

test('registry loads every command with complete metadata and no alias conflicts', async () => {
  const loaded = await registry();
  assert.ok(loaded.size >= PRIORITY_COMMANDS.length);
  for (const command of loaded.all()) {
    assert.match(command.name, /^[a-z][a-z0-9]{1,31}$/);
    assert.ok(command.description.length >= 3);
    assert.ok(command.category);
    assert.ok(command.usage);
    assert.equal(typeof command.execute, 'function');
    assert.ok(Array.isArray(command.aliases));
    assert.ok(command.permissions.length > 0);
    assert.match(command.source, /commands[\\/]/);
  }
});

test('every roadmap priority command is implemented and loadable', async () => {
  const loaded = await registry();
  for (const name of PRIORITY_COMMANDS) {
    assert.ok(loaded.get(name), `missing priority command: ${name}`);
  }
});

test('arise renders a menu whose advertised count matches the registry', async () => {
  const loaded = await registry();
  assert.equal(loaded.get('arise'), loaded.get('menu'));
  assert.equal(loaded.get('arise'), loaded.get('commands'));
  assert.equal(loaded.get('shrine'), null);
  const { ctx, replies } = context({ registry: loaded, args: [], argsText: '' });
  await loaded.get('arise').execute(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, new RegExp(`COMMANDS: ${loaded.size}`));
  assert.match(replies[0].text, /SHRINE OF THE KING/);
  assert.match(replies[0].text, /!beg <command>/);
  assert.match(replies[0].text, /^╭━━『 TEST CORE 』━━╮/);
  assert.match(replies[0].text, /┣━━〔 ✦ SHRINE 〕\n┃ ⌁ !arise/);
  assert.doesNotMatch(replies[0].text, /┃\n┣━━〔 ✦/);
  assert.doesNotMatch(replies[0].text, /〕\n┃\n┃ ⌁/);
  for (const command of loaded.all()) {
    assert.match(replies[0].text, new RegExp(`┃ ⌁ ${ctx.prefix}${command.name}$`, 'm'), `missing ${command.name}`);
  }
});

test('arise image captions keep one command per line under the 1024 limit', async () => {
  const loaded = await registry();
  const contents = [];
  const { ctx, replies } = context({ registry: loaded, args: [], argsText: '' });
  ctx.replyContent = async (content) => {
    contents.push(content);
    return { ok: true };
  };
  await loaded.get('arise').execute(ctx);
  assert.equal(replies.length, 0);
  assert.equal(contents.length, 1);
  assert.ok(contents[0].image?.url);
  const caption = contents[0].caption;
  assert.ok(caption.length <= 1024);
  assert.match(caption, new RegExp(`COMMANDS: ${loaded.size}`));
  assert.match(caption, /^╭━━『 TEST CORE 』━━╮/);
  assert.match(caption, /┣━━〔 ✦ SHRINE 〕\n!arise\n!beg/);
  assert.match(caption, /!vessel\n┣━━〔 ✦ DOMAIN CONTROL 〕/);
  assert.doesNotMatch(caption, /┃\n┣━━〔 ✦/);
  assert.doesNotMatch(caption, /〕\n┃\n!/);
  assert.doesNotMatch(caption, /!arise, !beg/);
  const listed = new Set(caption.split('\n').filter((line) => line.startsWith(ctx.prefix)));
  for (const command of loaded.all()) {
    assert.ok(listed.has(`${ctx.prefix}${command.name}`), `missing ${command.name}`);
  }
});

test('arise filters categories and rejects unknown categories', async () => {
  const loaded = await registry();
  const filtered = context({
    registry: loaded,
    args: ['sovereign'],
    argsText: 'sovereign',
  });
  await loaded.get('arise').execute(filtered.ctx);
  assert.match(filtered.replies[0].text, /SOVEREIGN/);
  assert.match(filtered.replies[0].text, /!regime/);

  const unknown = context({ registry: loaded, args: ['nope'], argsText: 'nope' });
  await loaded.get('arise').execute(unknown.ctx);
  assert.match(unknown.replies[0].text, /UNKNOWN DOMAIN/);
  assert.match(unknown.replies[0].text, /Available domains/);
});

test('beg reports precise usage and rejects unknown commands', async () => {
  const loaded = await registry();
  const known = context({ registry: loaded, args: ['cleave'], argsText: 'cleave' });
  await loaded.get('beg').execute(known.ctx);
  assert.match(known.replies[0].text, /CLEAVE/);
  assert.match(known.replies[0].text, /!cleave <@user> \[reason\]/);
  assert.match(known.replies[0].text, /group admins/);

  const unknown = context({ registry: loaded, args: ['fake'], argsText: 'fake' });
  await loaded.get('beg').execute(unknown.ctx);
  assert.match(unknown.replies[0].text, /NO SUCH CURSE/);
});

test('regime changes and resets the global prefix while rejecting invalid prefixes', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const command = loaded.get('regime');
  const { ctx, replies } = context({ db, isOwner: true });

  ctx.args = ['status'];
  await command.execute(ctx);
  assert.match(replies.at(-1).text, /GLOBAL PREFIX: !/);

  ctx.args = ['prefix', '#'];
  await command.execute(ctx);
  assert.equal(db.getSetting('prefix'), '#');
  assert.match(replies.at(-1).text, /GLOBAL PREFIX: #/);

  ctx.args = ['prefix', 'reset'];
  await command.execute(ctx);
  assert.equal(db.getSetting('prefix', '!'), '!');

  ctx.args = ['prefix', 'too long'];
  await assert.rejects(() => command.execute(ctx), CommandError);
});

test('bind and unbind manage sudo users without blessing the owner or bot', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const bind = loaded.get('bind');
  const unbind = loaded.get('unbind');
  const { ctx, replies } = context({ db, isOwner: true, commandName: 'bind', command: bind });

  ctx.args = [];
  ctx.targetJid = 'member@s.whatsapp.net';
  await bind.execute(ctx);
  assert.equal(db.isOperator('member@s.whatsapp.net'), true);
  assert.match(replies.at(-1).text, /USER BOUND/);

  ctx.args = ['list'];
  ctx.targetJid = null;
  await bind.execute(ctx);
  assert.match(replies.at(-1).text, /BOUND USERS/);
  assert.match(replies.at(-1).text, /@member/);

  ctx.commandName = 'unbind';
  ctx.command = unbind;
  ctx.args = [];
  ctx.targetJid = 'member@s.whatsapp.net';
  await unbind.execute(ctx);
  assert.equal(db.isOperator('member@s.whatsapp.net'), false);
  assert.match(replies.at(-1).text, /USER UNBOUND/);

  ctx.commandName = 'bind';
  ctx.command = bind;
  ctx.args = [];
  ctx.targetJid = 'owner@s.whatsapp.net';
  await assert.rejects(() => bind.execute(ctx), /Sovereign/);

  ctx.targetJid = 'bot@s.whatsapp.net';
  await assert.rejects(() => bind.execute(ctx), /vessel cannot be bound/);

  ctx.args = [];
  ctx.targetJid = null;
  await assert.rejects(() => bind.execute(ctx), /bind @user/);

  ctx.commandName = 'unbind';
  ctx.command = unbind;
  await assert.rejects(() => unbind.execute(ctx), /unbind @user/);

  ctx.commandName = 'bind';
  ctx.command = bind;
  ctx.args = ['list'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await bind.execute(ctx);
  assert.match(replies.at(-1).text, /BOUND USERS/);
});

test('legacy sudo and edictor aliases stay compatible and owner-protected', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const command = loaded.get('edictor');
  assert.equal(loaded.get('sudo'), command);
  assert.equal(loaded.get('operators'), command);
  assert.equal(loaded.get('bind'), command);
  assert.notEqual(loaded.get('unbind'), command);
  assert.deepEqual(command.permissions, ['owner']);
  assert.deepEqual(loaded.get('unbind').permissions, ['owner']);

  const { ctx, replies } = context({ db, isOwner: true, commandName: 'sudo', command });
  ctx.args = ['add'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await command.execute(ctx);
  assert.equal(db.isOperator('member@s.whatsapp.net'), true);
  assert.match(replies.at(-1).text, /USER BOUND/);

  ctx.commandName = 'edictor';
  ctx.args = ['list'];
  ctx.targetJid = null;
  await command.execute(ctx);
  assert.match(replies.at(-1).text, /@member/);

  ctx.args = ['remove'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await command.execute(ctx);
  assert.equal(db.isOperator('member@s.whatsapp.net'), false);
});

test('arise menu shows bind and unbind but hides edictor and sudo', async () => {
  const loaded = await registry();
  const { ctx, replies } = context({ registry: loaded, args: ['sovereign'], argsText: 'sovereign' });
  await loaded.get('arise').execute(ctx);
  const text = replies[0].text;
  assert.match(text, /!bind/);
  assert.match(text, /!unbind/);
  assert.match(text, /!mode/);
  assert.doesNotMatch(text, /!edictor/);
  assert.doesNotMatch(text, /!sudo/);
  assert.doesNotMatch(text, /!operators/);
});

test('mode displays, validates and persists the global operating mode', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const command = loaded.get('mode');
  assert.deepEqual(command.permissions, ['owner']);
  const { ctx, replies } = context({ db, isOwner: true });

  ctx.args = [];
  await command.execute(ctx);
  assert.match(replies.at(-1).text, /CURRENT: COVENANT/);
  assert.match(replies.at(-1).text, /Only the Sovereign and bound users are heard/);
  assert.match(replies.at(-1).text, /The vessel answers every soul/);
  assert.match(replies.at(-1).text, /Only the Sovereign is heard/);

  ctx.args = ['veil'];
  await command.execute(ctx);
  assert.equal(db.getSetting('access_mode'), 'veil');
  assert.match(replies.at(-1).text, /CURRENT: VEIL/);

  ctx.args = ['not-a-mode'];
  await command.execute(ctx);
  assert.equal(db.getSetting('access_mode'), 'veil');
  assert.match(replies.at(-1).text, /not a known mode/);

  ctx.args = ['awaken'];
  await command.execute(ctx);
  assert.equal(db.getSetting('access_mode'), 'awaken');

  ctx.args = ['covenant'];
  await command.execute(ctx);
  assert.equal(db.getSetting('access_mode'), 'covenant');
});

test('absence toggles the handler flag and rewrites the notice', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const command = loaded.get('absence');
  const { ctx } = context({ db, isOwner: true });

  ctx.args = ['message', 'The', 'King', 'is', 'gone'];
  ctx.argsText = 'message The King is gone';
  await command.execute(ctx);
  assert.equal(db.getSetting('absence_message'), 'The King is gone');

  ctx.args = ['on'];
  await command.execute(ctx);
  assert.equal(db.getSettingBool('absence_enabled'), true);

  ctx.args = ['off'];
  await command.execute(ctx);
  assert.equal(db.getSettingBool('absence_enabled'), false);

  ctx.args = ['reset'];
  await command.execute(ctx);
  assert.equal(db.getSetting('absence_message'), null);
  assert.equal(db.getSettingBool('absence_enabled'), false);
});

test('alliance grants and revokes ward immunity only for present members', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const command = loaded.get('alliance');
  const { ctx } = context({ db });

  ctx.args = ['add'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await command.execute(ctx);
  assert.equal(db.isAlly(ctx.chatJid, 'member@s.whatsapp.net'), true);

  ctx.args = ['list'];
  ctx.targetJid = null;
  await command.execute(ctx);
  assert.equal(db.listAllies(ctx.chatJid).length, 1);

  ctx.args = ['remove'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await command.execute(ctx);
  assert.equal(db.isAlly(ctx.chatJid, 'member@s.whatsapp.net'), false);

  ctx.args = ['add'];
  ctx.targetJid = 'outsider@s.whatsapp.net';
  await assert.rejects(() => command.execute(ctx), /not present/);
});

test('doctrine updates the warning limit within safe bounds', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  db.ensureGroup('120363000000000000@g.us');
  const loaded = await registry();
  const command = loaded.get('doctrine');
  const { ctx } = context({ db });

  ctx.args = ['5'];
  await command.execute(ctx);
  assert.equal(db.getGroup(ctx.chatJid).max_warnings, 5);

  ctx.args = ['reset'];
  await command.execute(ctx);
  assert.equal(db.getGroup(ctx.chatJid).max_warnings, 3);

  ctx.args = ['0'];
  await assert.rejects(() => command.execute(ctx), CommandError);
});

test('law and farewell persist custom group text and reset to defaults', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  db.ensureGroup('120363000000000000@g.us');
  const loaded = await registry();
  const { ctx } = context({ db });

  ctx.args = ['Obey', 'the', 'throne'];
  ctx.argsText = 'Obey the throne';
  await loaded.get('law').execute(ctx);
  assert.equal(db.getGroup(ctx.chatJid).rules, 'Obey the throne');

  ctx.args = ['reset'];
  ctx.argsText = 'reset';
  await loaded.get('law').execute(ctx);
  assert.equal(db.getGroup(ctx.chatJid).rules, null);

  ctx.args = ['Gone', '{user}'];
  ctx.argsText = 'Gone {user}';
  await loaded.get('farewell').execute(ctx);
  const group = db.getGroup(ctx.chatJid);
  assert.equal(group.goodbye_text, 'Gone {user}');
  assert.equal(group.goodbye_enabled, 1);
});

test('reawaken replies before scheduling a single socket restart', async () => {
  const loaded = await registry();
  let restarted = 0;
  const { ctx, replies } = context({
    isOwner: true,
    connection: {
      starting: false,
      restart: async () => {
        restarted += 1;
      },
    },
  });
  await loaded.get('reawaken').execute(ctx);
  assert.match(replies[0].text, /REAWAKENING/);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(restarted, 1);
});

test('converge is a distinct group command and does not alias summon or shadowtag', async () => {
  const loaded = await registry();
  const command = loaded.get('converge');
  assert.ok(command);
  assert.equal(command.name, 'converge');
  assert.equal(command.category, 'domain');
  assert.deepEqual(command.aliases, []);
  assert.deepEqual(command.permissions, ['group']);
  assert.notEqual(command, loaded.get('summon'));
  assert.notEqual(command, loaded.get('shadowtag'));
  assert.notEqual(loaded.get('tagall'), command);
  assert.notEqual(loaded.get('tagadmins'), command);
});

test('converge mentions every eligible participant once in a single message and excludes the bot', async () => {
  const loaded = await registry();
  const { ctx, replies } = context({
    isAdmin: false,
    senderJid: 'member@s.whatsapp.net',
    argsText: 'Assemble now',
  });
  await loaded.get('converge').execute(ctx);
  assert.equal(replies.length, 1);
  const { text, options } = replies[0];
  assert.deepEqual(options.mentions, [
    'admin@s.whatsapp.net',
    'member@s.whatsapp.net',
    'creator@s.whatsapp.net',
  ]);
  assert.equal(options.mentions.includes('bot@s.whatsapp.net'), false);
  assert.match(text, /@admin/);
  assert.match(text, /@member/);
  assert.match(text, /@creator/);
  assert.doesNotMatch(text, /@bot\b/);
  assert.match(text, /WORD: Assemble now/);
  assert.match(text, /CONVERGE/);
});

test('converge rejects private chats, empty registers and unread metadata', async () => {
  const loaded = await registry();
  const command = loaded.get('converge');

  const privateChat = context({ isGroup: false, groupMeta: null, chatJid: 'member@s.whatsapp.net' });
  await command.execute(privateChat.ctx);
  assert.equal(privateChat.replies.length, 1);
  assert.match(privateChat.replies[0].text, /PRIVATE VOID/);
  assert.equal(privateChat.replies[0].options.mentions, undefined);

  const empty = context({ groupMeta: { participants: [{ id: 'bot@s.whatsapp.net', admin: 'admin' }] } });
  await command.execute(empty.ctx);
  assert.match(empty.replies[0].text, /EMPTY DOMAIN/);
  assert.equal(empty.replies[0].options.mentions, undefined);

  const missingMeta = context({ groupMeta: null });
  await command.execute(missingMeta.ctx);
  assert.match(missingMeta.replies[0].text, /DOMAIN UNREADABLE/);
});

test('converge refuses oversized groups instead of omitting members', async () => {
  const loaded = await registry();
  const participants = Array.from({ length: 5 }, (_, index) => ({
    id: `user${index}@s.whatsapp.net`,
  }));
  participants.push({ id: 'bot@s.whatsapp.net', admin: 'admin' });
  const { ctx, replies } = context({
    groupMeta: { participants },
    config: baseConfig({ security: { maxMentions: 3 } }),
  });
  await loaded.get('converge').execute(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /DOMAIN TOO VAST/);
  assert.match(replies[0].text, /SOULS: 5/);
  assert.match(replies[0].text, /SAFE LIMIT: 3/);
  assert.equal(replies[0].options.mentions, undefined);
});

test('summon refuses oversized groups instead of omitting members', async () => {
  const loaded = await registry();
  const participants = Array.from({ length: 5 }, (_, index) => ({
    id: `user${index}@s.whatsapp.net`,
  }));
  participants.push({ id: 'bot@s.whatsapp.net', admin: 'admin' });
  const { ctx, replies } = context({
    groupMeta: { participants },
    config: baseConfig({ security: { maxMentions: 3 } }),
  });
  await loaded.get('summon').execute(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /DOMAIN TOO VAST/);
  assert.match(replies[0].text, /SOULS: 5/);
  assert.match(replies[0].text, /SAFE LIMIT: 3/);
  assert.equal(replies[0].options.mentions, undefined);
});

test('summon and shadowtag keep their aliases, admin gate and mention behaviour', async () => {
  const loaded = await registry();
  const summon = loaded.get('summon');
  const shadowtag = loaded.get('shadowtag');

  assert.equal(loaded.get('tagall'), summon);
  assert.equal(loaded.get('tagadmins'), shadowtag);
  assert.deepEqual(summon.aliases, ['tagall']);
  assert.deepEqual(shadowtag.aliases, ['tagadmins']);
  assert.deepEqual(summon.permissions, ['admin']);
  assert.deepEqual(shadowtag.permissions, ['admin']);
  assert.equal(summon.category, 'domain');
  assert.equal(shadowtag.category, 'domain');

  const summoned = context({ argsText: 'Appear' });
  await summon.execute(summoned.ctx);
  assert.equal(summoned.replies.length, 1);
  assert.deepEqual(summoned.replies[0].options.mentions, [
    'admin@s.whatsapp.net',
    'member@s.whatsapp.net',
    'creator@s.whatsapp.net',
  ]);
  assert.match(summoned.replies[0].text, /SUMMONING/);
  assert.match(summoned.replies[0].text, /WORD: Appear/);

  const shadowed = context();
  await shadowtag.execute(shadowed.ctx);
  assert.equal(shadowed.replies.length, 1);
  assert.deepEqual(shadowed.replies[0].options.mentions, [
    'admin@s.whatsapp.net',
    'creator@s.whatsapp.net',
  ]);
  assert.match(shadowed.replies[0].text, /SHADOWTAG/);
  assert.doesNotMatch(shadowed.replies[0].text, /@member/);
});

test('command failures are exposed as typed CommandErrors', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const { ctx } = context({ db });
  ctx.args = ['add'];
  ctx.targetJid = 'member@s.whatsapp.net';
  ctx.groupMeta = { participants: [] };
  await assert.rejects(() => loaded.get('alliance').execute(ctx), CommandError);
});
