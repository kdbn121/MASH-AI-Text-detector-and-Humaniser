#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// selftest.mjs — build fixtures, then verify the whole pipeline works.
//
//   node scripts/selftest.mjs
//
// Exits 0 when every check passes, 1 otherwise. No dependencies, no network.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, readZip } from './lib-zip.mjs';
import { extractText } from './lib-text.mjs';
import { applyFormatting, findTables, findElements } from './lib-format.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'turnitin-selftest-'));

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function run(script, args, expectFail) {
  try {
    const out = execFileSync(process.execPath, [join(here, script), ...args], { stdio: 'pipe' });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (err) {
    return {
      code: err.status === undefined ? 1 : err.status,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function auditJson(file, source) {
  const args = [file, '--json'];
  if (source) args.push('--source', source);
  const res = run('audit.mjs', args);
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHARED =
  'the intervention produced a consistent reduction in the reported symptom scores across all measurement points';
const SOURCE_TEXT =
  'Digital transformation in public sector organisations has attracted sustained scholarly attention. ' +
  SHARED +
  '. The evidence therefore suggests that organisational capability constitutes the binding constraint.';
const DRAFT_TEXT =
  'Across public sector organisations, digital transformation has drawn sustained scholarly attention. ' +
  SHARED +
  '. The evidence consequently suggests that organisational capability constitutes the binding constraint.';

const sourcePath = join(work, 'source.txt');
const draftPath = join(work, 'draft.txt');
writeFileSync(sourcePath, SOURCE_TEXT, 'utf8');
writeFileSync(draftPath, DRAFT_TEXT, 'utf8');

// A draft carrying an invisible zero-width space.
const zwsPath = join(work, 'draft-zwsp.txt');
writeFileSync(zwsPath, DRAFT_TEXT.replace('Across', 'A\u200Bcross'), 'utf8');

// A minimal but valid .docx built with the skill's own zip writer.
function buildDocx(paragraphs, extraParts) {
  const body = paragraphs
    .map((p) => '<w:p><w:r>' + (p.italic ? '<w:rPr><w:i/></w:rPr>' : '') + '<w:t>' + p.text + '</w:t></w:r></w:p>')
    .join('');
  return buildDocxFromBody(body, extraParts);
}

// The same package, built from a body that is already WordprocessingML.
function buildDocxFromBody(body, extraParts) {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '</w:body></w:document>';

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ];
  for (const part of extraParts || []) entries.push(part);
  return writeZip(entries);
}

// The plain text of a document, paragraph by paragraph.
function plainTextOf(xml) {
  const out = [];
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(m[0])) !== null) texts.push(t[1]);
    out.push(texts.join(''));
  }
  return out.join('\n');
}

const docxPath = join(work, 'doc.docx');
const planPath = join(work, 'plan.json');
writeFileSync(
  docxPath,
  buildDocx([
    { text: 'The intervention produced a consistent reduction in the reported symptom scores across all measurement points.' },
    { text: 'An italic sentence that must survive the rewrite unchanged.', italic: true },
    { text: 'A closing paragraph that carries no shared wording with the source.' },
  ])
);

const dupDocxPath = join(work, 'dup.docx');
writeFileSync(
  dupDocxPath,
  buildDocx([
    { text: 'A sentence that appears twice in the document.' },
    { text: 'A sentence that appears twice in the document.' },
    { text: 'A sentence that appears only once.' },
  ])
);

// A docx with an invisible character and a custom XML part that is NOT a
// content credential, so the purge tool must keep it.
const c2paDocxPath = join(work, 'c2pa.docx');
writeFileSync(
  c2paDocxPath,
  buildDocx([{ text: 'A paragraph carrying an invisible zero width space\u200B inside it.' }], [
    {
      name: 'customXml/item1.xml',
      data: Buffer.from('<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/>', 'utf8'),
    },
  ])
);

console.log('plagiarism-minimiser selftest');
console.log('work dir: ' + work);
console.log('');

// ---------------------------------------------------------------------------
// 1. Audit detects what it should
// ---------------------------------------------------------------------------

console.log('[1] audit detection');
{
  const rep = auditJson(draftPath, sourcePath);
  const sec = rep && rep.sections.find((s) => s.title.startsWith('1.'));
  check('audit reports a matched chain against the source', !!sec && sec.stats.chains >= 1, sec && JSON.stringify(sec.stats));
  check('audit estimates a non-zero similarity', !!sec && sec.stats.estimatedSimilarityPct > 0);

  const rep2 = auditJson(zwsPath);
  const inv = rep2 && rep2.sections.find((s) => s.title.startsWith('2.'));
  check('audit detects the zero-width space', !!inv && inv.verdict.level === 'bad', inv && inv.verdict.label);
  check('audit names the U+200B code point', !!inv && inv.items.some((i) => i.code === 'U+200B'));
}

// ---------------------------------------------------------------------------
// 2. Rewrite clears the chains and preserves structure
// ---------------------------------------------------------------------------

console.log('');
console.log('[2] rewrite');
{
  writeFileSync(
    planPath,
    JSON.stringify({
      replace: [
        {
          old: 'The intervention produced a consistent reduction in the reported symptom scores across all measurement points.',
          new: 'The programme yielded a steady fall in the symptom scores recorded at every measurement point.',
        },
      ],
      protect: ['An italic sentence that must survive the rewrite unchanged.'],
    }),
    'utf8'
  );

  const outPath = join(work, 'doc-out.docx');
  const res = run('rewrite-docx.mjs', [docxPath, '--out', outPath, '--plan', planPath]);
  check('rewrite exits cleanly', res.code === 0, res.stderr.slice(0, 200));
  check('rewrite wrote an output file', existsSync(outPath));

  if (existsSync(outPath)) {
    const text = extractText(outPath).text;
    check('replacement text is present', text.includes('The programme yielded a steady fall'));
    check('original text is gone', !text.includes('The intervention produced a consistent reduction'));
    check('protected text survived', text.includes('An italic sentence that must survive the rewrite unchanged.'));
    check('unrelated paragraph survived', text.includes('A closing paragraph that carries no shared wording'));

    const rep = auditJson(outPath, sourcePath);
    const sec = rep && rep.sections.find((s) => s.title.startsWith('1.'));
    check('no matched chain survives the rewrite', !!sec && sec.stats.chains === 0, sec && JSON.stringify(sec.stats));
  }
}

// ---------------------------------------------------------------------------
// 3. Rewrite guards abort and write nothing
// ---------------------------------------------------------------------------

console.log('');
console.log('[3] rewrite guards');
{
  const badPlan = join(work, 'bad-plan.json');
  writeFileSync(
    badPlan,
    JSON.stringify({ replace: [{ old: 'Text that is nowhere in the document.', new: 'x' }], protect: [] }),
    'utf8'
  );
  const out1 = join(work, 'should-not-exist-1.docx');
  const r1 = run('rewrite-docx.mjs', [docxPath, '--out', out1, '--plan', badPlan]);
  check('missing match aborts with a non-zero exit', r1.code !== 0);
  check('missing match writes no output file', !existsSync(out1));
  check('missing match explains itself', /no run found/i.test(r1.stdout + r1.stderr));

  const ambPlan = join(work, 'amb-plan.json');
  writeFileSync(
    ambPlan,
    JSON.stringify({ replace: [{ old: 'A sentence that appears twice in the document.', new: 'x' }], protect: [] }),
    'utf8'
  );
  const out2 = join(work, 'should-not-exist-2.docx');
  const r2 = run('rewrite-docx.mjs', [dupDocxPath, '--out', out2, '--plan', ambPlan]);
  check('ambiguous match aborts with a non-zero exit', r2.code !== 0);
  check('ambiguous match writes no output file', !existsSync(out2));
  check('ambiguous match explains itself', /expected exactly 1/i.test(r2.stdout + r2.stderr));

  const protPlan = join(work, 'prot-plan.json');
  writeFileSync(
    protPlan,
    JSON.stringify({
      replace: [{ old: 'A closing paragraph that carries no shared wording with the source.', new: 'x' }],
      protect: ['An italic sentence that must survive the rewrite unchanged.'],
    }),
    'utf8'
  );
  const out3 = join(work, 'should-not-exist-3.docx');
  const r3 = run('rewrite-docx.mjs', [docxPath, '--out', out3, '--plan', protPlan]);
  check('rewrite still succeeds when protection holds', r3.code === 0, r3.stderr.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 4. Purge removes invisible characters and keeps unrelated custom XML
// ---------------------------------------------------------------------------

console.log('');
console.log('[4] purge');
{
  const outPath = join(work, 'c2pa-out.docx');
  const res = run('purge.mjs', [c2paDocxPath, '--out', outPath]);
  check('purge exits cleanly', res.code === 0, res.stderr.slice(0, 200));
  check('purge wrote an output file', existsSync(outPath));

  if (existsSync(outPath)) {
    const rep = auditJson(outPath);
    const inv = rep && rep.sections.find((s) => s.title.startsWith('2.'));
    check('purged file has no invisible characters', !!inv && inv.verdict.level === 'ok', inv && inv.verdict.label);

    const raw = readFileSync(outPath);
    const asText = raw.toString('latin1');
    check('non-credential custom XML is kept', asText.includes('customXml/item1.xml'));

    const parts = readZip(raw);
    const custom = parts.find((p) => p.name === 'customXml/item1.xml');
    check('purge kept the bibliography content', !!custom && custom.data.toString('utf8').includes('bibliography'));
  }
}

// ---------------------------------------------------------------------------
// 5. Audit reports every section without crashing
// ---------------------------------------------------------------------------

console.log('');
console.log('[5] audit completeness');
{
  const rep = auditJson(draftPath, sourcePath);
  check('audit emits all eight sections', !!rep && rep.sections.length === 8, rep && String(rep.sections.length));
  check('audit reports a word count', !!rep && rep.words > 0);
  check('audit reports a summary verdict', !!rep && !!rep.summary);
  check(
    'audit reports compression entropy',
    !!rep && rep.sections.some((s) => s.title.includes('Compression entropy') && s.stats && s.stats.entropyBitsPerChar > 0)
  );
}

// ---------------------------------------------------------------------------
// 6. Transform engine, inflection library and rule banks
// ---------------------------------------------------------------------------

console.log('');
console.log('[6] transform engine');
{
  const outPath = join(work, 'transformed.txt');
  const r = run('transform.mjs', [sourcePath, '--out', outPath, '--source', sourcePath]);
  check('transform exits cleanly', r.code === 0, (r.stdout + r.stderr).slice(-140));
  const produced = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  check('transform produced output', produced.trim().length > 0, produced.length + ' chars');
  check('transform output has no null sentinel', !produced.includes('\u0000'));
  check('transform output has no mask residue', !/\u0000M/.test(produced));
  check('transform output has no double spaces', !/\S {2,}\S/.test(produced));
  check('transform output has no space before punctuation', !/\s+[.,;:!?]/.test(produced));

  const after = auditJson(outPath, sourcePath);
  const before = auditJson(sourcePath, sourcePath);
  const beforeChains = before && before.sections[0].stats.guaranteedChains;
  const afterChains = after && after.sections[0].stats.guaranteedChains;
  check(
    'transform removes guaranteed chains',
    afterChains !== undefined && beforeChains !== undefined && afterChains < beforeChains,
    beforeChains + ' -> ' + afterChains
  );

  const r2 = run('transform.mjs', [sourcePath, '--out', join(work, 't2.txt'), '--source', sourcePath]);
  check('transform exits cleanly on repeat', r2.code === 0);
  check(
    'transform is deterministic',
    existsSync(join(work, 't2.txt')) && readFileSync(join(work, 't2.txt'), 'utf8') === produced
  );

  // The inflection library has to keep the grammatical form of the original.
  const inflect = await import('./lib-inflect.mjs');
  check('inflect matches plural form', inflect.inflectMatch('study', 'studies') === 'studies');
  check('inflect matches third person', inflect.inflectMatch('examine', 'examines') === 'examines');
  check('inflect matches past tense', inflect.inflectMatch('examine', 'examined') === 'examined');
  check('inflect matches gerund', inflect.inflectMatch('examine', 'examining') === 'examining');
  check('inflect handles Latin plural', inflect.inflectMatch('analysis', 'analyses') === 'analyses');
  check('inflect leaves a multi-word replacement alone', inflect.inflectMatch('the state', 'Government') === 'The state');

  // Every rule bank has to be valid JSON with the expected shape. A bank whose
  // data is a list stores it under "items", so the MASH mark can travel with it.
  const rulesDir = join(here, '..', 'rules');
  for (const [file, kind] of [
    ['phrases.json', 'list'],
    ['synonyms.json', 'object'],
    ['determiners.json', 'object'],
    ['transitions.json', 'object'],
    ['discourse.json', 'object'],
    ['hedges.json', 'list'],
    ['protected_terms.json', 'list'],
    ['nominalisations.json', 'object'],
    ['appositives.json', 'object'],
  ]) {
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(join(rulesDir, file), 'utf8'));
    } catch (err) {
      parsed = null;
    }
    const shaped =
      parsed !== null &&
      (kind === 'list'
        ? !Array.isArray(parsed) && Array.isArray(parsed.items)
        : !Array.isArray(parsed));
    check('rule bank ' + file + ' is a valid ' + kind + ' bank', shaped);
    check('rule bank ' + file + ' carries the MASH mark', !!parsed && !!parsed._copyright);
  }

  const synonyms = JSON.parse(readFileSync(join(rulesDir, 'synonyms.json'), 'utf8'));
  const badMulti = [];
  for (const [lemma, value] of Object.entries(synonyms)) {
    if (lemma.startsWith('_')) continue;
    if (Array.isArray(value)) {
      for (const s of value) if (/\s/.test(String(s))) badMulti.push(lemma + ':' + s);
      continue;
    }
    // A multi-word entry is only allowed inside an explicit noun pool, where
    // the engine knows it cannot be inflected and will not try.
    for (const [pos, pool] of Object.entries(value)) {
      for (const s of pool) {
        if (/\s/.test(String(s)) && pos !== 'noun') badMulti.push(lemma + '.' + pos + ':' + s);
      }
    }
  }
  check('multi-word synonyms only appear in noun pools', badMulti.length === 0, badMulti.slice(0, 3).join(', '));

  // The engine must never produce a phrase that the audit then flags as a
  // machine marker. That would make the engine work against itself.
  // Only the forward direction matters: a replacement is a collision when it
  // CONTAINS a trigger phrase, because that is what the audit looks for.
  const { TRIGGER_PHRASES } = await import('./lib-text.mjs');
  const triggerPattern = new RegExp(
    '\\b(' + TRIGGER_PHRASES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
    'i'
  );
  const collisions = [];
  const scanValues = (value, label) => {
    const pools = Array.isArray(value) ? value : Array.isArray(value) ? value : [];
    for (const x of pools) {
      if (typeof x !== 'string') continue;
      if (triggerPattern.test(x)) collisions.push(label + ' -> ' + x);
    }
  };
  for (const [file, bank] of Object.entries({
    'phrases.json': JSON.parse(readFileSync(join(rulesDir, 'phrases.json'), 'utf8')),
    'synonyms.json': synonyms,
    'determiners.json': JSON.parse(readFileSync(join(rulesDir, 'determiners.json'), 'utf8')),
    'transitions.json': JSON.parse(readFileSync(join(rulesDir, 'transitions.json'), 'utf8')),
    'discourse.json': JSON.parse(readFileSync(join(rulesDir, 'discourse.json'), 'utf8')),
    'hedges.json': JSON.parse(readFileSync(join(rulesDir, 'hedges.json'), 'utf8')),
  })) {
    if (bank && Array.isArray(bank.items)) {
      for (const pair of bank.items) {
        for (const x of pair.slice(1)) {
          if (typeof x === 'string' && triggerPattern.test(x)) {
            collisions.push(file + ': ' + pair[0] + ' -> ' + x);
          }
        }
      }
      continue;
    }
    if (!bank || typeof bank !== 'object') continue;
    for (const [k, v] of Object.entries(bank)) {
      if (k.startsWith('_')) continue;
      if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === 'string' && triggerPattern.test(x)) {
            collisions.push(file + ': ' + k + ' -> ' + x);
          }
        }
      } else if (v && typeof v === 'object') {
        for (const [pos, pool] of Object.entries(v)) {
          for (const x of pool) {
            if (typeof x === 'string' && triggerPattern.test(x)) {
              collisions.push(file + ': ' + k + '.' + pos + ' -> ' + x);
            }
          }
        }
      }
    }
  }
  check('no rule bank produces a flagged machine phrase', collisions.length === 0, collisions.slice(0, 4).join(', '));
}

// ---------------------------------------------------------------------------
// 7. Justification
// ---------------------------------------------------------------------------

console.log('');
console.log('[7] justification');
{
  const justified = join(work, 'justified.docx');
  const r = run('justify-docx.mjs', [docxPath, '--out', justified]);
  check('justify exits cleanly', r.code === 0, (r.stdout + r.stderr).slice(-140));
  check('justify reports the alignment it set', /alignment after\s+:\s+both=/.test(r.stdout));

  const { readZip } = await import('./lib-zip.mjs');
  const { alignmentStats } = await import('./lib-justify.mjs');
  const xmlOf = (p) =>
    readZip(readFileSync(p)).find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml').data.toString('utf8');

  const beforeXml = xmlOf(docxPath);
  const afterXml = xmlOf(justified);
  const beforeAlign = alignmentStats(beforeXml);
  const afterAlign = alignmentStats(afterXml);

  check('the paragraph count is unchanged', beforeAlign.paragraphs === afterAlign.paragraphs,
    beforeAlign.paragraphs + ' -> ' + afterAlign.paragraphs);
  check('every body paragraph is justified',
    afterAlign.paragraphs > 0 && (afterAlign.counts.both || 0) === afterAlign.paragraphs,
    JSON.stringify(afterAlign.counts));
  check('no left, centre or right alignment is left in the body',
    !afterAlign.counts.left && !afterAlign.counts.center && !afterAlign.counts.right,
    JSON.stringify(afterAlign.counts));

  const tableOf = (x) => (x.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).join('');
  check('table XML is byte-identical', tableOf(beforeXml) === tableOf(afterXml));

  // Every package part other than word/document.xml must be untouched.
  const parts = readZip(readFileSync(justified));
  const original = readZip(readFileSync(docxPath));
  let partsOk = true;
  for (const part of original) {
    if (part.name.replace(/\\/g, '/') === 'word/document.xml') continue;
    const other = parts.find((x) => x.name === part.name);
    if (!other || !other.data.equals(part.data)) partsOk = false;
  }
  check('every other package part is byte-identical', partsOk);

  // The rewrite script justifies by default and can be told not to.
  const rewritten = join(work, 'rewritten-justified.docx');
  const rw = run('rewrite-docx.mjs', [docxPath, '--out', rewritten, '--plan', planPath]);
  check('rewrite exits cleanly', rw.code === 0, (rw.stdout + rw.stderr).slice(-140));
  check('rewrite reports that it justified the document', /Body paragraphs justified\s+:\s+[1-9]/.test(rw.stdout),
    rw.stdout.slice(-200));
  check('the rewritten document is justified',
    (alignmentStats(xmlOf(rewritten)).counts.both || 0) === alignmentStats(xmlOf(rewritten)).paragraphs);

  const plain = join(work, 'rewritten-plain.docx');
  const rp = run('rewrite-docx.mjs', [docxPath, '--out', plain, '--plan', planPath, '--no-justify']);
  check('rewrite with --no-justify exits cleanly', rp.code === 0);
  check('rewrite with --no-justify keeps the original alignment',
    JSON.stringify(alignmentStats(xmlOf(plain)).counts) === JSON.stringify(beforeAlign.counts),
    JSON.stringify(alignmentStats(xmlOf(plain)).counts));

  // The audit has to report the alignment.
  const rep = auditJson(justified, sourcePath);
  const alignSection = rep && rep.sections.find((s) => s.title.includes('alignment'));
  check('audit reports a paragraph alignment section', !!alignSection);
  check('audit reports the document as justified',
    !!alignSection && alignSection.verdict.label === 'JUSTIFIED',
    alignSection && alignSection.verdict.label);
}

// ---------------------------------------------------------------------------
// 8. Content guards
// ---------------------------------------------------------------------------

console.log('');
console.log('[8] content guards');
{
  const guard = await import('./lib-guard.mjs');

  check('a numbered heading is recognised',
    guard.looksLikeHeading('2.4 Adaptive and Robust Control Strategies'));
  check('a third-level heading is recognised',
    guard.looksLikeHeading('5.1.1 Physical Structures'));
  check('an appendix heading is recognised',
    guard.looksLikeHeading('A.1 Complete MATLAB Simulation Script'));
  check('a sentence starting with a number is not a heading',
    !guard.looksLikeHeading('2050 is the target year for the whole industry'));
  check('ordinary prose is not a heading',
    !guard.looksLikeHeading('The aircraft reaches the reference quickly under nominal conditions.'));

  check('a code listing is recognised',
    guard.looksLikeCode('K_nominal = 1.0;      % Control gain (dimensionless)'));
  check('a code comment is recognised',
    guard.looksLikeCode('% Authors: Dr Mohammad N. Hasan'));
  check('a code section marker is recognised',
    guard.looksLikeCode('%% SECTION 1: COMMON PARAMETERS AND SYSTEM SETUP'));
  check('a code call is recognised',
    guard.looksLikeCode("figure('Position',[100 100 1000 700],'Color','w');"));
  check('an indexed assignment is recognised',
    guard.looksLikeCode('[rise_est(i), os_est(i)] = rise_os(t(:), y_est);'));
  check('a tuple assignment is recognised',
    guard.looksLikeCode('K0, ZETA0, WN0 = 1.0, 0.1, 1.0          # nominal plant'));
  check('a subscript assignment is recognised',
    guard.looksLikeCode('m["pm"], m["wc"], m["gm"] = margins(L)'));
  check('a docstring is recognised',
    guard.looksLikeCode('    """Icing severity sev = fractional loss of control effectiveness."""'));
  check('a tuple assignment with expressions is recognised',
    guard.looksLikeCode('K, z, wn = K0 * (1 - s_k), ZETA0 * (1 + f_z), WN0 * np.sqrt(1 - s_k)'));
  check('prose with a semicolon is not code',
    !guard.looksLikeCode('The nominal parameters were selected as follows: control gain K = 1.0; damping ratio was 0.1.'));
  check('a numbered list item is not code',
    !guard.looksLikeCode('(1) To make a computer model that shows how ice affects the aircraft.'));
  check('prose is not code',
    !guard.looksLikeCode('Aircraft icing happens when supercooled water droplets in clouds hit the surfaces.'));

  check('a figure label is recognised', guard.looksLikeLabel('Figure 1'));
  check('a table label is recognised', guard.looksLikeLabel('Table 6'));
  check('a table note is recognised', guard.looksLikeNote('Note. IAE = integral of absolute error over 15 s.'));
  check('a quoted file name is recognised', guard.looksLikeFilename("Save the code as 'Main_Script_All_Figures.m'"));

  // The sequence: a caption sits under its label, and a reference entry sits
  // under the References heading.
  const kinds = guard.classifySequence([
    { text: 'A Computational Evaluation of In-Flight Icing Impacts', style: '' },
    { text: 'Abstract', style: '' },
    { text: 'A body paragraph long enough to be rewritten by the engine.', style: '' },
    { text: '2.4 Adaptive and Robust Control Strategies', style: '' },
    { text: 'Figure 1', style: '' },
    { text: 'Closed-Loop Control System', style: '', italicAll: true },
    { text: 'Note. The pitch reference is compared with the measured pitch angle.', style: '', italicAll: true },
    { text: 'K_nominal = 1.0;', style: '' },
    { text: 'References', style: '' },
    { text: 'Gryte, K., Kleiven, R., & Johansen, T. A. (2022). Robust flight control.', style: '', italicAll: true },
  ]);
  check('the title is recognised', kinds[0] === 'title', kinds[0]);
  check('body prose stays prose', kinds[2] === 'prose', kinds[2]);
  check('a heading is guarded', kinds[3] === 'heading', kinds[3]);
  check('a figure label is guarded', kinds[4] === 'label', kinds[4]);
  check('a caption is guarded', kinds[5] === 'caption', kinds[5]);
  check('a note is guarded', kinds[6] === 'caption', kinds[6]);
  check('code is guarded', kinds[7] === 'code', kinds[7]);
  check('the References heading is guarded', kinds[8] === 'heading', kinds[8]);
  check('a reference entry is guarded', kinds[9] === 'reference', kinds[9]);

  // A short centred paragraph is a display element, not body prose.
  const centred = guard.classifySequence([
    { text: 'A body paragraph that is long enough to be rewritten by the engine.', style: '' },
    { text: 'Abstract', style: '', align: 'center' },
    { text: 'Dr Mohammad N. Hasan, Murad Nizam, and Khaled Bhuiyan', style: '', align: 'center' },
    { text: 'A centred paragraph that runs on for a while and finishes with a full stop.', style: '', align: 'center' },
  ]);
  check('a centred abstract heading is guarded', centred[1] === 'heading', centred[1]);
  check('a centred author block is guarded', centred[2] === 'heading', centred[2]);
  check('a centred sentence stays prose', centred[3] === 'prose', centred[3]);

  // The engine must leave a code listing alone even when the document uses no
  // Word styles at all, which is the normal case for a submitted manuscript.
  const codeDocx = join(work, 'code.docx');
  const codePlan = join(work, 'code-plan.json');
  const codeText = 'K_nominal = 1.0;      % Control gain (dimensionless)';
  const codeBody = 'The aircraft reaches the reference quickly under nominal conditions in this simulation.';
  writeFileSync(codeDocx, buildDocx([{ text: codeBody }, { text: codeText }]));
  const cr = run('transform.mjs', [codeDocx, '--out', join(work, 'code-out.txt'), '--plan', codePlan, '--dry-run']);
  check('transform exits cleanly on a code document', cr.code === 0, (cr.stdout + cr.stderr).slice(-140));
  const codePlanJson = JSON.parse(readFileSync(codePlan, 'utf8'));
  const touchedCode = (codePlanJson.replace || []).some((e) => e.old === codeText);
  check('the engine does not touch a code listing', !touchedCode);

  // A heading without a Word style must survive too.
  const headDocx = join(work, 'head.docx');
  const headPlan = join(work, 'head-plan.json');
  const headText = '2.4 Adaptive and Robust Control Strategies for Icing Effects';
  const headBody = 'The aircraft reaches the reference quickly under nominal conditions in this simulation.';
  writeFileSync(headDocx, buildDocx([{ text: headBody }, { text: headText }]));
  const hr = run('transform.mjs', [headDocx, '--out', join(work, 'head-out.txt'), '--plan', headPlan, '--dry-run']);
  check('transform exits cleanly on a heading document', hr.code === 0);
  const headPlanJson = JSON.parse(readFileSync(headPlan, 'utf8'));
  const touchedHead = (headPlanJson.replace || []).some((e) => e.old === headText);
  check('the engine does not touch a heading without a Word style', !touchedHead);

  // A quoted file name has to reach the reader exactly as it was written.
  const nameDocx = join(work, 'name.docx');
  const namePlan = join(work, 'name-plan.json');
  const nameText =
    "The following script generates the figures; save the code as 'Main_Script_All_Figures.m' and run it to reproduce them.";
  writeFileSync(nameDocx, buildDocx([{ text: nameText }]));
  const nr = run('transform.mjs', [nameDocx, '--out', join(work, 'name-out.txt'), '--plan', namePlan, '--dry-run']);
  check('transform exits cleanly on a file-name document', nr.code === 0);
  const namePlanJson = JSON.parse(readFileSync(namePlan, 'utf8'));
  const nameKept = (namePlanJson.replace || []).every((e) => e.new.includes('Main_Script_All_Figures.m'));
  check('a quoted file name survives the rewrite', nameKept,
    (namePlanJson.replace || []).map((e) => e.new).join(' ').slice(0, 120));
}

// ---------------------------------------------------------------------------
// 9. The six formatting rules
// ---------------------------------------------------------------------------

console.log('');
console.log('[9] formatting rules');
{
  // A document with a cover page, a citation, a table whose borders are
  // broken in the way a submitted manuscript breaks them, an italic heading
  // and a reference list.
  const bodyXml =
    '<w:p><w:r><w:t xml:space="preserve">A Computational Evaluation of In-Flight Icing Impacts on Flight Control Systems</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Dr Mohammad N. Hasan, Murad Nizam, and Khaled Bhuiyan</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">RBT Systems LTD, Manchester, the United Kingdom</w:t></w:r></w:p>' +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">1. Introduction</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Icing changes how aircraft fly and handle in various ways (Broeren et al., 2008; Wallisch et al., 2024).</w:t></w:r></w:p>' +
    '<w:tbl>' +
    '<w:tblPr><w:tblBorders>' +
    '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '</w:tblBorders></w:tblPr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>' +
    '<w:tcBorders><w:left w:val="none" w:color="FFFFFF" w:sz="0"/><w:right w:val="none" w:color="FFFFFF" w:sz="0"/></w:tcBorders>' +
    '</w:tcPr><w:p><w:r><w:t>Scenario</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>' +
    '<w:tcBorders><w:left w:val="none" w:color="FFFFFF" w:sz="0"/><w:right w:val="none" w:color="FFFFFF" w:sz="0"/></w:tcBorders>' +
    '</w:tcPr><w:p><w:r><w:t>Rise time</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Nominal</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>0.91</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '</w:tbl>' +
    '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>5.1.1 Physical Structures</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>References</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Broeren, A. P., Bragg, M., Addy, H. E., Lee, S., Moens, F., &amp; Guffond, D. (2008). Effect of high-fidelity ice accretion simulations. 46th AIAA Aerospace Sciences Meeting and Exhibit.</w:t></w:r></w:p>';

  const formatDocxPath = join(work, 'format.docx');
  writeFileSync(formatDocxPath, buildDocxFromBody(bodyXml));

  const result = applyFormatting(bodyXml);
  const out = result.xml;

  // The text must come out of the formatting pass untouched.
  const textBefore = plainTextOf(bodyXml);
  const textAfter = plainTextOf(out);
  check('the formatting pass does not change the text', textBefore === textAfter,
    textBefore.slice(0, 60) + ' != ' + textAfter.slice(0, 60));
  check('the formatting pass does not lose a paragraph',
    (out.match(/<w:p\b[^>]*>/g) || []).length === (bodyXml.match(/<w:p\b[^>]*>/g) || []).length);

  // Rule 1: "et al." is italic.
  const etAlRuns = [];
  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let r;
  while ((r = runRe.exec(out)) !== null) {
    const t = r[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    if (!t) continue;
    const rPr = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/);
    const italic = rPr ? /<w:i\s*\/>/.test(rPr[0]) : false;
    etAlRuns.push({ text: t[1], italic });
  }
  const etAlItalic = etAlRuns.filter((x) => /et\s+al\./i.test(x.text) && x.italic);
  const etAlPlain = etAlRuns.filter((x) => /et\s+al\./i.test(x.text) && !x.italic);
  check('every "et al." is italic', etAlItalic.length === 2 && etAlPlain.length === 0,
    'italic=' + etAlItalic.length + ' plain=' + etAlPlain.length);
  check('the words around "et al." are not italic',
    etAlRuns.some((x) => !x.italic && x.text.includes('Icing changes how aircraft fly')));

  // Rule 2: table borders and the first row.
  const tblRanges = findTables(out);
  check('the table is still there', tblRanges.length === 1, 'tables=' + tblRanges.length);
  const tbl = out.slice(tblRanges[0].start, tblRanges[0].end);
  const tb = tbl.match(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/);
  const tblEdges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
  check('the table carries all six borders',
    !!tb && tblEdges.every((e) => new RegExp('<w:' + e + '\\b[^>]*w:val="single"').test(tb[0])));
  const rows = findElements(tbl, 'w:tr');
  const cells = [];
  for (const row of rows) {
    for (const c of findElements(tbl.slice(row.start, row.end), 'w:tc')) {
      cells.push(tbl.slice(row.start, row.end).slice(c.start, c.end));
    }
  }
  const cellEdges = ['top', 'left', 'bottom', 'right'];
  const cellsWithBorders = cells.filter((c) => {
    const cb = c.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/);
    return cb && cellEdges.every((e) => new RegExp('<w:' + e + '\\b[^>]*w:val="single"').test(cb[0]));
  });
  check('every cell carries all four borders', cells.length === 4 && cellsWithBorders.length === 4,
    'cells=' + cells.length + ' withBorders=' + cellsWithBorders.length);
  const header = cells.slice(0, 2);
  check('the first row cells are aligned to the top',
    header.every((c) => /<w:vAlign\b[^>]*w:val="top"/.test(c)));
  check('the first row text is centred',
    header.every((c) => /<w:jc\b[^>]*w:val="center"/.test(c)));
  check('the second row is left alone', !/<w:vAlign\b[^>]*w:val="top"/.test(cells[2]));

  // Rule 3: the cover page is centred.
  const breakAt = out.indexOf('<w:br w:type="page"/>');
  const coverEnd = breakAt === -1
    ? -1
    : (out.slice(0, breakAt).match(/<w:p\b[^>]*>/g) || []).length - 1;
  const paras = out.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  const coverParas = paras.slice(0, coverEnd + 1);
  check('the cover page is centred',
    coverParas.length === 4 && coverParas.every((p) => /<w:jc\b[^>]*w:val="center"/.test(p)),
    'coverParas=' + coverParas.length);
  check('the body text is not centred',
    !/<w:jc\b[^>]*w:val="center"/.test(paras[5]));

  // Rule 4: one and a half lines.
  const bodyPara = paras[5];
  check('the body text is set at one and a half lines',
    /<w:spacing\b[^>]*w:line="360"[^>]*w:lineRule="auto"/.test(bodyPara),
    (bodyPara.match(/<w:spacing\b[^>]*>/) || ['none'])[0]);

  // Rule 5: the reference list is justified.
  const refPara = paras[paras.length - 1];
  check('the reference list is justified', /<w:jc\b[^>]*w:val="both"/.test(refPara));
  check('the body text is justified as well', /<w:jc\b[^>]*w:val="both"/.test(bodyPara));

  // Rule 6: no italic in a heading.
  const headPara = paras.find((p) => p.includes('5.1.1 Physical Structures'));
  check('the italic heading is not italic any more',
    !!headPara && /<w:i w:val="0"\/>/.test(headPara) && !/<w:i\/>/.test(headPara));

  // The whole rule set can be switched off.
  const none = applyFormatting(bodyXml, {
    justify: false,
    justifyReferences: false,
    lineSpacing: 0,
    coverCentred: false,
    tableBorders: false,
    tableHeaderAligned: false,
    headingItalicOff: false,
    citationEtAl: 'keep',
  });
  check('every rule can be switched off', none.xml === bodyXml,
    'the document changed by ' + (none.xml.length - bodyXml.length) + ' characters');

  // The command line tool.
  const formatOut = join(work, 'format-out.docx');
  const fr = run('format-docx.mjs', [formatDocxPath, '--out', formatOut]);
  check('format-docx exits cleanly', fr.code === 0, (fr.stdout + fr.stderr).slice(-160));
  check('format-docx writes the file', existsSync(formatOut));
  if (existsSync(formatOut)) {
    const written = readZip(readFileSync(formatOut));
    const docPart = written.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
    const writtenXml = docPart ? docPart.data.toString('utf8') : '';
    check('the written file carries the formatting', /<w:jc w:val="center"/.test(writtenXml) &&
      /w:line="360"/.test(writtenXml) && /<w:i w:val="0"\/>/.test(writtenXml));
    check('the package keeps every part', written.length === 3, 'parts=' + written.length);
  }

  // The rewrite tool applies the rules as well.
  const rewriteOut = join(work, 'rewrite-out.docx');
  const rewritePlan = join(work, 'rewrite-plan.json');
  writeFileSync(rewritePlan, JSON.stringify({
    replace: [{
      old: 'Icing changes how aircraft fly and handle in various ways (Broeren et al., 2008; Wallisch et al., 2024).',
      new: 'Accumulated ice alters the way an aircraft flies and behaves (Broeren et al., 2008; Wallisch et al., 2024).',
      paragraph: true,
    }],
    protect: ['Wallisch et al.'],
  }));
  const rr = run('rewrite-docx.mjs', [formatDocxPath, '--out', rewriteOut, '--plan', rewritePlan]);
  check('rewrite-docx exits cleanly with the formatting on', rr.code === 0, (rr.stdout + rr.stderr).slice(-200));
  check('rewrite-docx reports the formatting rules', /Rule 6/.test(rr.stdout), rr.stdout.slice(-160));
  if (existsSync(rewriteOut)) {
    const written = readZip(readFileSync(rewriteOut));
    const docPart = written.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
    const writtenXml = docPart ? docPart.data.toString('utf8') : '';
    check('the rewritten file carries the formatting', /w:line="360"/.test(writtenXml) &&
      /<w:jc w:val="center"/.test(writtenXml));
    check('the rewritten file kept the protected text',
      plainTextOf(writtenXml).includes('Wallisch et al.'),
      plainTextOf(writtenXml).slice(0, 120));
  }

  // The formatting must survive a second pass without changing anything.
  const twice = applyFormatting(result.xml);
  check('the formatting is stable when it runs twice', twice.xml === result.xml,
    'the second pass changed ' + (twice.xml.length - result.xml.length) + ' characters');
}

// ---------------------------------------------------------------------------
// 10. The engine must not break the grammar
// ---------------------------------------------------------------------------

console.log('');
console.log('[10] grammar guards');
{
  const hedgeBank = JSON.parse(readFileSync(join(here, '..', 'rules', 'hedges.json'), 'utf8'));
  const hedges = (hedgeBank.items || hedgeBank).filter((h) => !String(h).startsWith('_'));

  // A document in which every comma that could take a hedge is in a place
  // where a hedge does not belong. If the engine inserts one anyway, the
  // guard has failed.
  const badPlaces = [];
  for (let i = 0; i < 30; i++) {
    badPlaces.push('Under nominal conditions, the controller reaches the reference quickly and the error at fifteen seconds is small.');
    badPlaces.push('When the controller under-estimates the severity by fifteen points, the rise time is longer than it should be for the aircraft.');
    badPlaces.push('The adaptive controller uses energy, and it can destabilise the flight control system in icing conditions.');
  }
  const badPath = join(work, 'bad-places.txt');
  const badOut = join(work, 'bad-places-out.txt');
  writeFileSync(badPath, badPlaces.join('\n\n'), 'utf8');
  const br = run('transform.mjs', [badPath, '--out', badOut, '--intensity', 'heavy']);
  check('transform exits cleanly on the grammar document', br.code === 0, (br.stdout + br.stderr).slice(-140));
  const badText = existsSync(badOut) ? readFileSync(badOut, 'utf8') : '';
  const inserted = hedges.filter((h) => new RegExp('\\b' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(badText));
  check('no hedge is inserted where it does not belong', inserted.length === 0,
    inserted.slice(0, 4).join(', '));
  check('the text is still there', badText.split(/\s+/).length > badPlaces.join(' ').split(/\s+/).length * 0.9);

  // A split must not strand a "that" clause.
  const thatPath = join(work, 'that.txt');
  const thatOut = join(work, 'that-out.txt');
  writeFileSync(thatPath,
    'The simulation shows that the model solves its equations correctly to round-off error against two independent solvers, and that the energy values are insensitive to the time step to within about 0.3% across the range.',
    'utf8');
  run('transform.mjs', [thatPath, '--out', thatOut, '--intensity', 'heavy']);
  const thatText = existsSync(thatOut) ? readFileSync(thatOut, 'utf8') : '';
  check('a split does not strand a "that" clause', !/\.\s+That\s+the\s+energy/.test(thatText),
    thatText.slice(0, 140));

  // A split must not break an enumerated list.
  const listPath = join(work, 'list.txt');
  const listOut = join(work, 'list-out.txt');
  writeFileSync(listPath,
    'This research makes the following contributions: (1) Quantification of icing effects on longitudinal dynamics through verified computational simulation; (2) Demonstration of autopilot performance degradation under various icing severities with quantitative metrics; (3) Design and evaluation of an adaptive retuning strategy, including the control effort it costs to restore nominal rise time.',
    'utf8');
  run('transform.mjs', [listPath, '--out', listOut, '--intensity', 'heavy']);
  const listText = existsSync(listOut) ? readFileSync(listOut, 'utf8') : '';
  check('a split does not break an enumerated list', /\(1\)/.test(listText) && /\(2\)/.test(listText) && /\(3\)/.test(listText),
    listText.slice(0, 140));

  // A split must not break a colon list.
  const colonPath = join(work, 'colon.txt');
  const colonOut = join(work, 'colon-out.txt');
  writeFileSync(colonPath,
    'In icing conditions without controller adaptation the main change is that the aircraft becomes slower: rise time of 1.07 seconds against 0.91 seconds; overshoot of 5.4% against 7.4%; error at 15 seconds of 19.9% against 20.7%.',
    'utf8');
  run('transform.mjs', [colonPath, '--out', colonOut, '--intensity', 'heavy']);
  const colonText = existsSync(colonOut) ? readFileSync(colonOut, 'utf8') : '';
  check('a split does not break a colon list', /becomes slower:/.test(colonText) && !/becomes slower\./.test(colonText),
    colonText.slice(0, 140));

  // A noun phrase with a relative clause is not a clause.
  const relPath = join(work, 'relative.txt');
  const relOut = join(work, 'relative-out.txt');
  writeFileSync(relPath,
    'The contribution of this study is the quantified trade-off in three and four, which earlier studies of icing-tolerant control do not report together, and the open framework that produced it.',
    'utf8');
  run('transform.mjs', [relPath, '--out', relOut, '--intensity', 'heavy']);
  const relText = existsSync(relOut) ? readFileSync(relOut, 'utf8') : '';
  check('a split does not treat a relative clause as a clause', !/\.\s+The\s+open\s+framework/.test(relText),
    relText.slice(0, 140));

  // A fronted phrase is not moved past a contrast or a trailing reference.
  const frontPath = join(work, 'fronted.txt');
  const frontOut = join(work, 'fronted-out.txt');
  writeFileSync(frontPath,
    'With adaptive retuning, the increased proportional gain restores control authority, but the elevator is driven harder at the same peak rate of two point three radians (Figure 3).',
    'utf8');
  run('transform.mjs', [frontPath, '--out', frontOut, '--intensity', 'heavy']);
  const frontText = existsSync(frontOut) ? readFileSync(frontOut, 'utf8') : '';
  check('a fronted phrase is not moved past a contrast', /^With adaptive retuning/.test(frontText.trim()),
    frontText.slice(0, 140));

  // "all" cannot be swapped for a word that needs a singular noun.
  const detPath = join(work, 'det.txt');
  const detOut = join(work, 'det-out.txt');
  writeFileSync(detPath, 'All metrics are reported for every severity level.', 'utf8');
  run('transform.mjs', [detPath, '--out', detOut, '--intensity', 'heavy']);
  const detText = existsSync(detOut) ? readFileSync(detOut, 'utf8') : '';
  check('"all metrics" does not become "entire metrics"', !/entire metrics/i.test(detText) && !/every metrics/i.test(detText),
    detText.slice(0, 120));

  // A line of code inside a run of code is left alone.
  const codeBody =
    '<w:p><w:r><w:t>x = 1.0;</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>y = x * 2.0;</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>scenario("Iced (Adapted)", 0.2, KP * K0 / plant(0.2)[0])]</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>z = 3.0;</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>w = 4.0;</w:t></w:r></w:p>';
  const codePath = join(work, 'code.docx');
  writeFileSync(codePath, buildDocxFromBody(codeBody));
  const codePlan = join(work, 'code-plan.json');
  const cr = run('transform.mjs', [codePath, '--out', join(work, 'code-out.txt'), '--plan', codePlan, '--intensity', 'heavy']);
  check('transform exits cleanly on a code document', cr.code === 0, (cr.stdout + cr.stderr).slice(-140));
  if (existsSync(codePlan)) {
    const codePlanJson = JSON.parse(readFileSync(codePlan, 'utf8'));
    const touched = (codePlanJson.replace || []).map((e) => e.old);
    check('a code line inside a listing is left alone',
      !touched.some((t) => /scenario\(/.test(t)),
      touched.filter((t) => /scenario\(/.test(t)).join(' | ').slice(0, 120));
  }
}

// ---------------------------------------------------------------------------
// 11. The detector-pressure work: the stock words, the cadence and the
//     run-preserving rewrite
// ---------------------------------------------------------------------------

console.log('');
console.log('[11] detector pressure: stock words, cadence and mixed runs');
{
  const { inflectMatch, detectForm } = await import('./lib-inflect.mjs');
  const { repairCadence, splitCandidate, cadenceStats, wordCount } = await import('./lib-rhythm.mjs');

  // --- inflection ---------------------------------------------------------
  check('a third person verb keeps its third person form',
    detectForm('demonstrates').lemma === 'demonstrate' && detectForm('demonstrates').form === 'third',
    JSON.stringify(detectForm('demonstrates')));
  check('an irregular third person form is not read as a plural',
    detectForm('shows').form === 'third', JSON.stringify(detectForm('shows')));
  check('a replacement that already has the right form is not inflected again',
    inflectMatch('shows', 'demonstrates') === 'shows', inflectMatch('shows', 'demonstrates'));
  check('a replacement is inflected to the form of the original',
    inflectMatch('show', 'demonstrates') === 'shows', inflectMatch('show', 'demonstrates'));

  // --- the stock word stage ------------------------------------------------
  const tellsPath = join(work, 'tells.txt');
  const tellsOut = join(work, 'tells-out.txt');
  writeFileSync(tellsPath,
    'The study demonstrated that the framework is robust and comprehensive across the range.\n\n' +
    'The controller takes the severity into account and the response changes markedly.\n\n' +
    'The method was based on robust-augmented control for the whole fleet.\n\n' +
    'Robust Control Strategies for eVTOL aircraft are the topic of Section 2.4.\n\n' +
    'The results are significantly better and the outcome is more notable than before.',
    'utf8');
  run('transform.mjs', [tellsPath, '--out', tellsOut, '--safe']);
  const tellsText = existsSync(tellsOut) ? readFileSync(tellsOut, 'utf8') : '';
  check('"demonstrated" becomes "showed"', /The study showed that/.test(tellsText), tellsText.slice(0, 120));
  check('"robust" becomes "resilient"', /resilient and thorough/.test(tellsText), tellsText.slice(0, 160));
  check('"significantly" becomes "markedly"', /markedly better/.test(tellsText), tellsText.slice(0, 240));
  check('a compound keeps its first half', /robust-augmented control/.test(tellsText), tellsText.slice(0, 300));
  check('a capitalised word inside a sentence is left alone', /Robust Control Strategies/.test(tellsText), tellsText.slice(0, 360));

  // --- the guards ----------------------------------------------------------
  const guardPath = join(work, 'guards.txt');
  const guardOut = join(work, 'guards-out.txt');
  writeFileSync(guardPath,
    'How many water drops hit the surface depends on the collection efficiency of the air.\n\n' +
    'Many are floating around in the cloud, and the temperature also matters for the result.\n\n' +
    'The controller takes the severity into account before it changes the gain of the loop.\n\n' +
    'They also found that when the elevator is iced, it produces a lot more lift than when it is clean.\n\n' +
    'The approach is a major factor in the study, and the factor was measured across the range.',
    'utf8');
  run('transform.mjs', [guardPath, '--out', guardOut, '--intensity', 'heavy']);
  const guardText = existsSync(guardOut) ? readFileSync(guardOut, 'utf8') : '';
  check('"how many" is not turned into "how numerous"', !/how numerous/i.test(guardText), guardText.slice(0, 160));
  check('"many are" is not turned into "numerous are"', !/numerous are/i.test(guardText), guardText.slice(0, 220));
  check('a phrasal verb keeps its particle', !/(adopt|employ|undertake) into account/i.test(guardText), guardText.slice(0, 320));
  check('no hedge lands inside a subordinate clause',
    !/is iced,\s+\w+,\s+it produces/i.test(guardText), guardText.slice(0, 460));
  check('the rewrite does not write a stock phrase that was not there',
    !/significant role/i.test(guardText), guardText.slice(0, 520));

  // --- the cadence ---------------------------------------------------------
  const flat = [
    'The results show that the response is slower.',
    'The overshoot is lower than the nominal value.',
    'The energy use is higher than before.',
    'The phase margin is close to the clean value.',
  ];
  const flatLengths = flat.map((s) => wordCount(s));
  const flatCv = cadenceStats(flatLengths).cv;
  const repaired = repairCadence(flat, {
    isClause: () => true,
    verbIndex: () => 2,
    lowerCaseOpener: (s) => s.charAt(0).toLowerCase() + s.slice(1),
    isBlockedOpener: () => false,
    config: { targetCv: 0.55, maxJoinWords: 34, maxSemicolonJoins: 1 },
  });
  check('a flat paragraph is measured as flat', flatCv < 0.35, String(flatCv));
  check('the cadence repair raises the variation of a flat paragraph',
    repaired.cv > flatCv, flatCv + ' -> ' + repaired.cv);
  check('the cadence repair never lowers the variation', repaired.cv >= flatCv);

  const colonSplit = splitCandidate(
    'The main change is that the aircraft becomes slower: rise time of 1.07 seconds, overshoot of 5.4% and error of 19.9%.',
    { isClause: () => true }
  );
  check('a colon list is never cut in half', colonSplit === null, JSON.stringify(colonSplit));

  const tailSplit = splitCandidate(
    'The rise time was 1.07 seconds, and the overshoot is 5.4% compared with the nominal value of 7.4%.',
    { isClause: () => true, verbIndex: () => 3 }
  );
  check('a split leaves a subject on both sides',
    tailSplit !== null && /^[A-Z]/.test(tailSplit.right), JSON.stringify(tailSplit));

  // --- the run-preserving rewrite -----------------------------------------
  const mixedBody =
    '<w:p><w:r><w:t>Recent work (Gryte et al. </w:t></w:r>' +
    '<w:r><w:rPr><w:i/></w:rPr><w:t>et al.</w:t></w:r>' +
    '<w:r><w:t>, 2022) has shown that the controller is robust and that the energy use rises when the ice forms on the rotor blades of the aircraft, and that the phase margin falls.</w:t></w:r></w:p>';
  const mixedPath = join(work, 'mixed.docx');
  const mixedOut = join(work, 'mixed-out.docx');
  const mixedPlan = join(work, 'mixed-plan.json');
  writeFileSync(mixedPath, buildDocxFromBody(mixedBody));
  const mr = run('transform.mjs', [mixedPath, '--plan', mixedPlan, '--safe', '--rules', join(here, '..', 'rules')]);
  check('transform handles a paragraph with mixed run formatting', mr.code === 0, (mr.stdout + mr.stderr).slice(-140));
  let mixedPlanJson = null;
  try {
    mixedPlanJson = JSON.parse(readFileSync(mixedPlan, 'utf8'));
  } catch (err) {
    mixedPlanJson = null;
  }
  check('the mixed paragraph is put into the plan', !!mixedPlanJson && (mixedPlanJson.replace || []).length > 0);
  if (mixedPlanJson && (mixedPlanJson.replace || []).length) {
    const wr = run('rewrite-docx.mjs', [mixedPath, '--out', mixedOut, '--plan', mixedPlan]);
    check('rewrite-docx applies the mixed paragraph', wr.code === 0, (wr.stdout + wr.stderr).slice(-200));
    if (existsSync(mixedOut)) {
      const entriesOut = readZip(readFileSync(mixedOut));
      const docOut = entriesOut.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
      const xmlOut = docOut.data.toString('utf8');
      const italicEtAl = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:i\/>[\s\S]*?<w:t[^>]*>et al\.<\/w:t>/.test(xmlOut);
      check('the italic "et al." survives the rewrite', italicEtAl);
      check('the rewritten text is in the document', /resilient/.test(xmlOut) || /robust/.test(xmlOut));
    }
  }

  // --- the pressure analyser ------------------------------------------------
  const pressure = run('detector-pressure.mjs', [mixedPath, '--json']);
  check('the pressure analyser runs', pressure.code === 0, (pressure.stdout + pressure.stderr).slice(-160));
  let pressureJson = null;
  try {
    pressureJson = JSON.parse(pressure.stdout);
  } catch (err) {
    pressureJson = null;
  }
  check('the pressure analyser reports the four signal families',
    !!pressureJson && !!pressureJson.burstiness && !!pressureJson.perplexityProxy &&
    !!pressureJson.sentenceOpenings && !!pressureJson.discourse,
    pressureJson ? 'ok' : 'no json');
  check('the pressure analyser says that it is a proxy',
    /proxy/i.test(pressure.stdout), pressure.stdout.slice(0, 120));
}

// ---------------------------------------------------------------------------
// 12. The citation engine: styles, cross-checks, links and the style rules
// ---------------------------------------------------------------------------

console.log('');
console.log('[12] the citation engine');
{
  const {
    crossCheck,
    isPlaceholderReference,
    loadStyleBank,
    nameCandidates,
    parseCitations,
    parseReference,
    sameName,
    validateDoi,
    validateUrl,
  } = await import('./lib-citations.mjs');

  const bank = loadStyleBank(join(here, '..', 'rules'));
  check('the style bank holds the styles', bank.names.length >= 12, String(bank.names.length));
  check('Harvard asks for an italic abbreviation', bank.get('harvard').etaItalic === true);
  check('APA asks for a roman abbreviation', bank.get('apa7').etaItalic === false);
  check('a style can be found by its label', !!bank.get('ieee'), 'ieee');
  check('an unknown style is not found', bank.get('not-a-style') === null);

  // --- reading the citations ---------------------------------------------
  const cites = parseCitations(
    'The work of Gryte et al. (2022) was repeated by Broeren et al. (2008; Lee & Bragg, 1999). ' +
    'The result was reported by (Aerospace Global News, 2026) and by Liu (2021).'
  );
  const gryte = cites.find((c) => c.authors[0] === 'Gryte');
  check('a narrative citation is read', !!gryte && gryte.etal === true && gryte.year === '2022',
    JSON.stringify(gryte && { a: gryte.authors, y: gryte.year, e: gryte.etal }));
  const liu = cites.find((c) => c.authors[0] === 'Liu');
  check('a narrative citation with one name is read', !!liu && liu.year === '2021');
  const news = cites.find((c) => c.authors[0] && c.authors[0].includes('Aerospace'));
  check('an organisation is read as one name', !!news, cites.map((c) => c.authors[0]).join(','));

  const parenthetical = parseCitations('The result (Gryte et al., 2022) holds.');
  const p1 = parenthetical.find((c) => c.form === 'parenthetical');
  check('a parenthetical citation is read', !!p1 && p1.etal === true && p1.year === '2022',
    JSON.stringify(p1 && { a: p1.authors, y: p1.year, e: p1.etal }));

  // --- reading the references --------------------------------------------
  const ref = parseReference(
    'Gryte, K., Kleiven, R., & Johansen, T. A. (2022). Robust and gain-scheduled flight control ' +
    'of fixed-wing UAVs in wind and icing conditions. Journal of Guidance, Control, and Dynamics. ' +
    'https://doi.org/10.2514/1.G007404', 0);
  check('a reference gives its first surname', ref.surname === 'gryte', ref.surname);
  check('a reference gives its year', ref.year === '2022', String(ref.year));
  check('a reference counts its authors', ref.authorCount === 3, String(ref.authorCount));
  check('a reference gives its DOI', ref.doi.length === 1 && ref.doi[0].doi === '10.2514/1.G007404', JSON.stringify(ref.doi));
  check('a reference gives its address', ref.url.length === 1 && ref.url[0].url.startsWith('https://'), JSON.stringify(ref.url));

  const compound = parseReference('Beheshti Rabiei, A., Kim, Y., & Myong, R. S. (2025). A title.', 1);
  check('a compound surname can be called by either part',
    sameName(nameCandidates('Rabiei'), compound.names), JSON.stringify(compound.names));

  // --- the two halves ------------------------------------------------------
  const style = bank.get('harvard');
  const refs = [
    parseReference('Gryte, K., Kleiven, R., & Johansen, T. A. (2022). A title.', 0),
    parseReference('Lee, S., & Bragg, M. B. (1999). Another title.', 1),
  ];
  const body = parseCitations('Gryte et al. (2022) and Lee & Bragg (1999) agree.');
  const clean = crossCheck(body, refs, style);
  check('a citation with an entry is not missing', clean.missing.length === 0,
    JSON.stringify(clean.missing.map((m) => m.reason)));
  check('an entry that is cited is not unused', clean.unused.length === 0,
    JSON.stringify(clean.unused.map((u) => u.raw.slice(0, 30))));

  const orphan = crossCheck(
    parseCitations('Nobody (1999) says so.'),
    refs,
    style
  );
  check('a citation with no entry is reported', orphan.missing.length === 1,
    String(orphan.missing.length));
  const never = crossCheck(
    parseCitations('Gryte et al. (2022) says so.'),
    refs,
    style
  );
  check('an entry that is never cited is reported', never.unused.length === 1,
    String(never.unused.length));

  // --- the links -----------------------------------------------------------
  check('a well-formed DOI passes', validateDoi('10.2514/1.G007404').ok === true);
  check('a DOI with a short registrant code fails', validateDoi('10.12/abc').ok === false);
  check('a string that is not a DOI fails', validateDoi('11.2514/1.G007404').ok === false);
  check('a DOI with no suffix fails', validateDoi('10.2514/').ok === false);
  check('a well-formed address passes', validateUrl('https://example.org/paper').ok === true);
  check('an address with no host fails', validateUrl('https://localhost/x').ok === false);
  check('an address with the wrong scheme fails', validateUrl('ftp://example.org/x').ok === false);

  check('a placeholder reference is found',
    isPlaceholderReference('Karli, G., et al. (2024). [Add full author list, title and DOI for this reference.]'));
  check('a real reference is not a placeholder',
    !isPlaceholderReference('Gryte, K. (2022). A real title.'));

  // --- the command line tools ---------------------------------------------
  const noStyle = run('format-citations.mjs', [join(work, 'format.docx'), '--out', join(work, 'x.docx')]);
  check('format-citations refuses to run without a style', noStyle.code !== 0, String(noStyle.code));
  check('format-citations says that it has no default',
    /no default/i.test(noStyle.stdout + noStyle.stderr), (noStyle.stdout + noStyle.stderr).slice(0, 120));

  const badStyle = run('audit-citations.mjs', [join(work, 'format.docx'), '--style', 'not-a-style']);
  check('audit-citations refuses an unknown style', badStyle.code !== 0, String(badStyle.code));
  check('audit-citations lists the styles it knows',
    /harvard/.test(badStyle.stdout + badStyle.stderr), (badStyle.stdout + badStyle.stderr).slice(0, 120));

  // --- the end to end ------------------------------------------------------
  const citeBody =
    '<w:p><w:r><w:t>The work of Gryte et al. (2022) was repeated by Broeren et al. (2008).</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>References</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Gryte, K., Kleiven, R., &amp; Johansen, T. A. (2022). Robust flight control. ' +
    'Journal of Guidance. https://doi.org/10.2514/1.G007404</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Broeren, A. P., Bragg, M., Addy, H. E., Lee, S., Moens, F., &amp; Guffond, D. (2008). ' +
    'Effect of high-fidelity ice accretion simulations. AIAA Aerospace Sciences Meeting.</w:t></w:r></w:p>';
  const citePath = join(work, 'cite.docx');
  writeFileSync(citePath, buildDocxFromBody(citeBody));

  const audit = run('audit-citations.mjs', [citePath, '--style', 'harvard']);
  check('audit-citations runs on a document', audit.code === 0, (audit.stdout + audit.stderr).slice(-140));
  check('audit-citations finds every citation and every entry',
    /CLEAN - every citation has an entry/.test(audit.stdout), audit.stdout.slice(0, 400));
  check('audit-citations reads the DOI out of the reference',
    /10\.2514\/1\.G007404/.test(audit.stdout), audit.stdout.slice(0, 400));

  const citeOut = join(work, 'cite-roman.docx');
  const applied = run('format-citations.mjs', [citePath, '--out', citeOut, '--style', 'apa7']);
  check('format-citations applies a named style', applied.code === 0, (applied.stdout + applied.stderr).slice(-140));
  if (existsSync(citeOut)) {
    const citeEntries = readZip(readFileSync(citeOut));
    const citeDoc = citeEntries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
    const citeXml = citeDoc.data.toString('utf8');
    const romanEtAl = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>[^<]*et\s+al\.[^<]*<\/w:t>/.test(citeXml);
    check('the abbreviation can be put in roman', romanEtAl);
    const textOf = (xml) => (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '')).join('');
    check('the text of the document is not changed by the style',
      textOf(citeXml) === textOf(citeBody),
      textOf(citeXml).slice(0, 80));
  }

  // --- the live citation check ---------------------------------------------
  const py = (args) => {
    try {
      const out = execFileSync('python', args, { stdio: 'pipe' });
      return { code: 0, stdout: out.toString(), stderr: '' };
    } catch (err) {
      return {
        code: err.status === undefined ? 1 : err.status,
        stdout: err.stdout ? err.stdout.toString() : '',
        stderr: err.stderr ? err.stderr.toString() : '',
      };
    }
  };

  const obu = bank.get('obu-harvard');
  check('the live citation check knows the OBU Harvard style',
    !!obu && obu.etaItalic === true, JSON.stringify(obu));
  check('OBU Harvard asks for an italic abbreviation', obu && obu.etaItalic === true);
  check('OBU Harvard lists every author in the reference list', obu && obu.referenceEtaAfter === 0);

  const scriptsDir = join(here).replace(/\\/g, '/');
  const pyCode = [
    'import sys, json',
    "sys.path.insert(0, '" + scriptsDir + "')",
    'import live_citation_check as m',
    'e = m.parse_entry("Morris, R. and O\'Riordan, S. (2017) \'Prevention of falls in hospital\', '
      + 'Clinical Medicine, 17(4), pp. 360-362.")',
    "print(json.dumps({k: e[k] for k in ('title','year','volume','issue')}))",
  ].join('\n');
  const parsed = py(['-c', pyCode]);
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(parsed.stdout.trim().split('\n').pop());
  } catch (err) {
    parsedJson = null;
  }
  check('the live citation check reads the title past an apostrophe in a surname',
    !!parsedJson && parsedJson.title === 'Prevention of falls in hospital',
    parsed.stdout.slice(-160));
  check('the live citation check reads the year',
    !!parsedJson && parsedJson.year === '2017', JSON.stringify(parsedJson));
  check('the live citation check reads the volume and the issue',
    !!parsedJson && parsedJson.volume === '17' && parsedJson.issue === '4',
    JSON.stringify(parsedJson));

  const badCiteStyle = py([join(here, 'live_citation_check.py'), 'refs.txt', '--style', 'not-a-style']);
  check('the live citation check refuses an unknown style', badCiteStyle.code !== 0,
    String(badCiteStyle.code));
}

console.log('');
console.log('passed: ' + passed + '   failed: ' + failed);

try {
  rmSync(work, { recursive: true, force: true });
} catch (err) {
  console.log('note: could not clean the temp directory: ' + err.message);
}

process.exit(failed === 0 ? 0 : 1);
