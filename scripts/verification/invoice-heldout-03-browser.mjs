// Read-only rendering probe for traces produced by the frozen foreign-input run.
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PETRAPLAN_PLAYWRIGHT_MODULE);
const {default:serverChromium}=await import(process.env.PETRAPLAN_CHROMIUM_MODULE);
const directory=resolve(process.env.PETRAPLAN_HELDOUT_OUTPUT??'../heldout-03/results');
const load=async file=>JSON.parse(await readFile(resolve(directory,file),'utf8'));
const browser=await chromium.launch({executablePath:await serverChromium.executablePath(),args:serverChromium.args});
const report=[];
try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('sb-yxhllviostywckxoehgf-auth-token',JSON.stringify({access_token:'heldout-browser-only',refresh_token:'local-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-4000-8000-000000000003'}})));
  let trace;
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
    if(u.pathname.endsWith('/decision'))return route.fulfill({json:{access:{role:'read-only-test',can_review:false,can_release:false,can_revoke:false,review_ready:false,review_rejection_ready:false,release_ready:false,review_blockers:[],unresolved_candidate_count:0,revoke_ready:false}}});
    if(u.pathname.startsWith('/api/cases/'))return route.fulfill({json:trace});
    const file=u.pathname.startsWith('/assets/')?'.'+u.pathname:'./index.html';
    return route.fulfill({path:new URL(file,new URL('../../frontend/mobile-app/dist/',import.meta.url)).pathname});
  });
  for(const [file,amount,status]of [
    ['0203-ubl.xml.trace-after.json','0 EUR','Freigegeben'],
    ['0301-uncefact.xml.trace-after.json','-225.14 EUR','Freigegeben'],
    ['cen-huf-cii.xml.trace-before.json','87859.00 HUF',null],
    ['facturx-invoice.pdf.trace-before.json','104.90 EUR',null],
    ['revision.trace.json','12829.69 EUR','Widerrufen'],
  ]){
    trace=await load(file);await page.goto('http://127.0.0.1:4173/cases/'+trace.id);
    const panel=page.getByRole('region',{name:'Rechnungsprüfung'});await panel.waitFor();
    await panel.getByText(amount,{exact:true}).first().waitFor();
    if(status)await panel.getByText(status,{exact:true}).first().waitFor();
    if(file.startsWith('facturx'))await panel.getByText('Sichtbarer Zahlbetrag nicht eindeutig lesbar.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Freigabe erteilen'}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    report.push({file,amount,status,passed:true});
  }
  assert.deepEqual(errors,[]);
}finally{
  await browser.close();
  await writeFile(resolve(directory,'browser.json'),JSON.stringify(report,null,2)+'\n');
}
console.log('Five mobile rendering probes passed; test session and recorded real local traces.');
