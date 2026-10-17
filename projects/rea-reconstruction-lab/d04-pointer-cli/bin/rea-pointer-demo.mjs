#!/usr/bin/env node
import { outcome } from '../src/pointer.mjs';

const MAX_LINE_BYTES=32768;
const strictUtf8=new TextDecoder('utf-8',{fatal:true});
const MAX_TOTAL_BYTES=1048576;
const MAX_ROWS=1000;
const help='rea-pointer-demo 0.6.0: usage: rea-pointer-demo --jsonl < input.ndjson';
if (process.argv.includes('--help') || !process.argv.includes('--jsonl')) {
  console.log(help);
  if (!process.argv.includes('--help')) process.exitCode=2;
} else {
  let bytes=0, rows=0, pending=Buffer.alloc(0), stopped=false;
  const reject=(message)=>{
    console.log(JSON.stringify({outcome:'error',name:'RangeError',message}));
    process.exitCode=1;
    stopped=true;
  };
  const handleLine=(line)=>{
    if (line.at(-1)===13) line=line.subarray(0,line.length-1); // CRLF
    if (!line.length) return;
    if (line.length>MAX_LINE_BYTES) return reject('Input line exceeds '+MAX_LINE_BYTES+' bytes.');
    if (++rows>MAX_ROWS) return reject('Input exceeds '+MAX_ROWS+' rows.');
    try {
      let decoded;
      try { decoded=strictUtf8.decode(line); }
      catch { throw new SyntaxError('Invalid UTF-8 input.'); }
      const row=JSON.parse(decoded);
      if (row===null || typeof row!=='object' || Array.isArray(row))
        throw new TypeError('Input record must be an object.');
      console.log(JSON.stringify(outcome(row)));
    } catch (error) {
      console.log(JSON.stringify({outcome:'error',name:error.name,message:error.message}));
      process.exitCode=1;
    }
  };
  // Read bounded chunks; never materialize the entire stdin in memory.
  for await (const chunk of process.stdin) {
    bytes+=chunk.length;
    if (bytes>MAX_TOTAL_BYTES) {reject('Input exceeds '+MAX_TOTAL_BYTES+' bytes.');break;}
    let start=0;
    while (!stopped && start<chunk.length) {
      const newline=chunk.indexOf(10,start);
      const end=newline<0?chunk.length:newline;
      const fragment=chunk.subarray(start,end);
      if (pending.length+fragment.length>MAX_LINE_BYTES+1) {reject('Input line exceeds '+MAX_LINE_BYTES+' bytes.');break;}
      pending=Buffer.concat([pending,fragment]);
      if (newline<0) break;
      handleLine(pending);
      pending=Buffer.alloc(0);
      start=newline+1;
    }
    if (stopped) break;
  }
  if (!stopped && pending.length) handleLine(pending);
}
