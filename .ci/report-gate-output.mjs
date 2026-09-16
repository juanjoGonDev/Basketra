import { readFileSync } from 'node:fs';

// TEMPORARY diagnostic reporter (removed before delivery).
// Publishes the aggregate browser coverage gate output as a check-run annotation, because job logs
// and artifacts cannot be downloaded from the diagnosis environment.
const [reportPath, label = 'browser coverage gate'] = process.argv.slice(2);
const text = readFileSync(reportPath, 'utf8');
const slice = text.slice(0, 6000)
  .replaceAll('%', '%25')
  .replaceAll('\r', '%0D')
  .replaceAll('\n', '%0A');
const level = /coverage failed|Error|no coverage record|No Chromium coverage/iu.test(text) ? 'error' : 'notice';
process.stdout.write(`::${level} title=${label}::${slice}\n`);
