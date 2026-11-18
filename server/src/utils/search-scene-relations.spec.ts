import { resolveSceneRelation } from 'src/utils/search-scene-relations.js';

describe('scene relation intent', () => {
  it.each([
    'на лошади',
    'Маша на лошади',
    'Маша верхом на пони',
    'на белой лошади',
    'НА ЧЁРНОМ ПОНИ',
    'сидит на моей любимой рыжей лошади',
    'на коне',
    'на лошадях',
  ])('preserves the riding relation in %s', (query) => {
    expect(resolveSceneRelation(query)).toEqual({ predicate: 'riding', object: 'horse' });
  });

  it.each([
    'лошадь',
    'Маша с лошадью',
    'Маша рядом с пони',
    'на фоне лошади',
    'Маша на море',
    'самолёт',
    'на фотографии лошади',
    'не на лошади',
    'не верхом на пони',
    'на коньках',
  ])('does not invent a riding relation in %s', (query) => {
    expect(resolveSceneRelation(query)).toBeUndefined();
  });
});
