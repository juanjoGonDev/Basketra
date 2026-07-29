import test from 'node:test';
import assert from 'node:assert/strict';
import { asArray, asBoolean, asEnum, asOptionalString, asRecord, asSafeInteger, asString, ValidationError } from '../../src/domain/validation.ts';

test('runtime validation accepts valid values',()=>{
  assert.deepEqual(asRecord({a:1}),{a:1});
  assert.equal(asString(' x ','$.x',{min:1,max:2}),'x');
  assert.equal(asString('plain','$.x'),'plain');
  assert.equal(asOptionalString(undefined,'$.x'),undefined);
  assert.equal(asOptionalString(null,'$.x'),undefined);
  assert.equal(asOptionalString('','$.x'),undefined);
  assert.equal(asOptionalString(' a ','$.x',{max:2}),'a');
  assert.equal(asSafeInteger(2,'$.x',{min:1,max:3}),2);
  assert.equal(asSafeInteger(2,'$.x'),2);
  assert.equal(asBoolean(true,'$.x'),true);
  assert.deepEqual(asArray([1,2],'$.x',2),[1,2]);
  assert.deepEqual(asArray([1],'$.x'),[1]);
  assert.equal(new ValidationError('x').path,'$');
  assert.equal(new ValidationError('x','$.x').path,'$.x');
  assert.equal(asEnum('a','$.x',['a','b'] as const),'a');
});

test('runtime validation reports precise failures',()=>{
  const invalidRecords=[null,[],1];
  for(const value of invalidRecords)assert.throws(()=>asRecord(value),ValidationError);
  assert.throws(()=>asString(1,'$.x'),ValidationError);
  assert.throws(()=>asString('','$.x',{min:1}),ValidationError);
  assert.throws(()=>asString('abc','$.x',{max:2}),ValidationError);
  assert.throws(()=>asSafeInteger(1.2,'$.x'),ValidationError);
  assert.throws(()=>asSafeInteger(0,'$.x',{min:1}),ValidationError);
  assert.throws(()=>asSafeInteger(4,'$.x',{max:3}),ValidationError);
  assert.throws(()=>asBoolean('true','$.x'),ValidationError);
  assert.throws(()=>asArray({},'$.x'),ValidationError);
  assert.throws(()=>asArray([1,2],'$.x',1),ValidationError);
  assert.throws(()=>asEnum('c','$.x',['a','b'] as const),ValidationError);
});
