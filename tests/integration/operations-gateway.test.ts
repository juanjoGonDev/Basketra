import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppConfig } from '../../src/infrastructure/config.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { OperationsGateway } from '../../src/operations/gateway.ts';
import { applyPendingRestore } from '../../src/operations/restore.ts';

function config(dataDir:string,overrides:Partial<AppConfig>={}):AppConfig{
  return {
    host:'127.0.0.1',
    port:0,
    dataDir,
    tempDir:`${dataDir}/tmp`,
    maxBodyBytes:8*1024*1024,
    aiMaxRetries:0,
    aiImageCapability:true,
    aiPdfCapability:false,
    overpassBaseUrl:'http://127.0.0.1:9/api/',
    idleHibernateAfterMs:0,
    idleExitAfterMs:0,
    ...overrides,
  };
}

async function json(response:Response):Promise<Record<string,unknown>>{
  return await response.json() as Record<string,unknown>;
}

test('operations gateway distinguishes missing and loopback AI configuration',async()=>{
  const directory=`.test-tmp/gateway-ai-${randomUUID()}`;
  const previousContainer=process.env['BASKETRA_CONTAINER'];
  const credentialFixture=['test','credential'].join('-');
  process.env['BASKETRA_CONTAINER']='true';
  try{
    const missing=new OperationsGateway(config(directory));
    await missing.listen();
    let base=`http://127.0.0.1:${missing.address().port}`;
    const missingResponse=await fetch(`${base}/api/v1/settings/ai-provider`);
    assert.equal(missingResponse.status,200);
    assert.deepEqual(await json(missingResponse),{
      configured:false,
      status:'missing',
      missing:['BASKETRA_AI_BASE_URL','BASKETRA_AI_MODEL'],
      image:true,
      pdf:false,
      loopbackWarning:false,
      requiresContainerRecreate:true,
      recommendedHostUrl:'http://host.docker.internal:3001/v1/',
    });
    await missing.close();

    const loopback=new OperationsGateway(config(directory,{
      aiBaseUrl:'http://127.0.0.1:3001/v1/',
      aiModel:'default',
      aiApiKey:credentialFixture,
    }));
    await loopback.listen();
    base=`http://127.0.0.1:${loopback.address().port}`;
    const settings=await json(await fetch(`${base}/api/v1/settings/ai-provider`));
    assert.equal(settings['configured'],true);
    assert.equal(settings['loopbackWarning'],true);
    assert.equal(settings['apiKeyMask'],'***tial');
    assert.equal(JSON.stringify(settings).includes(credentialFixture),false);
    const testResponse=await fetch(`${base}/api/v1/settings/ai-provider/test`,{method:'POST'});
    assert.equal(testResponse.status,502);
    const connection=(await json(testResponse))['connection'] as Record<string,unknown>;
    assert.equal(connection['code'],'AI_LOOPBACK_CONTAINER');
    await loopback.close();
  }finally{
    if(previousContainer===undefined)delete process.env['BASKETRA_CONTAINER'];
    else process.env['BASKETRA_CONTAINER']=previousContainer;
    rmSync(directory,{recursive:true,force:true});
  }
});

test('operations gateway verifies image structured output through the canonical provider',async()=>{
  const directory=`.test-tmp/gateway-ai-probe-${randomUUID()}`;
  const requests:Array<Readonly<{method:string;url:string;authorization?:string;correlation?:string;body:Record<string,unknown>}>>=[];
  const providerServer=createServer(async(request,response)=>{
    const chunks:Uint8Array[]=[];
    for await(const chunk of request){
      chunks.push(typeof chunk==='string'?Buffer.from(chunk):chunk);
    }
    requests.push({
      method:request.method??'',
      url:request.url??'',
      ...(request.headers.authorization?{authorization:request.headers.authorization}:{}),
      ...(typeof request.headers['x-client-request-id']==='string'?{correlation:request.headers['x-client-request-id']}:{}),
      body:JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>,
    });
    response.writeHead(200,{'content-type':'application/json'});
    response.end(JSON.stringify({choices:[{message:{content:'{"accepted":true}'}}]}));
  });
  await new Promise<void>((resolve,reject)=>{
    providerServer.once('error',reject);
    providerServer.listen(0,'0.0.0',()=>{
      providerServer.off('error',reject);
      resolve();
    });
  });
  const providerPort=(providerServer.address() as AddressInfo).port;
  const managedToken=['managed','webapi','token'].join('-');
  const gateway=new OperationsGateway(config(directory,{
    aiBaseUrl:`http://127.0.0.2:${providerPort}/v1/`,
    aiModel:'gpt-5',
    aiApiKey:managedToken,
  }));
  try{
    await gateway.listen();
    const base=`http://127.0.0.1:${gateway.address().port}`;
    const response=await fetch(`${base}/api/v1/settings/ai-provider/test`,{method:'POST'});
    assert.equal(response.status,200);
    assert.deepEqual((await json(response))['connection'],{
      ok:true,
      model:'gpt-5',
      imageStructuredOutput:true,
    });
    assert.equal(requests.length,1);
    const providerRequest=requests[0];
    assert.ok(providerRequest);
    assert.equal(providerRequest.method,'POST');
    assert.equal(providerRequest.url,'/v1/chat/completions');
    assert.equal(providerRequest.authorization,`Bearer ${managedToken}`);
    assert.match(providerRequest.correlation??'',/^provider-probe:[0-9a-f-]{36}$/u);
    const messages=providerRequest.body['messages'] as Array<Record<string,unknown>>;
    const content=messages[1]?.['content'] as Array<Record<string,unknown>>;
    const imageUrl=(content[1]?.['image_url'] as Record<string,unknown>)['url'];
    assert.match(String(imageUrl),/^data:image\/png;base64,/u);
    const responseFormat=providerRequest.body['response_format'] as Record<string,unknown>;
    const schemaEnvelope=responseFormat['json_schema'] as Record<string,unknown>;
    assert.equal(responseFormat['type'],'json_schema');
    assert.equal(schemaEnvelope['strict'],true);
  }finally{
    await gateway.close();
    await new Promise<void>((resolve,reject)=>providerServer.close(error=>error?reject(error):resolve()));
    rmSync(directory,{recursive:true,force:true});
  }
});

test('operations gateway exposes redacted logs and downloadable portable backups',async()=>{
  const directory=`.test-tmp/gateway-backup-${randomUUID()}`;
  const gateway=new OperationsGateway(config(directory));
  try{
    await gateway.listen();
    const base=`http://127.0.0.1:${gateway.address().port}`;
    const logResponse=await fetch(`${base}/api/v1/logs/client`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({events:[{
        event:'client.api_error',
        level:'error',
        method:'POST',
        path:'/api/v1/receipts/extract',
        status:503,
        code:'AI_NOT_CONFIGURED',
        message:'private receipt text',
      }]}),
    });
    assert.equal(logResponse.status,202);
    const logs=await json(await fetch(`${base}/api/v1/logs?source=client&limit=10`));
    const serialized=JSON.stringify(logs);
    assert.match(serialized,/client\.api_error/);
    assert.equal(serialized.includes('private receipt text'),false);

    const name=`basketra-test-${Date.now()}.db`;
    const created=await fetch(`${base}/api/v1/backup`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({name}),
    });
    assert.equal(created.status,201);
    const download=await fetch(`${base}/api/v1/backups/${name}`);
    assert.equal(download.status,200);
    assert.equal(download.headers.get('content-type'),'application/vnd.sqlite3');
    assert.match(download.headers.get('content-disposition')??'',/attachment/);
    const bytes=new Uint8Array(await download.arrayBuffer());
    assert.ok(bytes.byteLength>0);

    const wrongType=await fetch(`${base}/api/v1/restore/import?name=${encodeURIComponent(name)}`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:bytes,
    });
    assert.equal(wrongType.status,415);
    assert.equal(((await json(wrongType))['error'] as Record<string,unknown>)['code'],'BACKUP_CONTENT_TYPE_INVALID');
  }finally{
    await gateway.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('restore is streamed, validated, staged with a pre-backup and applied only after shutdown',async()=>{
  const directory=`.test-tmp/gateway-restore-${randomUUID()}`;
  let restartRequested=false;
  const gateway=new OperationsGateway(config(directory),{requestRestart:()=>{restartRequested=true}});
  try{
    await gateway.listen();
    const base=`http://127.0.0.1:${gateway.address().port}`;
    const list=await fetch(`${base}/api/v1/shopping-lists`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({name:'Imported state'}),
    });
    assert.equal(list.status,201);
    const backupName='portable-source.db';
    assert.equal((await fetch(`${base}/api/v1/backup`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:backupName}),
    })).status,201);
    const backupBytes=new Uint8Array(await (await fetch(`${base}/api/v1/backups/${backupName}`)).arrayBuffer());
    assert.equal((await fetch(`${base}/api/v1/shopping-lists`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Must disappear'}),
    })).status,201);

    const importedResponse=await fetch(`${base}/api/v1/restore/import?name=${encodeURIComponent(backupName)}`,{
      method:'POST',
      headers:{'content-type':'application/vnd.sqlite3'},
      body:backupBytes,
    });
    assert.equal(importedResponse.status,201);
    const imported=await json(importedResponse);
    const importedName=(imported['backup'] as Record<string,unknown>)['name'];
    assert.equal(typeof importedName,'string');
    assert.equal((imported['backup'] as Record<string,unknown>)['bytes'],backupBytes.byteLength);

    const rejected=await fetch(`${base}/api/v1/restore/stage`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:importedName,confirmation:'NO'}),
    });
    assert.equal(rejected.status,409);
    const staged=await fetch(`${base}/api/v1/restore/stage`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:importedName,confirmation:'RESTAURAR'}),
    });
    assert.equal(staged.status,202);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(restartRequested,true);
  }finally{
    await gateway.close();
  }

  assert.equal((await applyPendingRestore(directory)).status,'applied');
  const restored=new BasketraDatabase(`${directory}/basketra.db`);
  try{
    assert.deepEqual(restored.listShoppingLists().map(list=>list.name),['Imported state']);
  }finally{
    restored.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
