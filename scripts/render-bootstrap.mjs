import fs from 'node:fs';

const [privateKeyFile, targetFile, deployerFile, outputFile] = process.argv.slice(2);
if (!privateKeyFile || !targetFile || !deployerFile || !outputFile) {
  throw new Error('Usage: render-bootstrap <private-key-der-b64-file> <target> <deployer> <output>');
}

const privateKeyB64 = fs.readFileSync(privateKeyFile, 'utf8').trim();
const targetSource = fs.readFileSync(targetFile, 'utf8');
const deployerSource = fs.readFileSync(deployerFile, 'utf8');
const expiresAt = Math.floor(Date.now() / 1000) + 20 * 60;

const source = `
const PRIVATE_KEY_B64=${JSON.stringify(privateKeyB64)};
const INITIAL_TARGET=${JSON.stringify(targetSource)};
const DEPLOYER_SOURCE=${JSON.stringify(deployerSource)};
const EXPIRES_AT=${expiresAt};
const API='https://api.cloudflare.com/client/v4';
const TARGET_SCRIPT='watermark-toolkit';
const DEPLOYER_SCRIPT='watermark-toolkit-deployer';

function b64urlBytes(value){const s=value.replace(/-/g,'+').replace(/_/g,'/');const p=s+'='.repeat((4-s.length%4)%4);const raw=atob(p);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function b64Bytes(value){const raw=atob(value);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function decryptPayload(value){
  const key=await crypto.subtle.importKey('pkcs8',b64Bytes(PRIVATE_KEY_B64),{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'RSA-OAEP'},key,b64urlBytes(value));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function requestJson(url,options,token,soft=false){
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...(options?.headers||{})}});
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success===false){
    if(soft)return null;
    const msg=body?.errors?.map(e=>e.message).filter(Boolean).join('; ')||('HTTP '+response.status);
    throw new Error(msg);
  }
  return body;
}
function accountIdsFromTokenDetails(details){
  const out=new Set();
  for(const policy of details?.result?.policies||[]){
    for(const key of Object.keys(policy.resources||{})){
      const match=key.match(/com\\.cloudflare\\.api\\.account\\.([0-9a-f]{32})/i);
      if(match)out.add(match[1]);
    }
  }
  return [...out];
}
async function discoverAccounts(token,verify){
  const ids=[];
  const details=await requestJson(API+'/user/tokens/'+verify.result.id,{method:'GET'},token,true);
  ids.push(...accountIdsFromTokenDetails(details));
  const accounts=await requestJson(API+'/accounts?per_page=50',{method:'GET'},token,true);
  for(const a of accounts?.result||[])if(a?.id)ids.push(a.id);
  const memberships=await requestJson(API+'/memberships?per_page=50&status=accepted',{method:'GET'},token,true);
  for(const m of memberships?.result||[])if(m?.account?.id)ids.push(m.account.id);
  return [...new Set(ids)];
}
async function uploadModule(accountId,token,name,source,bindings=[]){
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-08-25',bindings})],{type:'application/json'}),'metadata.json');
  form.append('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  await requestJson(API+'/accounts/'+accountId+'/workers/scripts/'+name,{method:'PUT',body:form},token);
  await requestJson(API+'/accounts/'+accountId+'/workers/scripts/'+name+'/subdomain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,previews_enabled:false})},token);
}
async function getOrCreateSubdomain(accountId,token){
  const current=await requestJson(API+'/accounts/'+accountId+'/workers/subdomain',{method:'GET'},token,true);
  if(current?.result?.subdomain)return current.result.subdomain;
  const wanted='watermark-toolkit-'+accountId.slice(-8).toLowerCase();
  const created=await requestJson(API+'/accounts/'+accountId+'/workers/subdomain',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({subdomain:wanted})},token);
  return created.result.subdomain;
}
async function bootstrap(token){
  const verify=await requestJson(API+'/user/tokens/verify',{method:'GET'},token);
  if(verify?.result?.status!=='active')throw new Error('Cloudflare API token is not active');
  const accountIds=await discoverAccounts(token,verify);
  if(!accountIds.length)throw new Error('Could not discover a Cloudflare account from this token');
  let lastError=null;
  for(const accountId of accountIds){
    try{
      const subdomain=await getOrCreateSubdomain(accountId,token);
      await uploadModule(accountId,token,DEPLOYER_SCRIPT,DEPLOYER_SOURCE,[{type:'plain_text',name:'CF_ACCOUNT_ID',text:accountId}]);
      await requestJson(API+'/accounts/'+accountId+'/workers/scripts/'+DEPLOYER_SCRIPT+'/secrets',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'CF_API_TOKEN',text:token,type:'secret_text'})},token);
      await uploadModule(accountId,token,TARGET_SCRIPT,INITIAL_TARGET,[]);
      return {ok:true,account_id:accountId,worker_url:'https://'+TARGET_SCRIPT+'.'+subdomain+'.workers.dev',deployer_url:'https://'+DEPLOYER_SCRIPT+'.'+subdomain+'.workers.dev'};
    }catch(error){lastError=error;}
  }
  throw lastError||new Error('No usable Cloudflare account found');
}
export default {async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({ok:true,expires_at:EXPIRES_AT});
  if(url.pathname!=='/bootstrap'||request.method!=='POST')return new Response('Not Found',{status:404});
  try{
    if(Math.floor(Date.now()/1000)>EXPIRES_AT)throw new Error('Bootstrap expired');
    const encrypted=(await request.text()).trim();
    if(!encrypted||encrypted.length>1024)throw new Error('Invalid encrypted payload');
    const payload=await decryptPayload(encrypted);
    if(typeof payload.token!=='string'||payload.token.length<40)throw new Error('Invalid token payload');
    if(typeof payload.exp!=='number'||payload.exp<Math.floor(Date.now()/1000)||payload.exp>EXPIRES_AT)throw new Error('Expired payload');
    return Response.json(await bootstrap(payload.token));
  }catch(error){console.error(error);return Response.json({ok:false,error:String(error?.message||error)},{status:400});}
}};
`;

fs.writeFileSync(outputFile, source);
console.log(`Rendered bootstrap Worker (${Buffer.byteLength(source)} bytes), expires ${new Date(expiresAt * 1000).toISOString()}.`);
