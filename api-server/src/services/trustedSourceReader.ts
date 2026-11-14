import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';

export type TrustedEvidenceSource = {
  id: string;
  source_url: string;
  expected_sha256: string;
  media_type: string;
  max_bytes: number;
  version_reference: string;
};
export type ResolvedEvidenceAddress = { address: string; family: number };
export type RetrievedEvidence = {
  bytes: Buffer;
  mediaType: string;
  resolvedAddress: string;
  tlsPeerSha256: string;
};

const MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_TYPES = new Set(['text/plain','text/markdown','application/json','application/xml','text/xml']);
const blocked4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
] as const) blocked4.addSubnet(network,prefix,'ipv4');
const global6 = new BlockList();global6.addSubnet('2000::',3,'ipv6');
const blocked6 = new BlockList();
for (const [network,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)
  blocked6.addSubnet(network,prefix,'ipv6');

export function isPublicEvidenceAddress(address: string): boolean {
  const family=isIP(address);
  return family===4 ? !blocked4.check(address,'ipv4')
    : family===6 && global6.check(address,'ipv6') && !blocked6.check(address,'ipv6');
}

/** Administrator-pinned URL and independent server origin configuration are both
 * required. No request body can introduce a URL, digest, resolver or credentials. */
export function checkTrustedSourcePolicy(source: TrustedEvidenceSource, allowedOrigins: string[]): URL {
  const url=new URL(source.source_url);
  if(url.protocol!=='https:' || url.username || url.password || url.hash
    || (url.port && url.port!=='443') || isIP(url.hostname.replace(/^\[|\]$/g,''))
    || !allowedOrigins.includes(url.origin)) throw new Error('Source origin is not explicitly trusted');
  if(!/^[a-f0-9]{64}$/.test(source.expected_sha256) || !source.version_reference?.trim()
    || !MEDIA_TYPES.has(source.media_type) || !Number.isSafeInteger(source.max_bytes)
    || source.max_bytes<1 || source.max_bytes>MAX_BYTES) throw new Error('Trusted source policy is incomplete');
  return url;
}

/** One HTTPS GET, one pinned public address, normal TLS hostname verification,
 * no redirects, cookies, authorization, compression or shared connection pool. */
export function fetchPinnedHttps(
  source: TrustedEvidenceSource,
  address: ResolvedEvidenceAddress,
  httpsRequest: typeof request = request,
): Promise<RetrievedEvidence> {
  const url=new URL(source.source_url);
  return new Promise((resolve,reject)=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10_000);
    const finish=(error:Error|null,value?:RetrievedEvidence)=>{
      clearTimeout(timer);
      if(error) reject(error); else resolve(value!);
    };
    const req=httpsRequest(url,{
      method:'GET',agent:false,rejectUnauthorized:true,servername:url.hostname,
      signal:controller.signal,family:address.family,
      lookup:((_host:unknown,options:any,callback:any)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)) as any,
      headers:{Accept:source.media_type,'Accept-Encoding':'identity','User-Agent':'PetraPlan-Evidence-Reader/1'},
    },res=>{
      const fail=(message:string)=>{res.destroy();req.destroy();finish(new Error(message));};
      if(res.statusCode!==200) {fail('Evidence source did not return HTTP 200; redirects are not followed');return;}
      const mediaType=String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase();
      if(mediaType!==source.media_type || !['','identity'].includes(String(res.headers['content-encoding']??''))) {
        fail('Evidence content type or encoding does not match its trusted policy');return;
      }
      const socket=res.socket as TLSSocket;
      const fingerprint=socket.getPeerCertificate?.()?.fingerprint256?.replaceAll(':','').toLowerCase()??'';
      if(!socket.authorized || !/^[0-9a-f]{64}$/.test(fingerprint)
        || socket.remoteAddress!==address.address) {fail('Evidence TLS peer or pinned address could not be verified');return;}
      const declaredLength=res.headers['content-length'];
      if(declaredLength!==undefined && (!/^\d+$/.test(String(declaredLength)) || Number(declaredLength)>source.max_bytes)) {
        fail('Evidence response exceeds its configured size limit');return;
      }
      const parts:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>source.max_bytes)fail('Evidence response exceeds its configured size limit');else parts.push(chunk);});
      res.on('error',error=>finish(error));
      res.on('aborted',()=>finish(new Error('Evidence response was truncated')));
      res.on('end',()=>{
        if(!res.complete || (declaredLength!==undefined && size!==Number(declaredLength))) {
          finish(new Error('Evidence response was truncated'));return;
        }
        finish(null,{bytes:Buffer.concat(parts),mediaType,resolvedAddress:address.address,tlsPeerSha256:fingerprint});
      });
    });
    req.on('error',error=>finish(error));req.end();
  });
}

export async function retrieveTrustedSource(
  source: TrustedEvidenceSource,
  allowedOrigins: string[],
  dependencies={
    resolve:async(host:string):Promise<ResolvedEvidenceAddress[]>=>lookup(host,{all:true,verbatim:true}),
    transport:fetchPinnedHttps,
  },
) {
  const url=checkTrustedSourcePolicy(source,allowedOrigins);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const addresses=await Promise.race([
    dependencies.resolve(url.hostname),
    new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Evidence DNS lookup timed out')),5000);}),
  ]).finally(()=>{if(timer)clearTimeout(timer);});
  if(!addresses.length || addresses.some(item=>![4,6].includes(item.family)
      || isIP(item.address)!==item.family || !isPublicEvidenceAddress(item.address)))
    throw new Error('Evidence DNS must resolve exclusively to public addresses');
  const startedAt=new Date().toISOString();
  const document=await dependencies.transport(source,addresses[0]);
  if(document.bytes.length<1 || document.bytes.length>source.max_bytes || document.mediaType!==source.media_type
    || document.resolvedAddress!==addresses[0].address || !/^[a-f0-9]{64}$/.test(document.tlsPeerSha256))
    throw new Error('Evidence transport result does not match the pinned source');
  // Fatal decoding prevents silently replacing malformed bytes in later anchors.
  new TextDecoder('utf-8',{fatal:true}).decode(document.bytes);
  const digest=createHash('sha256').update(document.bytes).digest('hex');
  if(digest!==source.expected_sha256) throw new Error('Retrieved evidence digest does not match its registered source version');
  return {...document,sha256:digest,startedAt};
}
