import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessName, guessPatronymic, russianPatronymic, suggestName } from '../site/assets/js/lib/transliterate.js';

const all = (r) => [r.auto, ...r.options].filter(Boolean);

test('common first names are filled in for sure', () => {
  assert.equal(guessName('Hovhannes', 'armenian').auto, 'Հովհաննես');
  assert.equal(guessName('Hovhannes', 'cyrillic').auto, 'Ованес');
  assert.ok(guessName('Hovhannes', 'cyrillic').options.includes('Оганес'));
  assert.equal(guessName('hakob', 'cyrillic').auto, 'Акоп');
  assert.equal(guessName('Gevorg', 'armenian').auto, 'Գևորգ');
  assert.equal(guessName('Astghik', 'cyrillic').auto, 'Астхик');
  assert.equal(guessName('Elena', 'cyrillic').auto, 'Елена');
  assert.equal(guessName('Olga', 'cyrillic').auto, 'Ольга');
  assert.equal(guessName('Anna Maria', 'armenian').auto, 'Աննա Մարիա');
});

test('surnames follow spelling rules', () => {
  assert.equal(guessName('Petrosyan', 'armenian').auto, 'Պետրոսյան');
  assert.equal(guessName('Petrosyan', 'cyrillic').auto, 'Петросян');
  assert.equal(guessName('Martirosyan', 'armenian').auto, 'Մարտիրոսյան');
  assert.equal(guessName('Ghazaryan', 'armenian').auto, 'Ղազարյան');
  assert.equal(guessName('Ter-Petrosyan', 'cyrillic').auto, 'Тер-Петросян');
  assert.equal(guessName('Shushanik', 'armenian').auto, 'Շուշանիկ');
});

test('when not sure: no automatic fill, but the right answer is among the guesses', () => {
  const m = guessName('Mkrtchyan', 'armenian');
  assert.equal(m.auto, null);
  assert.equal(m.options[0], 'Մկրտչյան');
  const h = guessName('Hermine', 'cyrillic');
  assert.equal(h.auto, null);
  assert.ok(h.options.includes('Гермине'));
  assert.ok(all(guessName('Tchakhmakhchyan', 'armenian')).includes('Չախմախչյան'));
  assert.ok(guessName('Petrosyan', 'armenian').options.length >= 2, 'alternatives offered');
});

test('nothing to guess for empty or non-English text', () => {
  assert.deepEqual(guessName('', 'armenian'), { auto: null, options: [] });
  assert.deepEqual(guessName('Հովհաննես', 'cyrillic'), { auto: null, options: [] });
});

test('patronymics: Armenian style and Russian style by sex', () => {
  assert.equal(guessPatronymic('Grigori', 'armenian').auto, 'Գրիգորի');
  assert.equal(guessPatronymic('Grigori', 'cyrillic', 'male').auto, 'Григорьевич');
  assert.equal(guessPatronymic('Grigori', 'cyrillic', 'female').auto, 'Григорьевна');
  const unknownSex = guessPatronymic('Hovhannesi', 'cyrillic', 'unknown');
  assert.equal(unknownSex.auto, null);
  assert.ok(unknownSex.options.includes('Ованесович') && unknownSex.options.includes('Ованесовна'));
  assert.equal(guessPatronymic('Grigoryevich', 'cyrillic', 'male').auto, 'Григорьевич');
  assert.equal(suggestName('Petrosi', 'cyrillic', 'patronymic', { sex: 'female' }).auto, 'Петросовна');
  assert.equal(russianPatronymic('Андрей', 'male'), 'Андреевич');
  assert.equal(russianPatronymic('Пётр', 'female'), 'Петровна');
  assert.equal(russianPatronymic('Игорь', 'male'), 'Игоревич');
});
