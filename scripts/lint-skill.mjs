#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// lint-skill.mjs — validate SKILL.md and the reference links.
//
//   node scripts/lint-skill.mjs
//
// Checks that the skill frontmatter is well formed, that the body is within the
// size limit, that every reference link resolves, and that the scripts exist.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY_LINES = 500;

let failures = 0;

function ok(msg) {
  console.log('  PASS  ' + msg);
}

function fail(msg) {
  failures++;
  console.log('  FAIL  ' + msg);
}

console.log('linting skill at ' + root);
console.log('');

const skillPath = join(root, 'SKILL.md');
if (!existsSync(skillPath)) {
  fail('SKILL.md not found');
  process.exit(1);
}
ok('SKILL.md exists');

const content = readFileSync(skillPath, 'utf8');
const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
if (!m) {
  fail('frontmatter could not be parsed');
  process.exit(1);
}
ok('frontmatter parsed');

const front = m[1];
const body = m[2];

const nameMatch = front.match(/^name:\s*(.+)$/m);
if (!nameMatch) {
  fail('frontmatter has no name');
} else {
  const name = nameMatch[1].trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    fail('name "' + name + '" is not kebab-case');
  } else {
    ok('name "' + name + '" is valid kebab-case');
  }
}

const descMatch = front.match(/^description:\s*\|?\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|$)/m);
if (!descMatch || descMatch[1].trim().length < 40) {
  fail('frontmatter description is missing or too short');
} else {
  ok('description present (' + descMatch[1].trim().length + ' chars)');
}

for (const key of ['allowed-tools', 'license', 'model']) {
  if (new RegExp('^' + key + ':', 'm').test(front)) {
    fail('frontmatter contains unsupported key "' + key + '"');
  }
}
ok('no unsupported frontmatter keys');

const bodyLines = body.split(/\r?\n/).length;
if (bodyLines > MAX_BODY_LINES) {
  fail('body is ' + bodyLines + ' lines, limit is ' + MAX_BODY_LINES);
} else {
  ok('body is ' + bodyLines + ' lines (limit ' + MAX_BODY_LINES + ')');
}

const links = [...body.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)].map((x) => x[1]);
const unique = [...new Set(links)];
if (unique.length === 0) {
  fail('no reference links found in SKILL.md');
} else {
  let allResolve = true;
  for (const ref of unique) {
    if (!existsSync(join(root, 'references', ref))) {
      fail('reference does not resolve: references/' + ref);
      allResolve = false;
    }
  }
  if (allResolve) ok('all ' + unique.length + ' reference links resolve');
}

const scriptsDir = join(root, 'scripts');
const required = [
  'audit.mjs',
  'transform.mjs',
  'rewrite-docx.mjs',
  'justify-docx.mjs',
  'format-docx.mjs',
  'purge.mjs',
  'selftest.mjs',
  'lib-text.mjs',
  'lib-zip.mjs',
  'lib-inflect.mjs',
  'lib-justify.mjs',
  'lib-format.mjs',
  'lib-guard.mjs',
  'lib-rhythm.mjs',
  'lib-citations.mjs',
  'detector-pressure.mjs',
  'audit-citations.mjs',
  'format-citations.mjs',
];
for (const s of required) {
  if (!existsSync(join(scriptsDir, s))) fail('missing script: scripts/' + s);
}
ok('all required scripts present');

// The transform engine reads its word banks from rules/, so a missing or
// malformed bank would break the engine in every installed location.
const rulesDir = join(root, 'rules');
const ruleBanks = [
  'phrases.json',
  'synonyms.json',
  'determiners.json',
  'transitions.json',
  'discourse.json',
  'hedges.json',
  'protected_terms.json',
  'nominalisations.json',
  'appositives.json',
  'rhythm.json',
  'tells.json',
  'frequency.json',
  'citation_styles.json',
];
let rulesOk = true;
for (const f of ruleBanks) {
  const p = join(rulesDir, f);
  if (!existsSync(p)) {
    fail('missing word bank: rules/' + f);
    rulesOk = false;
    continue;
  }
  try {
    JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    fail('word bank is not valid JSON: rules/' + f);
    rulesOk = false;
  }
}
if (rulesOk) ok('all ' + ruleBanks.length + ' word banks present and valid');

const forbidden = ['README.md', 'CHANGELOG.md', 'INSTALLATION.md', 'QUICK_REFERENCE.md'];
for (const f of forbidden) {
  if (existsSync(join(root, f))) {
    console.log('  NOTE  ' + f + ' is present (fine for a published repo, not for an installed skill folder)');
  }
}

console.log('');
console.log(failures === 0 ? 'lint passed' : 'lint failed with ' + failures + ' problem(s)');
process.exit(failures === 0 ? 0 : 1);
