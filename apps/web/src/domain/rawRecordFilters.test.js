import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayOf, facetsOf, filterTags, kindOf, matchesFilters } from './rawRecordFilters.js';

const entry = (category, type, created) => ({
  position: 0,
  original: { 'Categoria Profissional': category, 'Tipo do registro': type, criacao_registro: created },
});

const ENTRIES = [
  entry('MEDICINA', 'Anamnese', '3/12/2023, 10:53'),
  entry('ENFERMAGEM', 'Anamnese', '3/12/2023, 11:20'),
  entry('MEDICINA', 'Evolução', '5/12/2023, 09:16'),
  entry('MEDICINA', 'Evolução', '4/12/2023, 07:53'),
];

test('dayOf reads dates with and without a leading zero and sorts by date', () => {
  assert.deepEqual(dayOf('3/12/2023, 10:53'), { key: '2023-12-03', label: '03/12' });
  assert.deepEqual(dayOf('03/12/2023'), { key: '2023-12-03', label: '03/12' });
  assert.equal(dayOf(''), null);
  assert.equal(dayOf('sem data'), null);
});

test('kindOf recognizes anamnese and evolução, with or without accents', () => {
  assert.equal(kindOf('Anamnese'), 'anamnese');
  assert.equal(kindOf('Evolução'), 'evolucao');
  assert.equal(kindOf('EVOLUCAO'), 'evolucao');
  assert.equal(kindOf('Cirúrgico'), null);
});

test('only medicine and nursing: two category tags, days in order and both types', () => {
  const tags = filterTags(ENTRIES);
  assert.deepEqual(tags.days.map((d) => d.label), ['03/12', '04/12', '05/12']);
  assert.deepEqual(tags.kinds.map((k) => k.label), ['Anamnese', 'Evolução']);
  assert.deepEqual(tags.categories.map((c) => c.label), ['Medicina', 'Enfermagem']);
});

test('an extra category gets its own tag, after medicine and nursing', () => {
  const tags = filterTags([entry('SERVIÇO SOCIAL', 'Evolução', '4/12/2023, 15:00'), ...ENTRIES]);
  assert.deepEqual(tags.categories.map((c) => c.label), ['Medicina', 'Enfermagem', 'Serviço Social']);
});

test('with no entry of a type, its tag does not appear', () => {
  const tags = filterTags([entry('MEDICINA', 'Evolução', '4/12/2023, 07:53')]);
  assert.deepEqual(tags.kinds.map((k) => k.label), ['Evolução']);
  assert.deepEqual(tags.categories.map((c) => c.label), ['Medicina']);
});

test('filters combine: day, type and category', () => {
  const day3 = ENTRIES.filter((e) => matchesFilters(e, { day: '2023-12-03' }));
  assert.equal(day3.length, 2);

  const evolutions = ENTRIES.filter((e) => matchesFilters(e, { kind: 'evolucao' }));
  assert.equal(evolutions.length, 2);

  const nursingDay3 = ENTRIES.filter((e) => matchesFilters(e, { day: '2023-12-03', category: 'enfermagem' }));
  assert.equal(nursingDay3.length, 1);
  assert.equal(facetsOf(nursingDay3[0]).categoryLabel, 'Enfermagem');

  assert.equal(ENTRIES.filter((e) => matchesFilters(e)).length, 4);
});

test('an entry without a date has no day tag and disappears when a day is chosen', () => {
  const noDate = entry('MEDICINA', 'Anamnese', '');
  assert.deepEqual(filterTags([noDate]).days, []);
  assert.equal(matchesFilters(noDate, { day: '2023-12-03' }), false);
  assert.equal(matchesFilters(noDate, {}), true);
});
