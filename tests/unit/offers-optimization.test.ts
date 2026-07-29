import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOffer, type Offer } from '../../src/domain/offers.ts';
import { optimizeBasket } from '../../src/domain/optimization.ts';
import { rational } from '../../src/domain/units.ts';

const observedAt='2026-07-29T00:00:00.000Z';
function offer(overrides: Partial<Offer>={}): Offer {
  return { id:'o1', itemId:'milk', retailerId:'a', title:'Milk', priceMinor:120, shippingMinor:50, quantity:{amount:rational(1),unit:'l'}, stock:'in-stock', observedAt, confidence:.9, evidence:'fixture', exact:true, substitutionQuality:1, ...overrides };
}

test('offer normalization preserves evidence and applies only verified Prime shipping', () => {
  assert.deepEqual(normalizeOffer(offer()).shippingMinor, 50);
  assert.equal(normalizeOffer(offer({primeEligible:true})).shippingMinor, 50);
  assert.equal(normalizeOffer(offer({primeEligible:true,primeFreeDeliveryEvidence:true,promotionMinor:20})).effectiveMinor, 100);
  assert.deepEqual(normalizeOffer(offer()).normalizedMinorPerBaseUnit, rational(3,25));
  assert.throws(() => normalizeOffer(offer({priceMinor:-1})), RangeError);
  assert.throws(() => normalizeOffer(offer({confidence:2})), RangeError);
  assert.throws(() => normalizeOffer(offer({substitutionQuality:-1})), RangeError);
  assert.throws(() => normalizeOffer(offer({evidence:' '})), RangeError);
});

test('optimization produces deterministic single, balanced and maximum-saving plans', () => {
  const input={requirements:[{itemId:'milk',label:'Milk',exactRequired:false,substitutionAllowed:true},{itemId:'rice',label:'Rice',exactRequired:true,substitutionAllowed:false}],retailerPenaltyMinor:40,offers:[offer(),offer({id:'r1',itemId:'rice',title:'Rice',priceMinor:200,shippingMinor:50}),offer({id:'o2',retailerId:'b',title:'Alt milk',priceMinor:80,shippingMinor:0,exact:false,confidence:.8,substitutionQuality:.8}),offer({id:'r2',itemId:'rice',retailerId:'b',title:'Rice',priceMinor:170,shippingMinor:0})]};
  const plans=optimizeBasket(input);
  assert.deepEqual(plans.map(plan=>plan.kind),['single-retailer','balanced','maximum-saving']);
  assert.deepEqual(plans[0]?.retailerIds,['b']);
  assert.equal(plans[0]?.substitutions.length,1);
  assert.equal(plans[1]?.effectiveTotalMinor,250);
  assert.equal(plans[2]?.effectiveTotalMinor,250);
  assert.match(plans[0]?.explanation ?? '',/1 retailer/);
});

test('optimization handles missing items, limits, stock, exact locks, shipping and tie breaks', () => {
  const missing=optimizeBasket({requirements:[{itemId:'x',label:'X',exactRequired:true,substitutionAllowed:false}],offers:[offer({id:'z',itemId:'x',retailerId:'z',exact:false}),offer({id:'a',itemId:'other',retailerId:'a'})],retailerPenaltyMinor:0});
  assert.equal(missing[0]?.missingItemIds.length,1);
  assert.match(missing[0]?.explanation ?? '',/Missing/);
  const zeroConfidence=optimizeBasket({requirements:[{itemId:'x',label:'X',exactRequired:true,substitutionAllowed:false}],offers:[offer({id:'a',itemId:'other',retailerId:'a'})],retailerPenaltyMinor:0});
  assert.equal(zeroConfidence[0]?.confidence,0);
  const tied=optimizeBasket({requirements:[{itemId:'milk',label:'Milk',exactRequired:true,substitutionAllowed:false}],offers:[offer({id:'b',retailerId:'b',shippingMinor:0}),offer({id:'a',retailerId:'a',shippingMinor:0})],retailerPenaltyMinor:0,maxRetailers:1,travelCostMinorByRetailer:{a:0,b:0}});
  assert.deepEqual(tied[0]?.retailerIds,['a']);
  const confidenceTie=optimizeBasket({requirements:[{itemId:'milk',label:'Milk',exactRequired:true,substitutionAllowed:false}],offers:[offer({id:'low',retailerId:'a',shippingMinor:0,confidence:.5}),offer({id:'high',retailerId:'a',shippingMinor:0,confidence:.9})],retailerPenaltyMinor:0});
  assert.equal(confidenceTie[0]?.selectedOffers[0]?.id,'high');
  const idTie=optimizeBasket({requirements:[{itemId:'milk',label:'Milk',exactRequired:true,substitutionAllowed:false}],offers:[offer({id:'z',retailerId:'a',shippingMinor:0}),offer({id:'a',retailerId:'a',shippingMinor:0})],retailerPenaltyMinor:0});
  assert.equal(idTie[0]?.selectedOffers[0]?.id,'a');
  const unavailable=optimizeBasket({requirements:[{itemId:'milk',label:'Milk',exactRequired:false,substitutionAllowed:false}],offers:[offer({id:'out',stock:'out-of-stock'}),offer({id:'sub',exact:false})],retailerPenaltyMinor:0});
  assert.equal(unavailable[0]?.missingItemIds.length,1);
  assert.throws(()=>optimizeBasket({requirements:[],offers:[],retailerPenaltyMinor:0}),RangeError);
  assert.throws(()=>optimizeBasket({requirements:[],offers:[offer()],retailerPenaltyMinor:-1}),RangeError);
  assert.throws(()=>optimizeBasket({requirements:[],offers:[offer()],retailerPenaltyMinor:0,maxRetailers:0}),RangeError);
  assert.throws(()=>optimizeBasket({requirements:[],offers:Array.from({length:13},(_,i)=>offer({id:String(i),retailerId:String(i)})),retailerPenaltyMinor:0}),RangeError);
});
