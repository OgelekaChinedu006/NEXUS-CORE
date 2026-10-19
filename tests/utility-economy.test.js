import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { NexusDatabase } from '../lib/database.js';
import { CommandError } from '../lib/helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const SENDER = '111@s.whatsapp.net';
const TARGET = '222@s.whatsapp.net';
const logger = createLogger({ level: 'silent' });

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function makeContext(overrides = {}) {
  const replies = [];
  const db = overrides.db || new NexusDatabase(':memory:');
  const ctx = {
    prefix: '!',
    args: [],
    argsText: '',
    senderJid: SENDER,
    botJid: '999@s.whatsapp.net',
    targetJid: null,
    targetJids: [],
    isGroup: true,
    isOwner: false,
    isSudo: false,
    isAdmin: false,
    isBotAdmin: true,
    chatJid: GROUP,
    db,
    logger,
    services: {},
    groupMeta: {
      subject: 'Test Domain',
      participants: [
        { id: SENDER },
        { id: TARGET, admin: 'admin' },
      ],
    },
    group: { max_warnings: 3 },
    config: {
      prefix: '!',
      timezone: 'UTC',
      locale: 'en-GB',
      ownerJid: 'owner@s.whatsapp.net',
      ownerDisplay: 'Sovereign',
      botName: 'TEST CORE',
      version: '1.0.0',
      shrine: { slogan: 'Rule.' },
    },
    async reply(text, options = {}) {
      replies.push({ text, options });
    },
    ...overrides,
  };
  return { ctx, replies, db };
}

test('equation evaluates safely and rejects malformed expressions', async () => {
  const loaded = await registry();
  const { ctx, replies } = makeContext();
  ctx.argsText = '2 + 3 * 4';
  await loaded.get('equation').execute(ctx);
  assert.match(replies[0].text, /RESULT: 14/);

  ctx.argsText = 'sqrt(81) + 2^3';
  await loaded.get('equation').execute(ctx);
  assert.match(replies[1].text, /RESULT: 17/);

  ctx.argsText = '1 / 0';
  await assert.rejects(() => loaded.get('equation').execute(ctx), CommandError);
});

test('chronos formats valid zones and rejects invalid ones', async () => {
  const loaded = await registry();
  const { ctx, replies } = makeContext();
  ctx.args = ['Europe/London'];
  await loaded.get('chronos').execute(ctx);
  assert.match(replies[0].text, /TIMEZONE: Europe\/London/);
  assert.match(replies[0].text, /UNIX:/);

  ctx.args = ['Not/AZone'];
  await assert.rejects(() => loaded.get('chronos').execute(ctx), /not recognized/);
});

test('climate and coordinates consume the weather provider honestly', async () => {
  const loaded = await registry();
  const calls = [];
  const services = {
    weather: {
      async current(place) {
        calls.push(['current', place]);
        return {
          location: { name: 'Paris', admin: 'Ile-de-France', country: 'France' },
          temperature: 18,
          apparent: 17,
          humidity: 60,
          wind: 12,
          isDay: true,
          condition: 'partly cloudy',
          units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' },
        };
      },
      async geocode(place) {
        calls.push(['geocode', place]);
        return { name: 'Paris', admin: '', country: 'France', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris' };
      },
    },
  };
  const { ctx, replies } = makeContext({ services });

  ctx.argsText = 'Paris';
  await loaded.get('climate').execute(ctx);
  assert.match(replies[0].text, /TEMPERATURE: 18°C/);
  assert.match(replies[0].text, /Paris, Ile-de-France, France/);

  ctx.args = ['Paris'];
  ctx.argsText = 'Paris';
  await loaded.get('coordinates').execute(ctx);
  assert.match(replies[1].text, /LATITUDE: 48.85/);
  assert.match(replies[1].text, /openstreetmap/);
  assert.deepEqual(calls, [['current', 'Paris'], ['geocode', 'Paris']]);
});

test('lingua supports explicit and auto-detected source languages', async () => {
  const loaded = await registry();
  const calls = [];
  const services = {
    translation: {
      async translate(payload) {
        calls.push(payload);
        return { text: 'hola', provider: 'test', target: payload.target };
      },
    },
  };
  const { ctx, replies } = makeContext({ services });

  ctx.args = ['en', 'es', 'hello', 'world'];
  ctx.argsText = 'en es hello world';
  await loaded.get('lingua').execute(ctx);
  assert.deepEqual(calls[0], { text: 'hello world', source: 'en', target: 'es' });

  ctx.args = ['es', 'hello'];
  ctx.argsText = 'es hello';
  await loaded.get('lingua').execute(ctx);
  assert.deepEqual(calls[1], { text: 'hello', source: 'auto', target: 'es' });
  assert.match(replies[1].text, /PROVIDER: test/);

  ctx.args = ['nope!', 'hello'];
  ctx.argsText = 'nope! hello';
  await assert.rejects(() => loaded.get('lingua').execute(ctx), /valid target language/);
});

test('shorten uses the utility provider and rejects empty input', async () => {
  const loaded = await registry();
  const services = { utilities: { shorten: async (url) => `https://is.gd/${url.length}` } };
  const { ctx, replies } = makeContext({ services });
  ctx.argsText = 'https://example.com/very/long';
  await loaded.get('shorten').execute(ctx);
  assert.match(replies[0].text, /https:\/\/is\.gd\/\d+/);

  ctx.argsText = '';
  await assert.rejects(() => loaded.get('shorten').execute(ctx), CommandError);
});

test('inspect reports real database identity and standing', async (t) => {
  const { ctx, replies, db } = makeContext();
  t.after(() => db.close());
  db.addOperator(TARGET, 'owner@s.whatsapp.net');
  db.addAlly(GROUP, TARGET, SENDER);
  db.addWarning(GROUP, TARGET, 'offense', SENDER);
  db.ensureEconomy(TARGET);
  db.creditBalance(TARGET, 50);
  ctx.targetJid = TARGET;

  await (await registry()).get('inspect').execute(ctx);
  const output = replies[0].text;
  assert.match(output, /JID: 222@s\.whatsapp\.net/);
  assert.match(output, /NEXUS OPERATOR: YES/);
  assert.match(output, /DOMAIN ALLY: YES/);
  assert.match(output, /WARNINGS HERE: 1/);
  assert.match(output, /CURSED WEALTH: 50/);
});

test('tribute, labor and excavation credit wealth and respect their seals', async (t) => {
  const loaded = await registry();
  const { ctx, replies, db } = makeContext();
  t.after(() => db.close());

  await loaded.get('tribute').execute(ctx);
  assert.match(replies[0].text, /TRIBUTE CLAIMED/);
  assert.ok(db.getEconomy(SENDER).balance >= 120);
  await loaded.get('tribute').execute(ctx);
  assert.match(replies[1].text, /TRIBUTE SEALED/);

  await loaded.get('labor').execute(ctx);
  assert.match(replies[2].text, /LABOR COMPLETE/);
  await loaded.get('labor').execute(ctx);
  assert.match(replies[3].text, /LABOR EXHAUSTED/);

  await loaded.get('excavate').execute(ctx);
  assert.match(replies[4].text, /EXCAVATION/);
  await loaded.get('excavate').execute(ctx);
  assert.match(replies[5].text, /EXCAVATION SEALED/);
});

test('treasury, hierarchy and wealth report the persisted ledger', async (t) => {
  const loaded = await registry();
  const { ctx, replies, db } = makeContext();
  t.after(() => db.close());
  db.creditBalance(SENDER, 500);
  db.creditBalance(TARGET, 100);

  await loaded.get('treasury').execute(ctx);
  assert.match(replies[0].text, /WEALTH: 500/);
  assert.match(replies[0].text, /RANK: 1 \/ 2/);
  assert.match(replies[0].text, /TRIBUTE: ready/);

  await loaded.get('hierarchy').execute(ctx);
  assert.match(replies[1].text, /@111 — 500/);
  assert.match(replies[1].text, /@222 — 100/);

  await loaded.get('wealth').execute(ctx);
  assert.match(replies[2].text, /TOTAL CIRCULATION: 600/);
  assert.match(replies[2].text, /WEALTHIEST SOUL: @111 — 500/);
});

test('transfer moves funds atomically and rejects invalid requests', async (t) => {
  const loaded = await registry();
  const { ctx, replies, db } = makeContext();
  t.after(() => db.close());
  db.creditBalance(SENDER, 200);

  ctx.targetJid = TARGET;
  ctx.args = ['100'];
  ctx.argsText = '100';
  await loaded.get('transfer').execute(ctx);
  assert.equal(db.getEconomy(SENDER).balance, 100);
  assert.equal(db.getEconomy(TARGET).balance, 100);
  assert.match(replies[0].text, /AMOUNT: 100/);

  ctx.args = ['500'];
  await assert.rejects(() => loaded.get('transfer').execute(ctx), /holds only 100/);

  ctx.targetJid = SENDER;
  ctx.args = ['10'];
  await assert.rejects(() => loaded.get('transfer').execute(ctx), /yourself/);
});

test('bank deposits, withdrawals and status keep wallet and bank consistent', async (t) => {
  const loaded = await registry();
  const { ctx, replies, db } = makeContext();
  t.after(() => db.close());
  db.creditBalance(SENDER, 200);

  await loaded.get('bank').execute(ctx);
  assert.match(replies[0].text, /WALLET: 200/);
  assert.match(replies[0].text, /BANK: 0/);

  ctx.args = ['deposit', '80'];
  await loaded.get('bank').execute(ctx);
  assert.equal(db.getEconomy(SENDER).balance, 120);
  assert.equal(db.getEconomy(SENDER).bank_balance, 80);
  assert.match(replies[1].text, /DEPOSIT/);

  ctx.args = ['withdraw', '30'];
  await loaded.get('bank').execute(ctx);
  assert.equal(db.getEconomy(SENDER).balance, 150);
  assert.equal(db.getEconomy(SENDER).bank_balance, 50);

  ctx.args = ['deposit', '999'];
  await assert.rejects(() => loaded.get('bank').execute(ctx), /wallet holds only 150/);
  assert.equal(db.getEconomy(SENDER).balance, 150);
  assert.equal(db.getEconomy(SENDER).bank_balance, 50);
});
