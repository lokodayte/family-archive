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
      birth: { date: d('about 1880'), place: 'Kars', placeId: 'lsamplekars' },
      death: { date: d('12 March 1951'), place: 'Yerevan', placeId: 'lsampleyerevan' },
      occupation: 'Blacksmith',
      languages: ['Armenian', 'Russian', 'Turkish'],
      bio: 'SAMPLE PERSON — not a real ancestor.\n\nHovhannes kept a forge near the market. Family stories say he could mend anything made of iron.',
      stories: [{ title: 'The iron gate', text: 'A made-up story: he once forged a gate that is said to still stand.' }],
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
      birth: { date: d('5 June 1910'), place: 'Kars', placeId: 'lsamplekars' },
      death: { date: d('1988'), place: 'Yerevan', placeId: 'lsampleyerevan' },
      occupation: 'Teacher',
      education: 'Teachers’ college (sample)',
      events: [{ id: 'e2', type: 'military', date: d('between 1941 and 1945'), description: 'Served in the war (sample event).' }],
      bio: 'SAMPLE PERSON.',
    },
    {
      id: 'psample0005', privacy: 'public', living: false, sex: 'female',
      names: names({ first: 'Lusine', last: 'Sampleyan' }, { first: 'Լուսինե' }, {}),
      birth: { date: d('1919'), place: 'Yerevan', placeId: 'lsampleyerevan' },
      death: { date: d('2001') },
      bio: 'SAMPLE PERSON — half-sister of Grigor.',
    },
    {
      id: 'psample0006', privacy: 'family', living: false, sex: 'female',
      names: names({ first: 'Elena', last: 'Sampleyan', maiden: 'Demova', patronymic: 'Petrovna' }, {}, { first: 'Елена', last: 'Сэмплян', maiden: 'Демова', patronymic: 'Петровна' }),
      birth: { date: d('1915'), place: 'Tbilisi', placeId: 'lsampletbilisi' },
      death: { date: d('1999') },
      bio: 'SAMPLE FAMILY-ONLY PERSON. Visitors without the family password must never see this name.',
    },
    {
      id: 'psample0007', privacy: 'family', living: false, sex: 'male',
      names: names({ first: 'Armen', last: 'Sampleyan' }, { first: 'Արմեն' }, {}),
      birth: { date: d('1940'), place: 'Yerevan', placeId: 'lsampleyerevan' },
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
      birth: { date: d('1972'), place: 'Yerevan', placeId: 'lsampleyerevan' },
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
    { id: 'rsample07', type: 'spouse', a: 'psample0004', b: 'psample0006', start: d('1938'), place: 'Yerevan', placeId: 'lsampleyerevan' },
    parent('rsample08', 'psample0004', 'psample0007'),
    parent('rsample09', 'psample0006', 'psample0007'),
    parent('rsample10', 'psample0004', 'psample0008'),
    parent('rsample11', 'psample0006', 'psample0008'),
    parent('rsample12', 'psample0007', 'psample0009'),
    parent('rsample13', 'psample0010', 'psample0009'),
  ];
}

// Names that must never appear in public files.
export const FAMILY_ONLY_WORDS = ['Elena', 'Demova', 'Елена', 'Արմեն', 'Karine', 'Davit', 'SAMPLE FAMILY-ONLY', 'Tbilisi', 'Tiflis', 'Moscow', 'lsampletbilisi', 'lsamplemoscow', 'msample02', 'msample03'];

export function samplePlaces() {
  return [
    {
      id: 'lsamplekars', name: 'Kars', lat: 40.6013, lng: 43.0975,
      countries: [
        { country: 'Russian Empire', from: 1878, to: 1917 },
        { country: 'First Republic of Armenia', from: 1918, to: 1920 },
        { country: 'Turkey', from: 1921 },
      ],
    },
    {
      id: 'lsampleyerevan', name: 'Yerevan', lat: 40.1792, lng: 44.4991,
      names: [{ name: 'Erivan', to: 1935 }],
      countries: [
        { country: 'Russian Empire', to: 1917 },
        { country: 'First Republic of Armenia', from: 1918, to: 1920 },
        { country: 'Soviet Union (Armenian SSR)', from: 1921, to: 1991 },
        { country: 'Armenia', from: 1992 },
      ],
    },
    {
      id: 'lsampletbilisi', name: 'Tbilisi', lat: 41.7151, lng: 44.8271,
      names: [{ name: 'Tiflis', to: 1935 }],
      countries: [
        { country: 'Russian Empire', to: 1917 },
        { country: 'Democratic Republic of Georgia', from: 1918, to: 1920 },
        { country: 'Soviet Union (Georgian SSR)', from: 1921, to: 1991 },
        { country: 'Georgia', from: 1992 },
      ],
    },
    {
      id: 'lsamplemoscow', name: 'Moscow', lat: 55.7558, lng: 37.6173,
      countries: [{ country: 'Soviet Union', to: 1991 }, { country: 'Russia', from: 1992 }],
    },
  ];
}

export function sampleMoves() {
  return [
    {
      id: 'msample01', people: ['psample0001', 'psample0003', 'psample0004'], from: 'lsamplekars', to: 'lsampleyerevan',
      date: d('between 1917 and 1919'), reason: 'war',
      story: 'SAMPLE STORY: the family left Kars during the war, carrying only what fitted on one cart.',
    },
    {
      id: 'msample02', people: ['psample0006'], from: 'lsampletbilisi', to: 'lsampleyerevan',
      date: d('about 1934'), reason: 'study', story: 'SAMPLE FAMILY-ONLY STORY.',
    },
    {
      id: 'msample03', people: ['psample0009'], from: 'lsampleyerevan', to: 'lsamplemoscow', date: d('about 1995'), reason: 'work',
    },
  ];
}
