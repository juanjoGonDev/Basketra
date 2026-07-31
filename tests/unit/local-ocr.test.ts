import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OcrError,
  TesseractCliOcrProvider,
  parseTesseractTsv,
  runTesseractProcess,
  type OcrProcessRequest,
} from '../../src/ocr/provider.ts';

const tsv = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t96\tLeche',
  '5\t1\t1\t1\t1\t2\t12\t0\t10\t10\t94\t1,20',
  '5\t1\t1\t1\t2\t1\t0\t14\t10\t10\t90\tTOTAL',
  '5\t1\t1\t1\t2\t2\t12\t14\t10\t10\t92\t1,20',
].join('\n');

test('Tesseract TSV preserves line order and bounds confidence',()=>{
  assert.deepEqual(parseTesseractTsv(tsv),{
    text:'Leche 1,20\nTOTAL 1,20',
    confidence:.93,
  });
  assert.throws(()=>parseTesseractTsv('level\ttext\n'),(error:unknown)=>error instanceof OcrError&&error.code==='OCR_NO_TEXT_DETECTED');
});

test('local OCR uses fixed Spanish single-thread arguments and validated image bytes',async()=>{
  let request:OcrProcessRequest|undefined;
  const provider=new TesseractCliOcrProvider({
    runner:async input=>{request=input;return {stdout:tsv,stderr:''}},
  });
  const bytes=Uint8Array.from([0x89,0x50,0x4e,0x47]);
  const result=await provider.recognize({mimeType:'image/png',bytes,fileName:'ignored.png'});
  assert.deepEqual(result,{text:'Leche 1,20\nTOTAL 1,20',confidence:.93,source:'local-tesseract'});
  assert.equal(request?.command,'tesseract');
  assert.deepEqual(request?.args,[
    'stdin','stdout','--oem','1','--psm','6','--dpi','300','-l','spa','-c','preserve_interword_spaces=1','tsv',
  ]);
  assert.equal(request?.input,bytes);
  assert.equal(request?.timeoutMs,20_000);
  assert.equal(request?.maxOutputBytes,500_000);
  provider.dispose();
});

test('local OCR rejects unsupported inputs before starting a process',async()=>{
  let calls=0;
  const provider=new TesseractCliOcrProvider({runner:async()=>{calls+=1;return {stdout:tsv,stderr:''}}});
  await assert.rejects(()=>provider.recognize({mimeType:'application/pdf',bytes:new Uint8Array()}),(error:unknown)=>error instanceof OcrError&&error.code==='OCR_LOCAL_PDF_UNSUPPORTED');
  await assert.rejects(()=>provider.recognize({mimeType:'text/plain',bytes:new Uint8Array()}),(error:unknown)=>error instanceof OcrError&&error.code==='OCR_INPUT_UNSUPPORTED');
  assert.equal(calls,0);
});

test('bounded OCR process enforces timeout, abort and output caps',async()=>{
  await assert.rejects(()=>runTesseractProcess({
    command:'node',
    args:['-e','setTimeout(()=>{},10000)'],
    input:new Uint8Array(),
    timeoutMs:25,
    maxOutputBytes:1024,
  }),(error:unknown)=>error instanceof OcrError&&error.code==='OCR_LOCAL_TIMEOUT');

  await assert.rejects(()=>runTesseractProcess({
    command:'node',
    args:['-e',"process.stdout.write('x'.repeat(10000))"],
    input:new Uint8Array(),
    timeoutMs:1000,
    maxOutputBytes:32,
  }),(error:unknown)=>error instanceof OcrError&&error.code==='OCR_LOCAL_OUTPUT_LIMIT');

  const controller=new AbortController();
  controller.abort();
  await assert.rejects(()=>runTesseractProcess({
    command:'node',
    args:['-e','setTimeout(()=>{},10000)'],
    input:new Uint8Array(),
    timeoutMs:1000,
    maxOutputBytes:1024,
    signal:controller.signal,
  }),{name:'AbortError'});
});
