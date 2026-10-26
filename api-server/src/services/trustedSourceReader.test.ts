import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,request,type Server} from 'node:https';
import {fetchPinnedHttps,retrieveTrustedSource,isPublicEvidenceAddress,checkTrustedSourcePolicy,type TrustedEvidenceSource} from './trustedSourceReader.js';

const bytes=Buffer.from('Quantity is the recorded count. π\n');
const source:TrustedEvidenceSource={id:'registered-source',source_url:'https://evidence.example/spec/v1.txt',
 expected_sha256:createHash('sha256').update(bytes).digest('hex'),media_type:'text/plain',max_bytes:1024,version_reference:'document-v1'};
const origins=['https://evidence.example'];
const address={address:'93.184.216.34',family:4};
const transport=async()=>({bytes,mediaType:'text/plain',resolvedAddress:address.address,tlsPeerSha256:'a'.repeat(64)});

test('retrieval independently hashes exact bytes and binds one approved public address',async()=>{
 let lookups=0;
 const result=await retrieveTrustedSource(source,origins,{
  resolve:async()=>{lookups++;return[address];},
  transport:async(s,pinned)=>{assert.equal(s.source_url,source.source_url);assert.deepEqual(pinned,address);return transport();},
 });
 assert.equal(lookups,1);assert.equal(result.sha256,source.expected_sha256);assert.deepEqual(result.bytes,bytes);
 assert.ok(Number.isFinite(Date.parse(result.startedAt)));
});

test('unknown origins, credentials, literal IPs, non-HTTPS and changed ports are refused before DNS',()=>{
 for(const url of ['https://evidence.example.evil/spec','https://user:password@evidence.example/spec',
  'https://127.0.0.1/spec','https://[::1]/spec','http://evidence.example/spec',
  'https://evidence.example:8443/spec','https://evidence.example/spec#fragment'])
  assert.throws(()=>checkTrustedSourcePolicy({...source,source_url:url},origins));
 assert.throws(()=>checkTrustedSourcePolicy(source,[]));
});

test('private, link-local, translated and documentation addresses cannot be used for retrieval',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.2','169.254.169.254',
  '100.64.0.1','0.0.0.0','192.0.2.1','198.18.1.1','224.0.0.1','::1','::',
  '::ffff:127.0.0.1','fe80::1','fc00::1','64:ff9b::7f00:1','2002:7f00:1::','2001:db8::1','3fff::1'])
  assert.equal(isPublicEvidenceAddress(ip),false,ip);
 assert.equal(isPublicEvidenceAddress(address.address),true);
 assert.equal(isPublicEvidenceAddress('2606:4700:4700::1111'),true);
});

test('a mixed public/private DNS answer is refused without a network request',async()=>{
 let requested=false;
 await assert.rejects(retrieveTrustedSource(source,origins,{resolve:async()=>[address,{address:'127.0.0.1',family:4}],
  transport:async()=>{requested=true;return transport();}}),/public addresses/);
 assert.equal(requested,false);
});

test('changed bytes, mismatched content type, missing TLS evidence and malformed UTF-8 fail closed',async()=>{
 for(const change of [{bytes:Buffer.from('changed')},{mediaType:'application/json'},
  {tlsPeerSha256:''},{resolvedAddress:'127.0.0.1'},{bytes:Buffer.from([0xc3,0x28])}]) {
  await assert.rejects(retrieveTrustedSource(source,origins,{resolve:async()=>[address],transport:async()=>({...await transport(),...change})}));
 }
});

let server:Server,certificate:Buffer,path:string,port:number;
before(async()=>{
 path=await mkdtemp(join(tmpdir(),'petraplan-evidence-tls-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(path,'key.pem'),
  '-out',join(path,'cert.pem'),'-subj','/CN=evidence.example','-addext','subjectAltName=DNS:evidence.example','-days','1'],{stdio:'ignore'});
 certificate=await readFile(join(path,'cert.pem'));
 server=createServer({key:await readFile(join(path,'key.pem')),cert:certificate},(req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{Location:'https://127.0.0.1/private'});res.end();return;}
  if(req.url==='/encoded'){res.writeHead(200,{'Content-Type':'text/plain','Content-Encoding':'gzip'});res.end(bytes);return;}
  if(req.url==='/large'){res.writeHead(200,{'Content-Type':'text/plain','Content-Length':99999});res.end();return;}
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':bytes.length});res.end(bytes);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 port=(server.address() as {port:number}).port;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(path)await rm(path,{recursive:true,force:true});});
// Test-only CA and loopback address exercise the real TLS transport; production
// policy still refuses loopback DNS and non-443 URLs before invoking it.
const local=()=>({...source,source_url:`https://evidence.example:${port}/document`});
const withTestCA=((url:any,options:any,callback:any)=>request(url,{...options,ca:certificate},callback)) as typeof request;

test('real HTTPS transport validates the hostname/certificate and reads actual streamed bytes',async()=>{
 const result=await fetchPinnedHttps(local(),{address:'127.0.0.1',family:4},withTestCA);
 assert.deepEqual(result.bytes,bytes);assert.match(result.tlsPeerSha256,/^[a-f0-9]{64}$/);
});

test('real HTTPS transport refuses redirects, compression and oversized responses',async()=>{
 for(const route of ['/redirect','/encoded','/large'])
  await assert.rejects(fetchPinnedHttps({...local(),source_url:`https://evidence.example:${port}${route}`},{address:'127.0.0.1',family:4},withTestCA));
});

test('TLS is never disabled to accept an untrusted certificate or wrong hostname',async()=>{
 await assert.rejects(fetchPinnedHttps(local(),{address:'127.0.0.1',family:4}));
 await assert.rejects(fetchPinnedHttps({...local(),source_url:`https://wrong.example:${port}/document`},{address:'127.0.0.1',family:4},withTestCA));
});
