import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import { Upload } from 'tus-js-client';
import sharp from 'sharp';
import { adminClient } from '../api/_ops.js';
import { issuePhotoLink } from '../api/_photos.js';
import photoHandler from '../api/v1/photos.js';
if (!process.argv.includes('--allow-test-fixtures')) {
  throw new Error('This rehearsal creates and cleans up a temporary event in the configured database. Run with --allow-test-fixtures to opt in.');
}
const client=adminClient();
const eventId=randomUUID(), companyId=randomUUID(), eventCompanyId=randomUUID(), fourballId=randomUUID(), secondId=randomUUID(), photoId=randomUUID();
async function result(query){const {data,error}=await query;if(error)throw new Error(error.message);return data;}
async function call(query={},body,token){
 if(process.env.PHOTO_PREVIEW_URL){
  const directory=await mkdtemp(join(tmpdir(),'m2m-photo-request-'));
  try {
   const headerFile=join(directory,'headers');const bodyFile=join(directory,'body');
   await writeFile(headerFile,`Content-Type: application/json\nX-Photo-Token: ${token}\n`,{mode:0o600});
   const args=['curl',`/api/v1/photos?${new URLSearchParams(query)}`,'--deployment',process.env.PHOTO_PREVIEW_URL,'--','--silent','--show-error','--header',`@${headerFile}`,'--write-out','\n%{http_code}'];
   if(body){await writeFile(bodyFile,JSON.stringify(body),{mode:0o600});args.push('--request','POST','--data-binary',`@${bodyFile}`);}
   const response=spawnSync('vercel',args,{encoding:'utf8',env:{...process.env,CI:'1'},timeout:120000});
   if(response.status!==0)throw new Error('Deployed preview request failed.');
   const end=response.stdout.lastIndexOf('\n');const status=Number(response.stdout.slice(end+1));
   let payload;try{payload=JSON.parse(response.stdout.slice(0,end));}catch{throw new Error(`Preview returned non-JSON (HTTP ${status}).`);}
   return {status,...payload};
  } finally {await rm(directory,{recursive:true,force:true});}
 }

 const req={method:body?'POST':'GET',query,body,headers:{'content-type':'application/json','x-photo-token':token}};
 const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},end(value){this.body=JSON.parse(value);}};
 await photoHandler(req,res);return {status:res.statusCode,...res.body};
}
async function moderate(status){await result(client.rpc('m2m_photo_moderate',{p_event:eventId,p_ids:[photoId],p_actor:null,p_status:status,p_fourballs:null}));}
try {
 await result(client.from('m2m_events').insert({id:eventId,name:'Temporary photo API test',slug:`temporary-photo-${eventId}`,status:'draft'}));
 await result(client.from('m2m_companies').insert({id:companyId,name:`Temporary photo API test ${eventId}`}));
 await result(client.from('m2m_event_companies').insert({id:eventCompanyId,event_id:eventId,company_id:companyId}));
 await result(client.from('m2m_fourballs').insert([{id:fourballId,event_id:eventId,event_company_id:eventCompanyId,team_name:'Temporary Fourball One'},{id:secondId,event_id:eventId,event_company_id:eventCompanyId,team_name:'Temporary Fourball Two'}]));
 const staff=await issuePhotoLink({eventId,kind:'staff',actorId:null,label:'Temporary test upload'});
 const gallery=await issuePhotoLink({eventId,fourballId,kind:'gallery',actorId:null,label:'Temporary gallery'});
 const gallery2=await issuePhotoLink({eventId,fourballId:secondId,kind:'gallery',actorId:null,label:'Temporary gallery two'});
 const staffToken=staff.path.split('#')[1], galleryToken=gallery.path.split('#')[1], secondToken=gallery2.path.split('#')[1];
 console.log('Temporary test event and links created; no user account created.');
 const bytes=await sharp({create:{width:1400,height:900,channels:3,background:'#194d39'}}).jpeg({quality:90}).toBuffer();
 let r=await call({}, {action:'reserve',batchId:randomUUID(),fourballIds:[fourballId,secondId],files:[{id:photoId,name:'Temporary test image.jpg',type:'image/jpeg',size:bytes.length}]},staffToken);assert.equal(r.status,200,JSON.stringify(r));
 r=await call({}, {action:'credentials',id:photoId},staffToken);assert.equal(r.status,200,JSON.stringify(r));
 await new Promise((resolve,reject)=>{new Upload(bytes,{endpoint:r.endpoint,chunkSize:6*1024*1024,headers:{'x-signature':r.token,apikey:r.publishableKey},metadata:{bucketName:'m2m-photo-staging',objectName:r.path,contentType:'image/jpeg',cacheControl:'0'},retryDelays:[0,1000,3000],onError:error=>reject(new Error(error.message)),onSuccess:resolve}).start();});
 console.log('Signed resumable storage upload passed.');
 r=await call({}, {action:'complete',id:photoId},staffToken);assert.equal(r.status,200,JSON.stringify(r));
 r=await call({}, {action:'complete',id:photoId},staffToken);assert.equal(r.complete,true);
 r=await call({view:'gallery',scope:'all'},null,galleryToken);assert.equal(r.photos.length,0,JSON.stringify(r));
 await moderate('approved');
 for(const token of [galleryToken,secondToken]){r=await call({view:'gallery',scope:'mine'},null,token);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.photos.length,1);assert.ok(r.photos[0].previewUrl);const preview=await fetch(r.photos[0].previewUrl);assert.equal(preview.status,200);}
 r=await call({view:'photo',id:photoId},null,galleryToken);assert.equal(r.status,200,JSON.stringify(r));const downloaded=await fetch(r.photo.downloadUrl);assert.equal(downloaded.status,200);assert.equal((await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata()).width,1400);
 console.log('Completion retry, approval, both fourball galleries, preview and full-size download passed.');
 const stored=await result(client.from('m2m_photos').select('original_path').eq('id',photoId).single());const direct=await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/m2m-photos/${stored.original_path}`);assert.notEqual(direct.status,200);
 await moderate('pending');r=await call({view:'photo',id:photoId},null,galleryToken);assert.equal(r.status,404);
 await result(client.from('m2m_photo_links').update({revoked_at:new Date().toISOString()}).eq('id',gallery2.id).eq('event_id',eventId));r=await call({view:'gallery'},null,secondToken);assert.equal(r.status,403);
 await result(client.from('m2m_photo_settings').update({uploads_enabled:false}).eq('event_id',eventId));r=await call({}, {action:'credentials',id:photoId},staffToken);assert.equal(r.status,403);
 console.log('Private storage, approval withdrawal, link revocation and upload pause passed.');
} finally {
 const rows=await result(client.from('m2m_photos').select('original_path,preview_path,staging_path').eq('event_id',eventId));
 const finalPaths=rows.flatMap(row=>[row.original_path,row.preview_path]).filter(Boolean);
 if(finalPaths.length)await result(client.storage.from('m2m-photos').remove(finalPaths));
 await result(client.storage.from('m2m-photo-staging').remove([`${eventId}/${photoId}`]));
 for(const table of ['m2m_photo_fourballs','m2m_photos','m2m_photo_batches','m2m_photo_links','m2m_photo_settings','m2m_audit_events','m2m_fourballs','m2m_event_companies'])await result(client.from(table).delete().eq('event_id',eventId));
 await result(client.from('m2m_events').delete().eq('id',eventId));
 await result(client.from('m2m_companies').delete().eq('id',companyId));
 const remaining=await result(client.from('m2m_events').select('id').eq('id',eventId));assert.equal(remaining.length,0);
 console.log('Cleanup verified: temporary event, companies, fourballs, links, audit records and stored images removed.');
}
