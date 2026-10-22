import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactFrame, directResponse, errorResponse, fullFrame, goodbyeMessage,
  menu, progressBar, renderTemplate, successResponse, welcomeMessage,
} from '../lib/formatter.js';

const FOOTER = 'POWERED BY TEST';

test('fullFrame renders a bounded frame, body and footer', () => {
  const output = fullFrame('TITLE', ['first', ['second', 'third'], ''], { footer: FOOTER });
  assert.match(output, /^╭━━『 TITLE 』━━╮/);
  assert.match(output, /┃ first/);
  assert.match(output, /┃ second/);
  assert.match(output, /┃ third/);
  assert.match(output, /╰━━━━━━━━━━━━━━━━━━━━╯/);
  assert.ok(output.endsWith(FOOTER));
});

test('fullFrame can suppress the footer and handles empty bodies', () => {
  const output = fullFrame('EMPTY', [], { showFooter: false });
  assert.equal(output.includes('╰━━━━━━━━━━━━━━━━━━━━╯'), true);
  assert.equal(output.includes('POWERED BY'), false);
});

test('compact and direct responses keep the theme', () => {
  assert.match(compactFrame('PULSE', ['state'], { footer: FOOTER }), /^⛓ PULSE\n▸ state/);
  assert.match(directResponse('SIGIL', 'body', { footer: FOOTER }), /^🔥 SIGIL\n\nbody/);
  assert.match(errorResponse('bad'), /CURSE REJECTED/);
  assert.match(successResponse('good', 'done'), /good/);
});

test('menu advertises only supplied categories and the real total', () => {
  const output = menu({
    prefix: '!',
    version: '1.0.0',
    total: 3,
    botName: 'TEST CORE',
    slogan: 'Rule.',
    footer: FOOTER,
    categories: [
      {
        id: 'general',
        label: 'SHRINE',
        commands: [
          { name: 'shrine', description: 'menu' },
          { name: 'beg', description: 'details' },
        ],
      },
    ],
  });
  assert.match(output, /^╭━━━〔 TEST CORE 〕━━━╮/);
  assert.match(output, /◈ VESSEL: TEST CORE/);
  assert.match(output, /◈ PREFIX: !/);
  assert.match(output, /◈ VERSION: 1\.0\.0/);
  assert.match(output, /◈ COMMANDS: 3/);
  assert.match(output, /┣━━〔 ✦ SHRINE 〕/);
  assert.match(output, /┃ ⌁ !shrine\n┃ ⌁ !beg\n/);
  assert.match(output, /┃ ✦ Rule\./);
  assert.match(output, /!beg <command>/);
  assert.match(output, /╰━━━━━━━━━━━━━━━━━━━━╯/);
  assert.doesNotMatch(output, /—/);
  assert.doesNotMatch(output, /details/);
  assert.doesNotMatch(output, /DOMAIN CONTROL/);
  assert.ok(output.endsWith(FOOTER));
});

test('renderTemplate replaces every known token and leaves unknown tokens alone', () => {
  const output = renderTemplate('{a} and {b} but {c}', { a: 'one', b: 'two' });
  assert.equal(output, 'one and two but {c}');
});

test('welcome and goodbye messages sanitize values and ensure a footer', () => {
  const welcome = welcomeMessage({
    userJid: '123@s.whatsapp.net', groupName: 'The Domain', memberCount: 42,
    rules: 'Do not kneel late.', time: 'now',
    template: '{user} joined {group}; {count} souls; {rules}; {time}', footer: FOOTER,
  });
  assert.match(welcome, /@123 joined The Domain; 42 souls; Do not kneel late\.; now/);
  assert.ok(welcome.endsWith(FOOTER));

  const goodbye = goodbyeMessage({
    userJid: '123@s.whatsapp.net', groupName: 'The Domain', memberCount: 0,
    rules: '', time: 'now', template: '{user} left {group}.', footer: FOOTER,
  });
  assert.match(goodbye, /@123 left The Domain\./);
  assert.ok(goodbye.endsWith(FOOTER));
});

test('templates that already contain POWERED BY do not receive a duplicate footer', () => {
  const output = welcomeMessage({
    userJid: '123@s.whatsapp.net', groupName: 'Domain', memberCount: 1, rules: '',
    time: 'now', template: 'hello POWERED BY CUSTOM', footer: FOOTER,
  });
  assert.equal(output.includes(FOOTER), false);
  assert.equal(output.includes('POWERED BY CUSTOM'), true);
});

test('progressBar clamps values and reports percentages', () => {
  assert.equal(progressBar(0, 100), '░░░░░░░░░░ 0%');
  assert.equal(progressBar(50, 100), '█████░░░░░ 50%');
  assert.equal(progressBar(200, 100), '██████████ 100%');
  assert.equal(progressBar(-5, 100), '░░░░░░░░░░ 0%');
});