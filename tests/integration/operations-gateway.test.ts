import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
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
    aiTimeoutMs:1000,
    aiMaxRetries:0,
    aiImageCapability:true,
    aiPdfCapability:false,
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
      aiApiKey:'secret-value',
    }));
    await loopback.listen();
    base=`http://127.0.0.1:${loopback.address().port}`;
    const settings=await json(await fetch(`${base}/api/v1/settings/ai-provider`));
    assert.equal(settings['configured'],true);
    assert.equal(settings['loopbackWarning'],true);
    assert.equal(settings['apiKeyMask'],'***alue');
    assert.equal(JSON.stringify(settings).includes('secret-value'),false);
    const testResponse=await fetch(`${base}/api/v1/settings/ai-provider/test`,{method:'POST'});
    assert.equal(testResponse.status,502);
    assert.equal((await json(testResponse))['connection'] instanceof Object,true);
    await loopback.close();
  }finally{
    if(previousContainer===undefined)delete process.env['BASKETRA_CONTAINER'];
    else process.env['BASKETRA_CONTAINER']=previousContainer;
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
  }finally{
    await gateway.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('restore is validated, staged with a pre-backup and applied only after shutdown',async()=>{
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

    const imported=await json(await fetch(`${base}/api/v1/restore/import`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({name:backupName,base64:Buffer.from(backupBytes).toString('base64')}),
    }));
    const importedName=(imported['backup'] as Record<string,unknown>)['name'];
    assert.equal(typeof importedName,'string');
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

  assert.equal(applyPendingRestore(directory).status,'applied');
  const restored=new BasketraDatabase(`${directory}/basketra.db`);
  try{
    assert.deepEqual(restored.listShoppingLists().map(list=>list.name),['Imported state']);
  }finally{
    restored.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
