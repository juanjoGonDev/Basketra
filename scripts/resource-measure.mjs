import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { BasketraServer } from '../dist/api/server.js';

const root=mkdtempSync(join(tmpdir(),'basketra-resource-'));
const config={host:'127.0.0.1',port:0,dataDir:join(root,'data'),tempDir:join(root,'tmp'),maxBodyBytes:1024*1024,aiTimeoutMs:1000,aiMaxRetries:0,idleHibernateAfterMs:20,idleExitAfterMs:0};
const before=performance.now();
const server=new BasketraServer(config);
await server.listen();
const startupMs=performance.now()-before;
const base=`http://127.0.0.1:${server.address().port}`;
await fetch(`${base}/health`);
const idle=process.memoryUsage();
for(let index=0;index<25;index+=1)await fetch(`${base}/api/v1/shopping-lists`);
for(let index=0;index<10;index+=1){
  const body={importKey:`resource-receipt-${index}`,originalText:'Milk',declaredTotalMinor:120,items:[{description:'Milk',quantity:1,unitPriceMinor:120,lineTotalMinor:120}]};
  const response=await fetch(`${base}/api/v1/receipts/confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`Representative receipt request failed: ${response.status}`);
}
const active=process.memoryUsage();
const cpuBefore=process.cpuUsage();
const idleStart=performance.now();
await new Promise(resolve=>setTimeout(resolve,2000));
const idleWallMs=performance.now()-idleStart;
const cpuDelta=process.cpuUsage(cpuBefore);
const idleCpuPercent=((cpuDelta.user+cpuDelta.system)/(idleWallMs*1000))*100;
const returnedToIdle=process.memoryUsage();
const sqliteBytes=statSync(join(root,'data','basketra.db')).size;
const threadCount=readdirSync('/proc/self/task').length;
const shutdownStart=performance.now();
await server.close();
const shutdownMs=performance.now()-shutdownStart;
console.log(JSON.stringify({startupMs,shutdownMs,idleRssBytes:idle.rss,activeRssBytes:active.rss,returnedToIdleRssBytes:returnedToIdle.rss,heapUsedBytes:active.heapUsed,sqliteBytes,idleCpuPercent,primaryProcessCount:1,threadCount,hibernated:server.diagnostics().hibernated},null,2));
rmSync(root,{recursive:true,force:true});
