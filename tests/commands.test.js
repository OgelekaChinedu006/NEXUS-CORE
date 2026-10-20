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
  'cleave', 'silence', 'release', 'ascend', 'crush', 'dismantle', 'summon', 'shadowtag',
  'condemn', 'pardon', 'domainlink',
  'malevolent', 'profanity', 'overwhelm', 'vigil', 'judgment', 'welcome', 'departure',
  'farewell', 'law', 'doctrine',
  'regime', 'edictor', 'reawaken', 'alliance', 'absence',
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
    security: { maxMentions: 120 },
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

test('edictor adds, lists and removes operators without blessing the owner or bot', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const loaded = await registry();
  const command = loaded.get('edictor');
  const { ctx, replies } = context({ db, isOwner: true });

  ctx.args = ['add'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await command.execute(ctx);
  assert.equal(db.isOperator('member@s.whatsapp.net'), true);
  assert.match(replies.at(-1).text, /OPERATOR BOUND/);

  ctx.args = ['list'];
  ctx.targetJid = null;
  await command.execute(ctx);
  assert.match(replies.at(-1).text, /@member/);

  ctx.args = ['remove'];
  ctx.targetJid = 'member@s.whatsapp.net';
  await command.execute(ctx);
  assert.equal(db.isOperator('member@s.whatsapp.net'), false);

  ctx.args = ['add'];
  ctx.targetJid = 'owner@s.whatsapp.net';
  await assert.rejects(() => command.execute(ctx), /Sovereign/);
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
