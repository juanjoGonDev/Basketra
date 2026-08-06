import { spawnSync } from 'node:child_process';
const commands=[
  ['node',['scripts/format-check.mjs']],
  ['node',['scripts/lint.mjs']],
  ['tsc',['--noEmit']],
  ['node',['scripts/deadcode.mjs']],
  ['node',['scripts/deps-check.mjs']],
  ['node',['--experimental-strip-types','--test','tests/unit/*.test.ts']],
  ['node',['--experimental-strip-types','--test','tests/integration/*.test.ts']],
  ['node',['--experimental-strip-types','--test','tests/e2e/*.test.ts']],
  ['node',['--experimental-strip-types','--experimental-test-coverage',"--test-coverage-include=src/domain/*.ts",'--test-coverage-lines=100','--test-coverage-functions=100','--test-coverage-branches=100','--test','tests/unit/*.test.ts']],
  ['node',['--experimental-strip-types','--experimental-test-coverage',"--test-coverage-include=src/ai/provider.ts","--test-coverage-include=src/ai/structured-executor.ts","--test-coverage-include=src/api/errors.ts","--test-coverage-include=src/receipts/service.ts","--test-coverage-include=src/operations/gateway.ts",'--test-coverage-lines=100','--test-coverage-functions=100','--test-coverage-branches=100','--test','--test-concurrency=1','tests/unit/*.test.ts','tests/integration/*.test.ts','tests/e2e/*.test.ts']],
  ['node',['--experimental-strip-types','--experimental-test-coverage',"--test-coverage-include=src/web/receipt-ai-recovery.js",'--test-coverage-lines=100','--test-coverage-functions=100','--test-coverage-branches=100','--test','tests/unit/receipt-ai-recovery.test.ts']],
  ['node',['scripts/build.mjs']],
];
for(const [command,args] of commands){console.log(`\n> ${command} ${args.join(' ')}`);const result=spawnSync(command,args,{stdio:'inherit',shell:false});if(result.status!==0)process.exit(result.status??1)}
console.log('\nQuality gate passed.');
