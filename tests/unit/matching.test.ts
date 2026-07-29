import test from 'node:test';
import assert from 'node:assert/strict';
import { rankProductCandidates, type ProductCandidate } from '../../src/domain/matching.ts';

const candidates: ProductCandidate[] = [
  { id:'ean', name:'Leche entera', brand:'Hacendado', ean:'8410000000001', packageMinor:1000, packageUnit:'ml', dietaryTags:['lactose'] },
  { id:'sku', name:'Leche entera', retailerSku:'SKU-1' },
  { id:'alias', name:'Arroz redondo', confirmedAliases:['arroz de casa'] },
  { id:'previous', name:'Café molido', previousMappings:['cafe diario'] },
  { id:'attributes', name:'Yogur natural pack', brand:'Marca', packageMinor:4, packageUnit:'unit' },
  { id:'lexical', name:'Pasta integral espagueti' },
  { id:'diet', name:'Leche normal', dietaryTags:[] },
  { id:'package', name:'Yogur natural pack', brand:'Marca', packageMinor:8, packageUnit:'unit' },
];

test('matching applies deterministic priority and explanations', () => {
  assert.equal(rankProductCandidates({ description:'x', ean:'8410000000001' }, candidates)[0]?.reason, 'ean');
  assert.equal(rankProductCandidates({ description:'x', retailerSku:'SKU-1' }, candidates)[0]?.reason, 'sku');
  assert.equal(rankProductCandidates({ description:'Árroz de casa' }, candidates)[0]?.reason, 'alias');
  assert.equal(rankProductCandidates({ description:'cafe diario' }, candidates)[0]?.reason, 'previous');
  const attribute = rankProductCandidates({ description:'yogur natural pack', brand:'Marca', packageMinor:4, packageUnit:'unit' }, candidates)[0];
  assert.equal(attribute?.candidate.id, 'attributes');
  assert.equal(attribute?.reason, 'attributes');
  assert.equal(attribute?.requiresConfirmation, false);
  const lexical = rankProductCandidates({ description:'espagueti integral' }, candidates)[0];
  assert.equal(lexical?.candidate.id, 'lexical');
  assert.equal(lexical?.reason, 'lexical');
});

test('matching rejects dietary and package mismatches and breaks ties deterministically', () => {
  const dietary = rankProductCandidates({ description:'leche', dietaryTags:['sin lactosa'] }, candidates);
  assert.equal(dietary.some((match) => match.candidate.id === 'diet'), false);
  const packageMatches = rankProductCandidates({ description:'yogur natural pack', brand:'Marca', packageMinor:4, packageUnit:'unit' }, candidates);
  assert.ok((packageMatches.find((match) => match.candidate.id === 'package')?.score ?? 0) < (packageMatches.find((match) => match.candidate.id === 'attributes')?.score ?? 0));
  assert.deepEqual(rankProductCandidates({ description:'' }, candidates), []);
  const tied = rankProductCandidates({ description:'producto' }, [{id:'b',name:'producto'},{id:'a',name:'producto'}]);
  assert.deepEqual(tied.map((match) => match.candidate.id), ['a','b']);
});
