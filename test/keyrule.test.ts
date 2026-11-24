// Space and Enter judged by what they would do (2026-10-31): moving and picking never ask; sending always does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyWeigh, type KeyTarget } from '../src/driverrules.ts';

const el = (o: Partial<KeyTarget>): KeyTarget => ({ tag: 'input', type: '', role: '', kind: 'text', label: '', formSearch: false, inForm: true, editable: false, ...o });
const radio = el({ type: 'radio', kind: 'button', label: 'Canada' });

test('moving and picking are free', () => {
  assert.equal(keyWeigh('space', null), 'free');
  assert.equal(keyWeigh('enter', null), 'free');
  assert.equal(keyWeigh('space', radio), 'free');
  assert.equal(keyWeigh('space', el({ type: 'checkbox', kind: 'button', label: 'HubSpot' })), 'free');
  assert.equal(keyWeigh('space', el({ kind: 'text', label: 'Full name' })), 'free');
  assert.equal(keyWeigh('enter', el({ tag: 'select', kind: 'select' })), 'free');
  assert.equal(keyWeigh('enter', el({ tag: 'button', role: 'combobox', kind: 'select', label: 'Pick a team' })), 'free');
  assert.equal(keyWeigh('enter', el({ tag: 'a', kind: 'link', label: 'Back to top', inForm: false })), 'free');
  assert.equal(keyWeigh('enter', el({ tag: 'div', role: 'option', kind: 'button', label: 'Toronto' })), 'free');
  assert.equal(keyWeigh('enter', el({ kind: 'search', label: 'Search jobs' })), 'free');
});

test('Enter on a radio or tick box in a form is pressed as Space, so it never sends', () => {
  assert.equal(keyWeigh('enter', radio), 'pick');
  assert.equal(keyWeigh('enter', { ...radio, inForm: false }), 'free');
});

test('anything that would send asks', () => {
  assert.equal(keyWeigh('enter', el({ kind: 'text', label: 'Have you worked with lenders?' })), 'lever');
  assert.equal(keyWeigh('enter', el({ tag: 'textarea', kind: 'text', label: 'Essay' })), 'lever');
  assert.equal(keyWeigh('enter', el({ tag: 'div', kind: 'button', editable: true, label: 'Message' })), 'lever');
  assert.equal(keyWeigh('enter', el({ tag: 'button', kind: 'submit', label: 'Submit Application' })), 'lever');
  assert.equal(keyWeigh('space', el({ tag: 'button', kind: 'submit', label: 'Submit Application' })), 'lever');
  assert.equal(keyWeigh('space', el({ tag: 'button', kind: 'button', label: 'Send' })), 'lever');
});

test('buying and passwords never', () => {
  assert.equal(keyWeigh('enter', el({ kind: 'password' })), 'never');
  assert.equal(keyWeigh('space', el({ tag: 'button', kind: 'button', label: 'Buy now' })), 'never');
});

// Phase 1 (2026-11-24): Enter on a spot that is not a real control (a plain box the page made focusable) asks him.
test('Enter on a plain focusable box asks; real buttons and links are judged as a click', () => {
  const box: KeyTarget = { tag: 'div', type: '', role: '', kind: 'button', label: 'plain', formSearch: false, inForm: false, editable: false };
  assert.equal(keyWeigh('enter', box), 'lever');
  assert.equal(keyWeigh('enter', { ...box, role: 'button' }), 'free');
  assert.equal(keyWeigh('enter', { ...box, tag: 'button' }), 'free');
  assert.equal(keyWeigh('enter', { ...box, tag: 'button', label: 'Send' }), 'lever');
  assert.equal(keyWeigh('space', box), 'free', 'Space on it is judged as a click of a harmless button');
});
