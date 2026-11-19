import { tokenizeForSearch } from 'src/utils/database.js';

const lookalikes: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
  a: 'а',
  c: 'с',
  e: 'е',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  b: 'ь',
  '3': 'З',
};

export const tokenizeOcrSearch = (text: string): string[] =>
  tokenizeForSearch(text).flatMap((token) => {
    if (!/\p{Script=Cyrillic}/u.test(token) || !/\p{Script=Latin}/u.test(token)) return token;
    const alias = [...token].map((character) => lookalikes[character] ?? character).join('');
    return alias === token ? token : [token, alias.toLowerCase()];
  });
