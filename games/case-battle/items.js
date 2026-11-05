// Кейсы, предметы и честный бросок.
//
// Бросок детерминированный: из (комната + партия + игрок + номер открытия + кейс)
// получается ровно один и тот же предмет на любом устройстве. Это не защищает от
// подделки состояния (каждый клиент — хозяин своих чисел), но убирает «повезло/не повезло
// по-разному у всех» и делает результат воспроизводимым: тот же вход — тот же дроп.

export const RARITIES = [
  { id: 'common',   name: 'обычный',      color: '#8f9bb3' },
  { id: 'uncommon', name: 'необычный',    color: '#4d9bff' },
  { id: 'rare',     name: 'редкий',       color: '#a35bff' },
  { id: 'epic',     name: 'эпический',    color: '#ff2bd6' },
  { id: 'legend',   name: 'легендарный',  color: '#ffd400' }
];

// шансы заданы весами: чем больше вес, тем чаще выпадает
export const CASES = [
  {
    id: 'shards',
    name: 'Осколки',
    price: 50,
    accent: '#4d9bff',
    tiers: [
      { w: 60, min: 5,   max: 18,  names: ['Треснувшее стекло', 'Ржавый болт', 'Обломок платы', 'Мятая наклейка'] },
      { w: 27, min: 18,  max: 45,  names: ['Синий кристалл', 'Катушка провода', 'Осколок линзы', 'Значок стажёра'] },
      { w: 10, min: 45,  max: 120, names: ['Фиолетовый контур', 'Плата дрона', 'Ключ неизвестно от чего', 'Стеклянный глаз'] },
      { w: 2.7, min: 120, max: 340, names: ['Сердце лампы', 'Розовый разряд', 'Кристалл помех'] },
      { w: 0.3, min: 340, max: 900, names: ['Абсолютный осколок', 'Лампа первого света'] }
    ]
  },
  {
    id: 'plasma',
    name: 'Плазма',
    price: 150,
    accent: '#a35bff',
    tiers: [
      { w: 45, min: 15,  max: 55,  names: ['Плазменная искра', 'Газовая трубка', 'Метка клана', 'Разрядник'] },
      { w: 30, min: 55,  max: 140, names: ['Синий сердечник', 'Кольцо тока', 'Стабилизатор', 'Дуговой след'] },
      { w: 18, min: 140, max: 380, names: ['Фиолетовый реактор', 'Плазменный коготь', 'Сосуд вакуума'] },
      { w: 5.5, min: 380, max: 900, names: ['Розовая звезда', 'Сердце дуги', 'Разряд бесконечности'] },
      { w: 1.5, min: 900, max: 2200, names: ['Плазменный бог', 'Свет первой секунды'] }
    ]
  },
  {
    id: 'abyss',
    name: 'Бездна',
    price: 500,
    accent: '#ff2bd6',
    tiers: [
      { w: 30, min: 40,   max: 150,  names: ['Тёмная пыль', 'Пустой сосуд', 'Немой датчик', 'Пепел сигнала'] },
      { w: 30, min: 150,  max: 420,  names: ['Синяя мгла', 'Глубинный шум', 'Холодный контур', 'Слепой сенсор'] },
      { w: 25, min: 420,  max: 1100, names: ['Фиолетовый прилив', 'Печать бездны', 'Обсидиановая сфера'] },
      { w: 11, min: 1100, max: 2600, names: ['Розовый разлом', 'Око глубины', 'Клык тишины'] },
      { w: 4,  min: 2600, max: 6000, names: ['Абсолютная бездна', 'Последний свет'] }
    ]
  }
];

export function caseById(id) {
  return CASES.find(function (c) { return c.id === id; }) || null;
}

// FNV-1a: короткий и стабильный хеш строки в 32 бита
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// генератор псевдослучайных чисел из зерна
export function makeRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Бросок предмета из кейса.
 * seedStr должен полностью определять бросок: комната + партия + игрок + номер + кейс.
 */
export function rollItem(caseDef, seedStr) {
  const rnd = makeRandom(hashSeed(seedStr));

  const total = caseDef.tiers.reduce(function (s, t) { return s + t.w; }, 0);
  let x = rnd() * total;
  let tierIndex = 0;
  for (let i = 0; i < caseDef.tiers.length; i++) {
    x -= caseDef.tiers[i].w;
    if (x <= 0) { tierIndex = i; break; }
    tierIndex = i;
  }

  const tier = caseDef.tiers[tierIndex];
  const value = tier.min + Math.floor(rnd() * (tier.max - tier.min + 1));
  const name = tier.names[Math.floor(rnd() * tier.names.length)];

  return {
    name: name,
    value: value,
    tier: tierIndex,
    rarity: RARITIES[tierIndex].name,
    color: RARITIES[tierIndex].color
  };
}

// предмет «на прокрутку»: не настоящий дроп, просто заполнитель для анимации
export function decoyItem(caseDef, seedStr) {
  return rollItem(caseDef, seedStr + '|decoy');
}
