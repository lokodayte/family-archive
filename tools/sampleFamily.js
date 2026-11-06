// A completely made-up family used for the demo site and the automated tests.
// The surname "Sampleyan" (Սամփլյան / Сэмплян) is invented on purpose.
import { parseDate } from '../site/assets/js/lib/dates.js';

const d = (text) => {
  const r = parseDate(text);
  if (!r.ok) throw new Error(`Bad sample date: ${text}`);
  return r.value;
};
const names = (latin, armenian, cyrillic) => ({ latin, armenian, cyrillic });

export function samplePeople() {
  return [
    {
      id: 'psample0001', privacy: 'public', living: false, sex: 'male',
      names: names(
        { first: 'Hovhannes', last: 'Sampleyan', patronymic: 'Grigori' },
        { first: 'Հովհաննես', last: 'Սամփլյան' },
        { first: 'Ованес', last: 'Сэмплян', patronymic: 'Григорьевич' },
      ),
      nicknames: ['Vano'],
      birth: { date: d('about 1880'), place: 'Kars' },
      death: { date: d('12 March 1951'), place: 'Yerevan' },
      occupation: 'Blacksmith',
      languages: ['Armenian', 'Russian', 'Turkish'],
      bio: 'SAMPLE PERSON — not a real ancestor.\n\nHovhannes kept a forge near the market. Family stories say he could mend anything made of iron.',
      stories: [{ title: 'The iron gate', text: 'A made-up story: he once forged a gate that is said to still stand.' }],
      events: [
        { id: 'e1', type: 'move', date: d('between 1917 and 1919'), place: 'Yerevan', description: 'Left Kars with the family (sample event).' },
      ],
      sources: [{ id: 's1', fact: 'Birth year', citation: 'Memory of a granddaughter (sample)', type: 'memory', confidence: 'medium' }],
    },
    {
      id: 'psample0002', privacy: 'public', living: false, sex: 'female',
      names: names({ first: 'Mariam', last: 'Sampleyan', maiden: 'Exampleyan' }, { first: 'Մարիամ' }, {}),
      birth: { date: d('about 1885') },
      death: { date: d('1915') },
      bio: 'SAMPLE PERSON — first wife of Hovhannes.',
    },
    {
      id: 'psample0003', privacy: 'public', living: false, sex: 'female',
      names: names({ first: 'Anahit', last: 'Sampleyan' }, { first: 'Անահիտ', last: 'Սամփլյան' }, { first: 'Анаит' }),
      birth: { date: d('between 1890 and 1893') },
      death: { date: d('after 1970') },
      bio: 'SAMPLE PERSON — second wife of Hovhannes.',
    },
    {
      id: 'psample0004', privacy: 'public', living: false, sex: 'male',
      names: names({ first: 'Grigor', last: 'Sampleyan', patronymic: 'Hovhannesi' }, { first: 'Գրիգոր', last: 'Սամփլյան' }, { first: 'Григорий', last: 'Сэмплян', patronymic: 'Ованесович' }),
      birth: { date: d('5 June 1910'), place: 'Kars' },
      death: { date: d('1988'), place: 'Yerevan' },
      occupation: 'Teacher',
      education: 'Teachers’ college (sample)',
      events: [{ id: 'e2', type: 'military', date: d('between 1941 and 1945'), description: 'Served in the war (sample event).' }],
      bio: 'SAMPLE PERSON.',
    },
    {
      id: 'psample0005', privacy: 'public', living: false, sex: 'female',
      names: names({ first: 'Lusine', last: 'Sampleyan' }, { first: 'Լուսինե' }, {}),
      birth: { date: d('1919') },
      death: { date: d('2001') },
      bio: 'SAMPLE PERSON — half-sister of Grigor.',
    },
    {
      id: 'psample0006', privacy: 'family', living: false, sex: 'female',
      names: names({ first: 'Elena', last: 'Sampleyan', maiden: 'Demova', patronymic: 'Petrovna' }, {}, { first: 'Елена', last: 'Сэмплян', maiden: 'Демова', patronymic: 'Петровна' }),
      birth: { date: d('1915'), place: 'Tbilisi' },
      death: { date: d('1999') },
      bio: 'SAMPLE FAMILY-ONLY PERSON. Visitors without the family password must never see this name.',
    },
    {
      id: 'psample0007', privacy: 'family', living: false, sex: 'male',
      names: names({ first: 'Armen', last: 'Sampleyan' }, { first: 'Արմեն' }, {}),
      birth: { date: d('1940') },
      death: { date: d('2015') },
      bio: 'SAMPLE FAMILY-ONLY PERSON.',
    },
    {
      id: 'psample0008', privacy: 'family', living: true, sex: 'female',
      names: names({ first: 'Karine', last: 'Sampleyan' }, { first: 'Կարինե' }, {}),
      birth: { date: d('1945') },
      bio: 'SAMPLE LIVING PERSON (always family-only).',
    },
    {
      id: 'psample0009', privacy: 'family', living: true, sex: 'male',
      names: names({ first: 'Davit', last: 'Sampleyan' }, {}, {}),
      birth: { date: d('1972') },
      bio: 'SAMPLE LIVING PERSON.',
    },
    {
      id: 'psample0010', privacy: 'family', living: false, placeholder: true, sex: 'female',
      names: {},
      bio: 'Placeholder: Davit’s mother is not yet known (sample).',
    },
  ];
}

export function sampleRels() {
  const parent = (id, p, c, kind = 'birth') => ({ id, type: 'parent', parent: p, child: c, kind });
  return [
    { id: 'rsample01', type: 'spouse', a: 'psample0001', b: 'psample0002', start: d('about 1907'), end: d('1915'), endReason: 'death' },
    { id: 'rsample02', type: 'spouse', a: 'psample0001', b: 'psample0003', start: d('1917') },
    parent('rsample03', 'psample0001', 'psample0004'),
    parent('rsample04', 'psample0002', 'psample0004'),
    parent('rsample05', 'psample0001', 'psample0005'),
    parent('rsample06', 'psample0003', 'psample0005'),
    { id: 'rsample07', type: 'spouse', a: 'psample0004', b: 'psample0006', start: d('1938'), place: 'Yerevan' },
    parent('rsample08', 'psample0004', 'psample0007'),
    parent('rsample09', 'psample0006', 'psample0007'),
    parent('rsample10', 'psample0004', 'psample0008'),
    parent('rsample11', 'psample0006', 'psample0008'),
    parent('rsample12', 'psample0007', 'psample0009'),
    parent('rsample13', 'psample0010', 'psample0009'),
  ];
}

// Names that must never appear in public files.
export const FAMILY_ONLY_WORDS = ['Elena', 'Demova', 'Елена', 'Արմեն', 'Karine', 'Davit', 'SAMPLE FAMILY-ONLY'];
