// Notes in Samara (N0, 2026-11-25): the store never loses a note. Saved before it answers, kept through a restart and
// a half-written line, never written over when the key will not open it, merged with the other machine without losing
// either side, and the companion's notes brought in whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Keeper } from '../src/sealedfile.ts';
import { NotesStore, COMPACT_EVERY, TRASH_DAYS, TOMBSTONE_DAYS, VERSION_GAP_MS, Hlc, findCompanionNotes } from '../src/notestore.ts';
import { tidyNote, toMarkdown, titleFrom, cleanHtml, type Note } from '../src/notes.ts';

const keeperWith = (key: Buffer): Keeper => ({
  available: () => true,
  seal: (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); },
  open: (b) => { const x = Buffer.from(b, 'base64'); const d = createDecipheriv('aes-256-gcm', key, x.subarray(0, 12)); d.setAuthTag(x.subarray(12, 28)); return Buffer.concat([d.update(x.subarray(28)), d.final()]).toString('utf8'); },
});
const K = keeperWith(randomBytes(32));
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'notes-'));
const DAY = 86_400_000;
function clock(start = Date.UTC(2026, 10, 25, 12)) { let t = start; const f = () => t; f.add = (ms: number) => { t += ms; }; return f; }
const quiet = () => {};
const store = (dir: string, o: Partial<ConstructorParameters<typeof NotesStore>[0]> = {}) => new NotesStore({ dir, dev: 'pc', keeper: K, log: quiet, ...o });

test('a save is on the disk, sealed, before it returns, and comes back after a restart', () => {
  const dir = tmp();
  const s = store(dir);
  const n = s.save({ title: 'Groceries', html: '<div>oat milk</div>' })!;
  assert.ok(n.stamp && n.id);
  const raw = readFileSync(path.join(dir, 'journal.log'), 'utf8');
  assert.doesNotMatch(raw, /Groceries|oat milk/, 'sealed');
  const again = store(dir);
  assert.equal(again.get(n.id)?.title, 'Groceries');
  assert.equal(again.get(n.id)?.html, '<div>oat milk</div>');
});

test('no cap: 500 notes, all kept, through compaction', () => {
  const dir = tmp();
  const s = store(dir);
  for (let i = 0; i < 500; i++) s.save({ title: `Note ${i}`, html: `<div>${i}</div>`, id: `nt${i}` });
  assert.ok(COMPACT_EVERY < 500);
  assert.ok(existsSync(path.join(dir, 'snapshot.json')));
  assert.equal(store(dir).list().length, 500);
});

test('a half line from a power cut loses only that line', () => {
  const dir = tmp();
  const s = store(dir);
  s.save({ id: 'na', title: 'One' }); s.save({ id: 'nb', title: 'Two' });
  appendFileSync(path.join(dir, 'journal.log'), '{"sealed":1,"data":"AAAA');
  const again = store(dir);
  assert.deepEqual(again.list().map((n) => n.title).sort(), ['One', 'Two']);
  again.save({ id: 'nc', title: 'Three' });
  assert.equal(store(dir).list().length, 3, 'a line after the half line still reads');
});

test('locked: a key that will not open the snapshot never writes over it, and new notes are still kept', () => {
  const dir = tmp();
  const s = store(dir);
  s.save({ id: 'na', title: 'Kept' }); s.compact();
  const before = readFileSync(path.join(dir, 'snapshot.json'), 'utf8');
  const other = store(dir, { keeper: keeperWith(randomBytes(32)) });
  assert.equal(other.locked, true);
  other.save({ id: 'nb', title: 'New' });
  other.compact(); other.flush(); other.gc(); assert.equal(other.backup(true), false);
  assert.equal(readFileSync(path.join(dir, 'snapshot.json'), 'utf8'), before, 'untouched');
  assert.equal(store(dir).get('na')?.title, 'Kept');
});

test('a page cannot change where a note came from; Samara can', () => {
  const s = store(tmp());
  const n = s.save({ title: 'x', src: { url: 'https://a.example/p', title: 'A' } })!;
  assert.equal(n.src?.url, 'https://a.example/p');
  s.save({ id: n.id, src: { url: 'https://evil.example/', title: 'E' }, html: '<div>y</div>' });
  assert.equal(s.get(n.id)?.src?.url, 'https://a.example/p');
  s.save({ id: n.id, src: { url: 'https://b.example/', title: 'B' } }, { trusted: true });
  assert.equal(s.get(n.id)?.src?.url, 'https://b.example/');
});

test('the same save twice makes no new stamp', () => {
  const s = store(tmp());
  const a = s.save({ id: 'na', title: 'T', html: '<div>x</div>' })!;
  const b = s.save({ id: 'na', title: 'T', html: '<div>x</div>' })!;
  assert.equal(a.stamp, b.stamp);
});

test('Trash: delete, restore; words gone after 30 days, the mark after 120', () => {
  const now = clock();
  const dir = tmp();
  const s = store(dir, { now });
  s.save({ id: 'na', title: 'Bye', html: '<div>words</div>' });
  assert.equal(s.remove('na'), true);
  assert.equal(s.list().length, 0);
  assert.equal(s.trash()[0]?.id, 'na');
  s.restore('na');
  assert.equal(s.get('na')?.html, '<div>words</div>');
  s.remove('na');
  now.add((TRASH_DAYS + 1) * DAY); s.gc();
  assert.equal(s.trash().length, 0);
  assert.ok(s.has('na'), 'the mark stays, so the other machine hears of it');
  now.add(TOMBSTONE_DAYS * DAY); s.gc();
  assert.equal(s.has('na'), false);
  assert.equal(store(dir, { now }).has('na'), false);
});

test('versions: one per sitting, restore brings an old one back', () => {
  const now = clock();
  const s = store(tmp(), { now });
  s.save({ id: 'na', title: 'T', html: '<div>v1</div>' });
  now.add(1000); s.save({ id: 'na', html: '<div>v2</div>' });
  now.add(1000); s.save({ id: 'na', html: '<div>v3</div>' });
  assert.equal(s.history('na').length, 1, 'same sitting: one version');
  now.add(VERSION_GAP_MS + 1); s.save({ id: 'na', html: '<div>v4</div>' });
  const h = s.history('na');
  assert.equal(h.length, 2);
  assert.equal(h[0]!.html, '<div>v3</div>');
  s.restoreVersion('na', h[1]!.stamp);
  assert.equal(s.get('na')?.html, '<div>v1</div>');
});

test('drafts: kept sealed, listed after a restart, dropped when kept', () => {
  const dir = tmp();
  const s = store(dir);
  assert.equal(s.draft({ id: 'nq1', title: '', html: '<div>half a thought</div>' }), true);
  assert.doesNotMatch(readFileSync(path.join(dir, 'drafts', 'nq1.json'), 'utf8'), /half a thought/);
  const again = store(dir);
  assert.equal(again.drafts()[0]?.html, '<div>half a thought</div>');
  again.dropDraft('nq1');
  assert.equal(again.drafts().length, 0);
  again.draft({ id: 'nq2', html: '' });
  assert.equal(again.drafts().length, 0, 'an empty draft is not kept');
});

test('the clock never goes backwards and moves past the other machine', () => {
  const h = new Hlc('pc');
  const a = h.next(1000), b = h.next(1000), c = h.next(900);
  assert.ok(a < b && b < c);
  h.see(Hlc.fmt(5000, 3, 'mac'));
  assert.ok(h.next(1000) > Hlc.fmt(5000, 3, 'mac'));
});

// ------------------------------------------------------------------ two machines

function pair() {
  const now = clock();
  const pc = store(tmp(), { now, dev: 'pc' });
  const mac = store(tmp(), { now, dev: 'mac' });
  const send = (from: NotesStore, to: NotesStore) => to.take(from.forSync(), from.cats().own);
  return { now, pc, mac, send };
}

test('sync: a new note and an edit on top travel; old news is ignored', () => {
  const { now, pc, mac, send } = pair();
  pc.save({ id: 'na', title: 'Plan', html: '<div>a</div>' });
  assert.equal(send(pc, mac), 1);
  now.add(1000); mac.save({ id: 'na', html: '<div>a b</div>' });
  assert.equal(send(mac, pc), 1);
  assert.equal(pc.get('na')?.html, '<div>a b</div>');
  assert.equal(send(pc, mac), 0, 'nothing new');
  assert.equal(pc.list().length, 1);
});

test('sync: edits made apart keep both: the newer wins, the other is a copy, made once on both machines', () => {
  const { now, pc, mac, send } = pair();
  pc.save({ id: 'na', title: 'Plan', html: '<div>base</div>' });
  send(pc, mac);
  now.add(1000); pc.save({ id: 'na', html: '<div>pc words</div>' });
  now.add(1000); mac.save({ id: 'na', html: '<div>mac words</div>' });
  send(pc, mac); send(mac, pc); send(pc, mac); send(mac, pc);
  for (const s of [pc, mac]) {
    const all = s.list();
    assert.equal(all.length, 2, 'the note and one copy');
    assert.equal(s.get('na')?.html, '<div>mac words</div>', 'the newer wins');
    const copy = all.find((n) => n.conflictOf === 'na')!;
    assert.equal(copy.html, '<div>pc words</div>');
    assert.match(copy.title, /PC copy/);
  }
  assert.deepEqual(pc.list().map((n) => n.id).sort(), mac.list().map((n) => n.id).sort());
});

test('sync: a delete and an edit made apart: the edit wins', () => {
  const { now, pc, mac, send } = pair();
  pc.save({ id: 'na', title: 'Keep me', html: '<div>x</div>' });
  send(pc, mac);
  now.add(1000); mac.save({ id: 'na', html: '<div>x y</div>' });
  now.add(1000); pc.remove('na');
  send(pc, mac); send(mac, pc);
  assert.equal(pc.get('na')?.html, '<div>x y</div>');
  assert.equal(mac.get('na')?.html, '<div>x y</div>');
});

test('sync: a delete on top travels; where a note sits never does', () => {
  const { now, pc, mac, send } = pair();
  pc.save({ id: 'na', title: 'T', out: { x: 10, y: 20, w: 300, h: 300 } });
  send(pc, mac);
  assert.equal(mac.get('na')?.out, undefined);
  now.add(1000); pc.remove('na');
  send(pc, mac);
  assert.equal(mac.get('na'), null);
  assert.equal(mac.trash()[0]?.id, 'na', 'in the Trash there too');
});

test('sync: categories of his own travel', () => {
  const { pc, mac, send } = pair();
  pc.addCat('Garden');
  send(pc, mac);
  assert.deepEqual(mac.cats().own, ['Garden']);
});

test('onLocal hears changes made here, never ones from the other machine', () => {
  const heard: string[] = [];
  const now = clock();
  const pc = store(tmp(), { now, onLocal: (ns) => heard.push(...ns.map((n) => n.id)) });
  const mac = store(tmp(), { now, dev: 'mac' });
  pc.save({ id: 'na', title: 'a' });
  mac.save({ id: 'nb', title: 'b' });
  pc.take(mac.forSync());
  assert.deepEqual(heard, ['na']);
});

// ------------------------------------------------------------------ the companion's notes

function companion(notes: unknown[], cats?: string[]) {
  const d = tmp();
  writeFileSync(path.join(d, 'notes.json'), JSON.stringify(notes));
  if (cats) writeFileSync(path.join(d, 'note-cats.json'), JSON.stringify(cats));
  return path.join(d, 'notes.json');
}

test('import: every companion note comes across with every field, its times and its place on screen; the file is never changed', () => {
  const old = Date.UTC(2025, 0, 2);
  const notes = Array.from({ length: 75 }, (_, i) => ({ id: `nold${i}`, title: `Old ${i}`, html: `<div>w${i}</div>`, font: 'caveat', size: '18', cat: i % 2 ? 'Work' : 'Garden', created: old, updated: old + i, out: i === 0 ? { x: 5, y: 6, w: 280, h: 300 } : undefined, src: i === 1 ? { url: 'https://a.example/', title: 'A' } : undefined }));
  const file = companion(notes, ['Garden']);
  const before = readFileSync(file, 'utf8');
  const dir = tmp();
  const s = store(dir);
  const r = s.importCompanion(file, 'pc');
  assert.equal(r.found, 75); assert.equal(r.added, 75); assert.equal(r.skipped.length, 0);
  assert.equal(readFileSync(file, 'utf8'), before);
  const n0 = s.get('nold0')!;
  assert.equal(n0.font, 'caveat'); assert.equal(n0.size, '18'); assert.equal(n0.created, old); assert.equal(n0.updated, old);
  assert.deepEqual({ ...n0.out, opacity: undefined, pinned: undefined }, { x: 5, y: 6, w: 280, h: 300, opacity: undefined, pinned: undefined });
  assert.equal(s.get('nold1')?.src?.url, 'https://a.example/');
  assert.equal(s.cats().own[0], 'Garden', 'his order kept');
  assert.equal(readdirSync(path.join(dir, 'imports')).length, 1, 'a sealed copy of the file');
  const again = s.importCompanion(file, 'pc');
  assert.equal(again.same, 75); assert.equal(again.added, 0);
  assert.equal(store(dir).list().length, 75);
});

test('import again: a note changed in the companion since comes across; one changed in both is kept beside it', () => {
  const file = companion([{ id: 'na', title: 'A', html: '<div>1</div>' }, { id: 'nb', title: 'B', html: '<div>1</div>' }]);
  const s = store(tmp());
  s.importCompanion(file, 'pc');
  s.save({ id: 'nb', html: '<div>changed in Samara</div>' });
  writeFileSync(file, JSON.stringify([{ id: 'na', title: 'A', html: '<div>2</div>' }, { id: 'nb', title: 'B', html: '<div>2</div>' }]));
  const r = s.importCompanion(file, 'pc');
  assert.equal(r.updated, 1); assert.equal(r.kept, 1);
  assert.equal(s.get('na')?.html, '<div>2</div>');
  assert.equal(s.get('nb')?.html, '<div>changed in Samara</div>');
  assert.ok(s.list().some((n) => n.html === '<div>2</div>' && /from the companion/.test(n.title)));
});

test('import: a broken file is reported, nothing is lost', () => {
  const d = tmp(); const f = path.join(d, 'notes.json'); writeFileSync(f, '{oops');
  const s = store(tmp());
  const r = s.importCompanion(f, 'pc');
  assert.equal(r.added, 0); assert.match(r.skipped[0]!.why, /could not read/);
  assert.equal(s.importCompanion(path.join(d, 'missing.json'), 'pc').found, 0);
});

test('backup: one a day, sealed, the last 14 kept', () => {
  const now = clock();
  const dir = tmp();
  const s = store(dir, { now });
  s.save({ id: 'na', title: 'Backed up' });
  for (let i = 0; i < 20; i++) { assert.equal(s.backup(), true); now.add(DAY); }
  assert.equal(s.backup(), true); assert.equal(s.backup(), false, 'not twice a day');
  const files = readdirSync(path.join(dir, 'backups'));
  assert.equal(files.length, 14);
  assert.doesNotMatch(readFileSync(path.join(dir, 'backups', files[0]!), 'utf8'), /Backed up/);
});

test('model: tidyNote, titleFrom, Markdown', () => {
  assert.equal(tidyNote({ id: 'bad id' }, { dev: 'pc', now: 1 }), null);
  const n = tidyNote({ id: 'na', title: '<b>x</b>', html: '<script>x</script><div class="cl done">milk</div><div>hi</div>', size: 'XL', color: 'red' }, { dev: 'mac', now: 5 }) as Note;
  assert.equal(n.title, 'bx/b'); assert.equal(n.size, 'm'); assert.equal(n.dev, 'mac');
  assert.doesNotMatch(n.html, /script/);
  assert.equal(titleFrom('<div>buy oat milk and bread today</div>'), 'buy oat milk and');
  assert.match(toMarkdown({ ...n, title: 'T' }), /- \[x\] milk[\s\S]*hi/);
  assert.equal(cleanHtml('<img src=x onerror=alert(1)>'), '');
});

test('the companion\'s notes file is found by its shape, never by a name; Samara\'s own folder and other apps\' notes are not it', () => {
  const appData = tmp();
  const put = (dir: string, j: unknown) => { const d = path.join(appData, dir); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, 'notes.json'), JSON.stringify(j)); };
  put('SomeEditor', [{ text: 'not ours' }]);
  put('Samara', [{ id: 'na', html: '', font: 'figtree', size: 'm' }]);
  assert.equal(findCompanionNotes(appData, {}), null);
  put('Companion', [{ id: 'nabc', title: 'T', html: '<div>x</div>', font: 'figtree', size: 'm', updated: 1 }]);
  assert.equal(findCompanionNotes(appData, {}), path.join(appData, 'Companion', 'notes.json'));
  assert.equal(findCompanionNotes(appData, { SAMARA_COMPANION_NOTES: '/x/notes.json' }), '/x/notes.json');
  assert.equal(findCompanionNotes(path.join(appData, 'missing'), {}), null);
});

test('review: a change to the title style alone in the companion still comes across on the next import', () => {
  const file = companion([{ id: 'na', title: 'A', html: '<div>1</div>', font: 'figtree', size: 'm' }]);
  const s = store(tmp());
  s.importCompanion(file, 'pc');
  writeFileSync(file, JSON.stringify([{ id: 'na', title: 'A', html: '<div>1</div>', font: 'figtree', size: 'm', tfont: 'caveat', tsize: 26 }]));
  const r = s.importCompanion(file, 'pc');
  assert.equal(r.updated, 1);
  assert.equal(s.get('na')?.tfont, 'caveat');
});

test('review: a font changed on one machine and a size on the other, apart: neither change is lost', () => {
  const { now, pc, mac, send } = pair();
  pc.save({ id: 'na', title: 'T', html: '<div>x</div>' });
  send(pc, mac);
  now.add(1000); pc.save({ id: 'na', font: 'caveat' });
  now.add(1000); mac.save({ id: 'na', size: 'l' });
  send(pc, mac); send(mac, pc);
  for (const s of [pc, mac]) {
    const all = s.list();
    assert.ok(all.some((n) => n.font === 'caveat') && all.some((n) => n.size === 'l'), JSON.stringify(all.map((n) => [n.font, n.size])));
    assert.equal(all.length, 2);
  }
});
