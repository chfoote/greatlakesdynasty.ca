// Smoke-test built lazy routes with a fresh browser profile and no outbound
// connections. No login, account changes, or Supabase reads/writes are performed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { existsSync } from 'node:fs';
const run=promisify(execFile);
const chrome=process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if(!existsSync(chrome)) throw Error('Set CHROME_PATH to an installed Chrome/Chromium browser.');
const root=resolve('dist');
let requested=[];
let denySignIn=false;
const server=createServer(async (request,response)=>{
  response.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:");
  const path=new URL(request.url,'http://localhost').pathname;
  requested.push(path);
  if(denySignIn && /\/SignIn-/.test(path)) {response.writeHead(404).end();return;}
  const file=resolve(root,'.'+path);
  if(file!==root && !file.startsWith(root+'/')) {response.writeHead(400).end();return;}
  try {
    const content=await readFile(extname(path)?file:join(root,'index.html'));
    response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'})[extname(path)] || 'text/html');
    response.end(content);
  } catch {response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  for(const scenario of [{path:'/signin'},{path:'/record-book'},{path:'/admin/teams'},{path:'/signin',failedDownload:true}]) {
    const path=scenario.path; denySignIn=Boolean(scenario.failedDownload);
    const profile=await mkdtemp(join(tmpdir(),'gld-route-browser-'));
    requested=[];
    try {
      const {stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-sync','--disable-background-networking',
        `--user-data-dir=${profile}`,'--virtual-time-budget=5000','--dump-dom',`http://127.0.0.1:${server.address().port}${path}`],{timeout:20000,maxBuffer:2000000});
      if(scenario.failedDownload) {
        assert.ok(stdout.includes('Refresh page') && stdout.includes('role="alert"'),'Failed page download did not show a recoverable error.');
        assert.ok(requested.filter(file=>/\/SignIn-/.test(file)).length<=1,'Failed page download retried automatically.');
        console.log('PASS: failed lazy page download shows an explicit refresh action without automatic retry loops.');
        continue;
      }
      assert.ok(stdout.includes('Sign In') && stdout.includes('type="email"'),`Sign-in form missing on ${path}`);
      assert.ok(!requested.some(file=>/\/(?:TeamAdmin|RecordBook|Calendar|LineChart)-/.test(file)),`Unneeded page chunk loaded on ${path}`);
      console.log(`PASS: ${path} renders sign-in/keeps access protection without downloading protected pages or chart/calendar screens.`);
    } finally {await rm(profile,{recursive:true,force:true}).catch(()=>{});}
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
