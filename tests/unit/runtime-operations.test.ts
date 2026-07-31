import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { ApplicationLogStore, sanitizeClientLog } from '../../src/operations/log-store.ts';
import { applyPendingRestore, importBackup, stagePendingRestore } from '../../src/operations/restore.ts';
import { nextPatchVersion, resolveRuntimeVersion } from '../../src/operations/version.ts';

function temporaryDirectory(label: string): string {
  return `.test-tmp/${label}-${randomUUID()}`;
}

test('runtime versions are validated and releases increment only the patch component',()=>{
  assert.deepEqual(resolveRuntimeVersion({ BASKETRA_VERSION:'1.2.3',BASKETRA_REVISION:'abcdef1234567' }),{
    version:'1.2.3',
    revision:'abcdef1234567',
  });
  assert.deepEqual(resolveRuntimeVersion({ BASKETRA_VERSION:'not-semver',BASKETRA_REVISION:'unsafe revision' }),{
    version:'0.0.0-dev',
  });
  assert.equal(nextPatchVersion(undefined),'1.0.0');
  assert.equal(nextPatchVersion('v1.0.0'),'1.0.1');
  assert.equal(nextPatchVersion('2.7.19'),'2.7.20');
  assert.throws(()=>nextPatchVersion('2.7.19-beta'),/stable semantic version/);
});

test('client logs accept only bounded allowlisted metadata',()=>{
  const sanitized=sanitizeClientLog({
    event:'client.api_error',
    level:'error',
    method:'POST',
    path:'/api/v1/receipts/extract',
    status:503,
    durationMs:25,
    code:'AI_NOT_CONFIGURED',
    requestId:'12345678-abcd-1234-abcd-1234567890ab',
    message:'receipt content must never be stored',
    apiKey:'secret',
  },'2026-07-31T12:00:00.000Z');
  assert.deepEqual(sanitized,{
    timestamp:'2026-07-31T12:00:00.000Z',
    level:'error',
    source:'client',
    event:'client.api_error',
    requestId:'12345678-abcd-1234-abcd-1234567890ab',
    method:'POST',
    path:'/api/v1/receipts/extract',
    status:503,
    durationMs:25,
    code:'AI_NOT_CONFIGURED',
  });
  assert.equal(sanitizeClientLog({event:'receipt.raw_text',message:'private'},'2026-07-31T12:00:00.000Z'),undefined);
  assert.equal(sanitizeClientLog({event:'client.api_error',path:'/api?token=secret'},'2026-07-31T12:00:00.000Z')?.path,undefined);
});

test('application logs rotate by line budget and preserve a bounded chronological tail',()=>{
  const directory=temporaryDirectory('logs');
  try{
    const store=new ApplicationLogStore(directory,{maxLines:2,maxBytes:4096,maxFiles:3,clock:()=>new Date('2026-07-31T12:00:00.000Z')});
    store.append({source:'server',level:'info',event:'server.started'});
    store.append({source:'client',level:'warn',event:'client.connection_lost'});
    store.append({source:'client',level:'info',event:'client.connection_restored'});
    assert.equal(existsSync(join(directory,'logs','application.1.ndjson')),true);
    assert.deepEqual(store.tail(10).map(event=>event.event),[
      'server.started',
      'client.connection_lost',
      'client.connection_restored',
    ]);
    assert.deepEqual(store.tail(1,'client').map(event=>event.event),['client.connection_restored']);
  }finally{
    rmSync(directory,{recursive:true,force:true});
  }
});

test('validated imported backups are applied only through an explicit pending restore',()=>{
  const directory=temporaryDirectory('restore');
  try{
    const databasePath=join(directory,'basketra.db');
    const sourcePath=join(directory,'source.db');
    const database=new BasketraDatabase(databasePath);
    database.createShoppingList('Before backup');
    database.backup(sourcePath);
    database.createShoppingList('After backup');
    database.close();

    const imported=importBackup(directory,{
      originalName:'portable.db',
      base64:Buffer.from(readFileSync(sourcePath)).toString('base64'),
    },8*1024*1024);
    assert.equal(imported.schemaVersion,3);
    assert.throws(()=>stagePendingRestore(directory,{
      importedName:imported.name,
      preRestoreBackupName:'pre.db',
      confirmation:'NO',
    }),/RESTORE_CONFIRMATION_REQUIRED/);

    stagePendingRestore(directory,{
      importedName:imported.name,
      preRestoreBackupName:'pre.db',
      confirmation:'RESTAURAR',
      now:new Date('2026-07-31T12:00:00.000Z'),
    });
    assert.deepEqual(applyPendingRestore(directory),{status:'applied',importedName:imported.name});
    assert.deepEqual(applyPendingRestore(directory),{status:'none'});

    const restored=new BasketraDatabase(databasePath);
    assert.deepEqual(restored.listShoppingLists().map(list=>list.name),['Before backup']);
    restored.close();
  }finally{
    rmSync(directory,{recursive:true,force:true});
  }
});
