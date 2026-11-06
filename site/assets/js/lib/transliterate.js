// Guess how a name typed in English is written in Armenian and in Russian.
// 1) A list of common names with their real spellings (sure).
// 2) Spelling rules for everything else, giving several ranked guesses with a
//    confidence, so the editor can fill in automatically only when fairly sure.

// ---------- common names: English spellings -> Armenian, Russian ----------
// First spelling in each list is the usual one.
const NAMES = [
  // men
  [['hovhannes', 'hovannes', 'ovanes', 'hovanes', 'oganes'], ['Հովհաննես'], ['Ованес', 'Оганес', 'Ованнес']],
  [['hakob', 'hakop', 'akop', 'hagop', 'akob'], ['Հակոբ'], ['Акоп', 'Акоб']],
  [['grigor', 'grikor', 'grigori'], ['Գրիգոր'], ['Григорий', 'Григор']],
  [['gevorg', 'gevork', 'georg'], ['Գևորգ'], ['Геворг', 'Георгий']],
  [['davit', 'david'], ['Դավիթ'], ['Давид']],
  [['aram'], ['Արամ'], ['Арам']],
  [['armen'], ['Արմեն'], ['Армен']],
  [['arsen'], ['Արսեն'], ['Арсен']],
  [['artur', 'arthur'], ['Արթուր'], ['Артур']],
  [['ashot'], ['Աշոտ'], ['Ашот']],
  [['avetik'], ['Ավետիք'], ['Аветик']],
  [['andranik'], ['Անդրանիկ'], ['Андраник']],
  [['ararat'], ['Արարատ'], ['Арарат']],
  [['arshak'], ['Արշակ'], ['Аршак']],
  [['babken'], ['Բաբկեն'], ['Бабкен']],
  [['edgar'], ['Էդգար'], ['Эдгар']],
  [['eduard', 'edward'], ['Էդուարդ'], ['Эдуард']],
  [['gagik'], ['Գագիկ'], ['Гагик']],
  [['garnik'], ['Գառնիկ'], ['Гарник']],
  [['hayk', 'haik', 'haig'], ['Հայկ'], ['Айк', 'Гайк']],
  [['hamlet'], ['Համլետ'], ['Гамлет']],
  [['henrik'], ['Հենրիկ'], ['Генрих', 'Генрик']],
  [['hrachya', 'hrach'], ['Հրաչյա'], ['Грачья', 'Грач']],
  [['hrant'], ['Հրանտ'], ['Грант']],
  [['karen'], ['Կարեն'], ['Карен']],
  [['khachatur', 'khachatour', 'khachik'], ['Խաչատուր'], ['Хачатур']],
  [['levon'], ['Լևոն'], ['Левон']],
  [['mesrop'], ['Մեսրոպ'], ['Месроп']],
  [['mher'], ['Մհեր'], ['Мгер']],
  [['mikayel', 'mikael', 'mikhail', 'michael'], ['Միքայել'], ['Микаел', 'Михаил']],
  [['mkrtich', 'mkrtich'], ['Մկրտիչ'], ['Мкртич']],
  [['narek'], ['Նարեկ'], ['Нарек']],
  [['nerses'], ['Ներսես'], ['Нерсес']],
  [['norayr', 'norair'], ['Նորայր'], ['Норайр']],
  [['petros'], ['Պետրոս'], ['Петрос', 'Пётр']],
  [['rafik'], ['Ռաֆիկ'], ['Рафик']],
  [['robert'], ['Ռոբերտ'], ['Роберт']],
  [['ruben'], ['Ռուբեն'], ['Рубен']],
  [['samvel', 'samuel'], ['Սամվել'], ['Самвел']],
  [['sargis', 'sarkis'], ['Սարգիս'], ['Саркис', 'Саргис']],
  [['sergey', 'sergei'], ['Սերգեյ'], ['Сергей']],
  [['smbat'], ['Սմբատ'], ['Смбат']],
  [['suren'], ['Սուրեն'], ['Сурен']],
  [['tigran'], ['Տիգրան'], ['Тигран']],
  [['vahan'], ['Վահան'], ['Ваан', 'Ваган']],
  [['vahe', 'vaghe'], ['Վահե'], ['Ваэ', 'Ваге']],
  [['vardan', 'vartan'], ['Վարդան'], ['Вардан']],
  [['vazgen'], ['Վազգեն'], ['Вазген']],
  [['zaven'], ['Զավեն'], ['Завен']],
  [['vano'], ['Վանո'], ['Вано']],
  [['ivan'], ['Իվան'], ['Иван']],
  [['nikolay', 'nikolai'], ['Նիկոլայ'], ['Николай']],
  [['vladimir'], ['Վլադիմիր'], ['Владимир']],
  [['aleksandr', 'alexander', 'alexandr'], ['Ալեքսանդր'], ['Александр']],
  [['yuri', 'yuriy', 'yury'], ['Յուրի'], ['Юрий']],
  [['petr', 'pyotr'], ['Պյոտր'], ['Пётр', 'Петр']],
  [['pavel'], ['Պավել'], ['Павел']],
  [['boris'], ['Բորիս'], ['Борис']],
  [['viktor', 'victor'], ['Վիկտոր'], ['Виктор']],
  // women
  [['anahit'], ['Անահիտ'], ['Анаит', 'Анахит']],
  [['anna'], ['Աննա'], ['Анна']],
  [['ani'], ['Անի'], ['Ани']],
  [['araksya', 'araksia', 'araks'], ['Արաքսյա'], ['Араксия', 'Аракс']],
  [['armine', 'armineh'], ['Արմինե'], ['Армине']],
  [['arpi'], ['Արփի'], ['Арпи']],
  [['astghik', 'asthik'], ['Աստղիկ'], ['Астхик']],
  [['gayane', 'gayaneh'], ['Գայանե'], ['Гаяне']],
  [['gohar'], ['Գոհար'], ['Гоар']],
  [['hasmik'], ['Հասմիկ'], ['Асмик']],
  [['hripsime'], ['Հռիփսիմե'], ['Рипсиме']],
  [['karine'], ['Կարինե'], ['Карине']],
  [['lilit'], ['Լիլիթ'], ['Лилит']],
  [['lusine', 'lousine'], ['Լուսինե'], ['Лусине']],
  [['mariam', 'mariami'], ['Մարիամ'], ['Мариам']],
  [['margarit'], ['Մարգարիտ'], ['Маргарита']],
  [['marine'], ['Մարինե'], ['Марине']],
  [['narine'], ['Նարինե'], ['Нарине']],
  [['nune'], ['Նունե'], ['Нуне']],
  [['nvard'], ['Նվարդ'], ['Нвард']],
  [['ruzanna', 'ruzan'], ['Ռուզաննա'], ['Рузанна']],
  [['satenik'], ['Սաթենիկ'], ['Сатеник']],
  [['seda'], ['Սեդա'], ['Седа']],
  [['shushan'], ['Շուշան'], ['Шушан']],
  [['siranush', 'siranoush'], ['Սիրանուշ'], ['Сирануш']],
  [['sona'], ['Սոնա'], ['Сона']],
  [['susanna'], ['Սուսաննա'], ['Сусанна']],
  [['tamara'], ['Թամարա'], ['Тамара']],
  [['tatevik'], ['Տաթևիկ'], ['Татевик']],
  [['zaruhi', 'zarouhi'], ['Զարուհի'], ['Заруи']],
  [['elena', 'yelena'], ['Էլենա', 'Ելենա'], ['Елена']],
  [['olga'], ['Օլգա'], ['Ольга']],
  [['natalya', 'natalia', 'natasha'], ['Նատալյա'], ['Наталья', 'Наталия']],
  [['irina'], ['Իրինա'], ['Ирина']],
  [['svetlana'], ['Սվետլանա'], ['Светлана']],
  [['lyudmila', 'ludmila', 'lyudmilla'], ['Լյուդմիլա'], ['Людмила']],
  [['galina'], ['Գալինա'], ['Галина']],
  [['tatyana', 'tatiana'], ['Տատյանա'], ['Татьяна']],
  [['maria', 'mariya'], ['Մարիա'], ['Мария']],
  [['nina'], ['Նինա'], ['Нина']],
  [['vera'], ['Վերա'], ['Вера']],
  [['valentina'], ['Վալենտինա'], ['Валентина']],
  [['raisa'], ['Ռաիսա'], ['Раиса']],
  [['inna'], ['Իննա'], ['Инна']],
  [['alla'], ['Ալլա'], ['Алла']],
];

const DICT = new Map();
for (const [latins, hy, ru] of NAMES) for (const l of latins) if (!DICT.has(l)) DICT.set(l, { hy, ru });

// ---------- spelling rules ----------
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const isVowel = (c) => VOWELS.has(c);

// Each rule: [latin, options[[out, probability]], where?]  — longest match first.
// where: 'start' only at word start, 'end' only at word end, 'mid' not at start.
const HY_RULES = [
  ['yan', [['յան', 1]], 'end'],
  ['ian', [['յան', 0.8], ['իան', 0.2]], 'end'],
  ['yants', [['յանց', 1]], 'end'],
  ['unts', [['ունց', 1]], 'end'],
  ['ye', [['Ե', 1]], 'start'],
  ['ev', [['և', 0.9], ['եվ', 0.1]], 'mid'],
  ['ou', [['ու', 1]]],
  ["ch'", [['չ', 1]]], ["ts'", [['ց', 1]]], ["t'", [['թ', 1]]], ["p'", [['փ', 1]]], ["k'", [['ք', 1]]],
  ['tch', [['չ', 0.6], ['ճ', 0.4]], 'start'], // French-style spelling: Tchakhmakhchyan
  ['sh', [['շ', 1]]], ['zh', [['ժ', 1]]], ['kh', [['խ', 1]]], ['gh', [['ղ', 1]]],
  ['ch', [['չ', 0.6], ['ճ', 0.4]]], ['ts', [['ց', 0.6], ['ծ', 0.4]]], ['dz', [['ձ', 1]]],
  ['th', [['թ', 1]]], ['ph', [['փ', 1]]], ['rr', [['ռ', 1]]],
  ['a', [['ա', 1]]], ['b', [['բ', 1]]], ['g', [['գ', 1]]], ['d', [['դ', 1]]], ['z', [['զ', 1]]],
  ['e', [['է', 0.6], ['ե', 0.4]], 'start'], ['e', [['ե', 0.95], ['է', 0.05]]],
  ['i', [['ի', 1]]], ['l', [['լ', 1]]], ['h', [['հ', 1]]], ['m', [['մ', 1]]], ['n', [['ն', 1]]],
  ['o', [['օ', 0.7], ['ո', 0.3]], 'start'], ['o', [['ո', 1]]],
  ['u', [['ու', 1]]], ['j', [['ջ', 1]]], ['s', [['ս', 1]]], ['v', [['վ', 1]]], ['f', [['ֆ', 1]]],
  ['p', [['պ', 0.88], ['փ', 0.12]]], ['t', [['տ', 0.85], ['թ', 0.15]]], ['k', [['կ', 0.7], ['ք', 0.3]]],
  // Armenian names starting with R usually use Ռ (Ռուբեն); inside a word Ր is usual.
  ['r', [['ռ', 0.8], ['ր', 0.2]], 'start'], ['r', [['ր', 0.9], ['ռ', 0.1]]], ['q', [['ք', 1]]], ['x', [['խ', 1]]], ['w', [['վ', 1]]], ['c', [['ց', 0.5], ['կ', 0.5]]],
  ['y', [['յ', 1]], 'beforeVowel'], ['y', [['յ', 1]], 'afterVowel'], ['y', [['ը', 0.7], ['յ', 0.3]]],
];

const RU_RULES = [
  ['yan', [['ян', 1]], 'end'],
  ['ian', [['ян', 0.5], ['иан', 0.5]], 'end'],
  ['unts', [['унц', 1]], 'end'],
  ['shch', [['щ', 1]]],
  ['ye', [['е', 1]], 'start'],
  ['ye', [['ье', 0.6], ['е', 0.4]], 'mid'],
  ['ya', [['я', 1]]], ['yu', [['ю', 1]]], ['yo', [['ё', 0.5], ['йо', 0.5]]],
  ['sh', [['ш', 1]]], ['zh', [['ж', 1]]], ['kh', [['х', 1]]], ['gh', [['г', 0.6], ['х', 0.25], ['к', 0.15]]],
  ['ch', [['ч', 1]]], ['ts', [['ц', 1]]], ['dz', [['дз', 1]]], ['th', [['т', 1]]], ['ph', [['ф', 1]]],
  ["'", [['', 1]]],
  ['a', [['а', 1]]], ['b', [['б', 1]]], ['v', [['в', 1]]], ['g', [['г', 1]]], ['d', [['д', 1]]],
  ['e', [['э', 0.65], ['е', 0.35]], 'start'], ['e', [['е', 1]]],
  ['z', [['з', 1]]], ['i', [['и', 1]]], ['k', [['к', 1]]], ['l', [['л', 1]]], ['m', [['м', 1]]],
  ['n', [['н', 1]]], ['o', [['о', 1]]], ['p', [['п', 1]]], ['r', [['р', 1]]], ['s', [['с', 1]]],
  ['t', [['т', 1]]], ['u', [['у', 1]]], ['f', [['ф', 1]]], ['j', [['дж', 1]]], ['q', [['к', 1]]],
  ['w', [['в', 1]]], ['x', [['кс', 1]]], ['c', [['к', 0.6], ['ц', 0.4]]],
  // Armenian names in Russian usually drop "h" (Hakob → Акоп), or write г before a consonant (Hrant → Грант).
  ['h', [['г', 0.7], ['х', 0.3]], 'beforeConsonant'],
  ['h', [['', 0.5], ['г', 0.3], ['х', 0.2]]],
  ['y', [['й', 1]], 'afterVowel'], ['y', [['й', 1]], 'start'], ['y', [['ы', 0.5], ['и', 0.5]]],
];

function tokenize(word, rules) {
  // Returns a list of option lists for the word.
  const out = [];
  let i = 0;
  while (i < word.length) {
    let matched = null;
    for (const [lat, opts, where] of rules) {
      if (!word.startsWith(lat, i)) continue;
      const end = i + lat.length;
      const next = word[end];
      const prev = word[i - 1];
      if (where === 'start' && i !== 0) continue;
      if (where === 'mid' && (i === 0 || end >= word.length)) continue;
      if (where === 'end' && end !== word.length) continue;
      if (where === 'beforeVowel' && !(next && isVowel(next))) continue;
      if (where === 'afterVowel' && !(prev && isVowel(prev))) continue;
      if (where === 'beforeConsonant' && !(next && !isVowel(next))) continue;
      matched = [lat.length, opts];
      break;
    }
    if (!matched) { out.push([[word[i], 1]]); i++; continue; }
    out.push(matched[1]);
    i += matched[0];
  }
  return out;
}

/** Best few spellings with their confidence, by keeping the most likely partial spellings. */
function combine(tokens, limit = 6) {
  let beams = [{ s: '', p: 1 }];
  for (const opts of tokens) {
    const next = [];
    for (const b of beams) for (const [out, p] of opts) next.push({ s: b.s + out, p: b.p * p });
    next.sort((a, b) => b.p - a.p);
    beams = next.slice(0, 12);
  }
  const seen = new Set();
  return beams.filter((b) => (seen.has(b.s) ? false : seen.add(b.s))).slice(0, limit);
}

const capitalize = (s) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
// Armenian "ու" at the start of a name is written "Ու"; "և" becomes "Եվ".
const capHy = (s) => (s.startsWith('և') ? `Եվ${s.slice(1)}` : capitalize(s));

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'");

/** Ranked guesses for one word: [{ text, p }]. */
function guessWord(word, script) {
  const w = norm(word);
  if (!w) return [];
  const known = DICT.get(w);
  if (known) {
    const list = script === 'armenian' ? known.hy : known.ru;
    return list.map((text, i) => ({ text, p: i === 0 ? 1 : 0.5, known: true }));
  }
  if (!/^[a-z']+$/.test(w)) return [];
  const rules = script === 'armenian' ? HY_RULES : RU_RULES;
  return combine(tokenize(w, rules)).map((b) => ({ text: script === 'armenian' ? capHy(b.s) : capitalize(b.s), p: b.p }));
}

const AUTO_CONFIDENCE = 0.6;

/**
 * Guess how a (multi-word) name is written in Armenian or Russian.
 * Returns { auto: string | null, options: [string] }.
 * "auto" is set only when fairly sure; options are other likely spellings.
 */
export function guessName(latin, script) {
  const words = String(latin || '').trim().split(/(\s+|-)/);
  if (!words.join('').trim()) return { auto: null, options: [] };
  let combos = [{ s: '', p: 1 }];
  for (const part of words) {
    if (/^(\s+|-)$/.test(part)) { combos = combos.map((c) => ({ ...c, s: c.s + (part === '-' ? '-' : ' ') })); continue; }
    const g = guessWord(part, script);
    if (!g.length) return { auto: null, options: [] };
    const next = [];
    for (const c of combos) for (const x of g.slice(0, 4)) next.push({ s: c.s + x.text, p: c.p * x.p });
    next.sort((a, b) => b.p - a.p);
    combos = next.slice(0, 8);
  }
  const options = [...new Set(combos.map((c) => c.s))].slice(0, 5);
  const auto = combos[0].p >= AUTO_CONFIDENCE ? combos[0].s : null;
  return { auto, options: auto ? options.filter((o) => o !== auto) : options };
}

// ---------- patronymics ----------

/** Russian patronymic from a Russian first name. sex: 'male' | 'female'. */
export function russianPatronymic(rawName, sex) {
  const name = rawName.replace(/ё/g, 'е'); // Пётр -> Петрович
  const m = sex === 'female' ? 'на' : 'ич';
  if (/ий$/.test(name)) return `${name.slice(0, -2)}ьев${m}`; // Григорий -> Григорьевич
  if (/[аеиоуэюя]й$/.test(name)) return `${name.slice(0, -1)}ев${m}`; // Андрей -> Андреевич
  if (/ь$/.test(name)) return `${name.slice(0, -1)}ев${m}`; // Игорь -> Игоревич
  if (/[жшчщц]$/.test(name)) return `${name}ев${m}`;
  if (/[ая]$/.test(name)) return sex === 'female' ? `${name.slice(0, -1)}ична` : `${name.slice(0, -1)}ич`;
  return `${name}ов${m}`; // Ованес -> Ованесович
}

/** Father's first name (in English) from an English patronymic, e.g. "Grigori" or "Grigoryevich" -> "Grigor(y)". */
function fatherFromPatronymic(latin) {
  const w = norm(latin).trim();
  const ru = w.match(/^(.+?)(?:yevich|ievich|evich|ovich|yevna|ievna|evna|ovna)$/);
  if (ru) return ru[1];
  if (w.endsWith('i') && DICT.has(w.slice(0, -1))) return w.slice(0, -1);
  return w.endsWith('i') && w.length > 3 ? w.slice(0, -1) : w;
}

/**
 * Patronymic guesses: Armenian style "Գրիգորի" (father's name + ի),
 * Russian style "Григорьевич"/"Григорьевна" (depends on sex).
 */
export function guessPatronymic(latin, script, sex = 'unknown') {
  const father = fatherFromPatronymic(latin);
  if (!father) return { auto: null, options: [] };
  if (script === 'armenian') {
    const g = guessName(father, 'armenian');
    const base = [g.auto, ...g.options].filter(Boolean);
    const forms = base.map((b) => `${b}ի`);
    return { auto: g.auto ? `${g.auto}ի` : null, options: forms.filter((f) => f !== (g.auto ? `${g.auto}ի` : null)) };
  }
  const g = guessName(father, 'cyrillic');
  const names = [g.auto, ...g.options].filter(Boolean).slice(0, 3);
  const sexes = sex === 'male' || sex === 'female' ? [sex] : ['male', 'female'];
  const forms = [...new Set(names.flatMap((n) => sexes.map((s) => russianPatronymic(n, s))))];
  // Sure only when we know the name, the sex, and there is one clear form.
  const sure = g.auto && DICT.has(norm(father)) && sexes.length === 1;
  return { auto: sure ? forms[0] : null, options: sure ? forms.slice(1) : forms.slice(0, 6) };
}

/** One entry point for the editor: part is 'first' | 'last' | 'patronymic' | 'maiden'. */
export function suggestName(latin, script, part, { sex } = {}) {
  if (part === 'patronymic') return guessPatronymic(latin, script, sex);
  return guessName(latin, script);
}
