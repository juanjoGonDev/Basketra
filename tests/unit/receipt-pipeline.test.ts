import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AiProvider, AiStructuredInput } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { MultimodalAiOcrProvider } from '../../src/ocr/provider.ts';
import {
  buildReceiptReview,
  extractDeclaredTotalMinor,
  parseDeterministicReceiptText,
  verifyReceiptWithAi,
} from '../../src/receipts/extraction.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

const pngBase64=Buffer.from(Uint8Array.from([0x89,0x50,0x4e,0x47,0x00])).toString('base64');
const pdfBase64=Buffer.from('%PDF-1.4\nfixture').toString('base64');

function provider(overrides:Partial<AiProvider>={}):AiProvider{
  return {
    async getCapabilities(){return {structuredOutput:true,jsonObject:true,image:true,pdf:false,internetSearch:false}},
    async testConnection(){return {ok:true}},
    async executeStructured(){return {text:'MILK 1 x 1,20 1,20',confidence:.9}},
    dispose(){},
    ...overrides,
  };
}

test('deterministic receipt parsing preserves arithmetic evidence and totals',()=>{
  const text='Milk;2;120;240\nBread 1 x 1,50 1,50\nRice 2,85\nTOTAL 6,75\nMilk;2;120;240';
  const items=parseDeterministicReceiptText(text);
  assert.equal(items.length,3);
  assert.deepEqual(items[0],{description:'Milk',quantity:2,unitPriceMinor:120,lineTotalMinor:240,confidence:1});
  assert.equal(items[1]?.lineTotalMinor,150);
  assert.equal(items[2]?.lineTotalMinor,285);
  assert.equal(extractDeclaredTotalMinor(text),675);
  assert.equal(extractDeclaredTotalMinor('No total'),undefined);
});

test('receipt review keeps low confidence and arithmetic mismatches visible',()=>{
  const review=buildReceiptReview([
    {description:'Milk',quantity:1,unitPriceMinor:120,lineTotalMinor:120,confidence:.7},
    {description:'Bread',quantity:2,unitPriceMinor:100,lineTotalMinor:150,confidence:1},
  ],270);
  assert.equal(review.lines[0]?.status,'needs-review');
  assert.equal(review.lines[1]?.status,'arithmetic-mismatch');
  assert.deepEqual(review.total,{expectedMinor:270,differenceMinor:0,valid:true});
  assert.equal(buildReceiptReview([],undefined).total,undefined);
});

test('multimodal OCR sends validated image content and enforces capabilities',async()=>{
  let request:AiStructuredInput|undefined;
  const mock=provider({async executeStructured(input){request=input;return {text:' Milk ',confidence:.8}}});
  const ocr=new MultimodalAiOcrProvider(mock,0);
  const result=await ocr.recognize({mimeType:'image/png',bytes:Buffer.from(pngBase64,'base64')});
  assert.deepEqual(result,{text:'Milk',confidence:.8,source:'provider'});
  assert.equal(Array.isArray(request?.content),true);
  assert.match(JSON.stringify(request?.content),/^\[.*data:image\/png;base64,/);
  ocr.dispose();

  const noImage=new MultimodalAiOcrProvider(provider({async getCapabilities(){return {structuredOutput:true,jsonObject:true,image:false,pdf:false,internetSearch:false}}}),0);
  await assert.rejects(()=>noImage.recognize({mimeType:'image/png',bytes:new Uint8Array()}),/IMAGE_CAPABILITY/);
  const noPdf=new MultimodalAiOcrProvider(provider(),0);
  await assert.rejects(()=>noPdf.recognize({mimeType:'application/pdf',bytes:Buffer.from(pdfBase64,'base64')}),/PDF_CAPABILITY/);
  await assert.rejects(()=>ocr.recognize({mimeType:'text/plain',bytes:new Uint8Array()}),/Unsupported/);
});

test('AI receipt verification validates interpretation locally',async()=>{
  const mock=provider({async executeStructured(){return {currency:'EUR',declaredTotalMinor:120,items:[{description:'Milk',quantity:1,unitPriceMinor:120,lineTotalMinor:120,confidence:.9}],warnings:[]}}});
  const result=await verifyReceiptWithAi(mock,0,'Milk 1,20');
  assert.equal(result.value.items[0]?.description,'Milk');
  assert.equal(result.value.declaredTotalMinor,120);
  await assert.rejects(()=>verifyReceiptWithAi(provider({async executeStructured(){return {currency:'USD',items:[],warnings:[]}}}),0,'x'));
});

test('receipt service skips OCR and AI when embedded text is supplied',async()=>{
  const root=mkdtempSync(join(tmpdir(),'basketra-receipt-service-'));
  const store=new FileStore(join(root,'files'),join(root,'tmp'),1024);
  try{
    const file=store.storeBase64({base64:pngBase64,mimeType:'image/png'});
    let providerCalls=0;
    const service=new ReceiptExtractionService(store,()=>{providerCalls+=1;return provider()},0);
    const input=service.parseRequest({captures:[{storageKey:file.storageKey,embeddedText:'Milk;1;120;120\nTOTAL 1,20'}],verifyWithAi:false});
    const result=await service.extract(input);
    assert.equal(providerCalls,0);
    assert.equal(result.pages[0]?.source,'embedded-text');
    assert.equal(result.final.review.lines[0]?.status,'confirmed');
    assert.equal(result.final.declaredTotalMinor,120);
    assert.throws(()=>service.parseRequest({captures:[],verifyWithAi:false}),/At least one/);
    service.dispose();
  }finally{rmSync(root,{recursive:true,force:true})}
});

test('receipt service uses OCR and AI proposals but validates arithmetic independently',async()=>{
  const root=mkdtempSync(join(tmpdir(),'basketra-receipt-ai-'));
  const store=new FileStore(join(root,'files'),join(root,'tmp'),1024);
  try{
    const file=store.storeBase64({base64:pngBase64,mimeType:'image/png'});
    let calls=0;
    const mock=provider({async executeStructured(){calls+=1;return calls===1?{text:'Milk 1,20\nTOTAL 1,20',confidence:.9}:{currency:'EUR',declaredTotalMinor:120,items:[{description:'Milk',quantity:1,unitPriceMinor:120,lineTotalMinor:110,confidence:.9}],warnings:['line mismatch']}}});
    const service=new ReceiptExtractionService(store,()=>mock,0);
    const result=await service.extract(service.parseRequest({captures:[{storageKey:file.storageKey}],verifyWithAi:true}));
    assert.equal(calls,2);
    assert.equal(result.ai?.attempts,1);
    assert.equal(result.final.review.lines[0]?.status,'arithmetic-mismatch');
    assert.equal(result.final.review.total?.valid,false);
  }finally{rmSync(root,{recursive:true,force:true})}
});
