"""Real KoSIT/handler/UI/SQL pilot; local test identities only."""
import os,json,subprocess,select,time,base64
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
def main():
 env={**os.environ,'PETRAPLAN_BROWSER_FIXTURE':'1','PETRAPLAN_BROWSER_DUPLICATE_ENFORCEMENT':'1'}
 process=subprocess.Popen(['node','tests/browser/invoice-harness.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,text=True)
 checks=[]
 def check(name,value):
  checks.append({'name':name,'passed':bool(value)});assert value,name;print('PASS: '+name,flush=True)
 try:
  deadline=time.monotonic()+60;config=None
  while time.monotonic()<deadline:
   if process.poll() is not None:raise RuntimeError('Harness stopped')
   if select.select([process.stdout],[],[],1)[0]:
    try:
     data=json.loads(process.stdout.readline())
     if 'origin' in data:config=data;break
    except json.JSONDecodeError:pass
  if not config:raise RuntimeError('Readiness timeout')
  xml=(Path(os.environ['PETRAPLAN_INVOICE_FIXTURES'])/'01.01a.xml').read_text()
  start=xml.index('<cac:AccountingCustomerParty>');pos=xml.index('<cac:PartyLegalEntity>',start)
  xml=xml[:pos]+'''<cac:PartyTaxScheme><cbc:CompanyID>DE987654321</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>'''+xml[pos:]
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=os.environ.get('PETRAPLAN_CHROMIUM_PATH'))
   errors=[]
   def page_for(token,actor):
    page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True);page.set_default_timeout(30000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(config['origin']+'/') else route.abort())
    session={'access_token':token,'refresh_token':'local-only','expires_at':int(time.time())+3600,'user':{'id':actor}}
    page.add_init_script("localStorage.setItem('sb-yxhllviostywckxoehgf-auth-token',"+json.dumps(json.dumps(session))+")")
    return page
   page=page_for(config['token'],config['actorId']);second=page_for(config['approverToken'],config['approverId'])
   headers={'Authorization':'Bearer '+config['token']}
   def trace(record):
    r=page.request.get(config['origin']+'/api/cases/'+record,headers=headers);assert r.status==200,r.text();return r.json()
   def upload():
    page.goto(config['origin']+'/cases');page.locator('input[type="file"]').set_input_files({'name':'controlled-complete.xml','mimeType':'application/xml','buffer':xml.encode()})
    with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/invoice-upload'),timeout=120000) as pending:
     page.get_by_role('button',name='Datei prüfen und speichern',exact=True).click()
    r=pending.value;assert r.status==201,r.text();return r.json()['record_id']
   def adjudicate(current,button):
    panel=current.get_by_role('region',name='Verbindliche Dublettenentscheidung')
    panel.get_by_label('Beleg der Dublettenprüfung',exact=True).fill('Isolated browser supporting evidence')
    panel.get_by_label('Begründung der Dublettenentscheidung',exact=True).fill('Explicit fixture determination after inspecting current invoice evidence')
    with current.expect_response(lambda r:r.request.method=='POST' and '/invoice-duplicate-decision?' in r.url) as pending:
     panel.get_by_role('button',name=button,exact=True).click()
    assert pending.value.status==201,pending.value.text()
   def release(current):
    panel=current.get_by_role('region',name='Rechnungsprüfung')
    panel.get_by_label('Begründung',exact=True).fill('Separate explicit browser release')
    with current.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/decision')) as pending:
     panel.get_by_role('button',name='Freigabe erteilen',exact=True).click()
    assert pending.value.status==200,pending.value.text()
   original=upload();state=trace(original);check('KoSIT accepts controlled complete-party fixture',state['invoice']['snapshots'][0]['proof']['accepted'])
   panel=page.get_by_role('region',name='Rechnungsprüfung')
   for label in ('Original geprüft','Zuordnung geprüft','Offene Punkte geklärt'):panel.get_by_label(label,exact=True).check()
   panel.get_by_label('Begründung',exact=True).fill('Explicit independent source review')
   period=panel.get_by_label('Beleg zum Liefer- oder Leistungszeitraum (BR-DE-TMP-32)',exact=True)
   if period.count():period.fill('Controlled source service period 2016-01-01 to 2016-12-31')
   with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/decision')):panel.get_by_role('button',name='Review bestätigen',exact=True).click()
   check('source review cannot bypass missing duplicate clearance',page.get_by_role('button',name='Freigabe erteilen',exact=True).count()==0 and len(trace(original)['release']['certificates'])==0)
   adjudicate(page,'Prüfung ohne Verdacht bestätigen');check('duplicate clearance itself issues no certificate',len(trace(original)['release']['certificates'])==0)
   release(page);check('separate release binds duplicate decision',trace(original)['release']['effective_status']=='trusted' and bool(trace(original)['release']['certificates'][0]['truth_snapshot']['invoice_duplicate_decision_id']))
   copy=upload();check('new case invalidates prior displayed release',trace(original)['release']['effective_status']=='blocked')
   adjudicate(page,'Als Doppelrechnung sperren');check('copy remains without certificate',len(trace(copy)['release']['certificates'])==0)
   second.goto(config['origin']+'/cases/'+original)
   adjudicate(second,'Referenzfassung bei gesperrten Kopien bestätigen')
   pane=second.get_by_role('region',name='Verbindliche Dublettenentscheidung')
   pane.get_by_label('Begründung der Dublettenentscheidung',exact=True).fill('Explicit revocation of superseded comparison basis')
   with second.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/decision')) as pending:
    pane.get_by_role('button',name='Frühere Freigabe widerrufen',exact=True).click()
   assert pending.value.status==200,pending.value.text()
   release(second);state=trace(original)
   check('independent primary release creates new certificate and retains revoked history',state['release']['effective_status']=='trusted' and len(state['release']['certificates'])==2 and any(x['new_status']=='revoked' for x in state['release']['status_history']))
   page.goto(config['origin']+'/cases/'+copy);adjudicate(page,'Zur Klärung sperren')
   check('changed blocked-copy decision invalidates primary release',trace(original)['release']['effective_status']=='blocked')
   check('mobile decision panel fits viewport',second.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   check('no JavaScript errors',not errors)
   browser.close()
 finally:
  process.terminate()
  try:process.wait(timeout=15)
  except subprocess.TimeoutExpired:process.kill();process.wait()
  out=Path(os.environ.get('PETRAPLAN_DUPLICATE_BROWSER_OUTPUT','/tmp/invoice-duplicate-enforcement.json'));out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps({'scope':'local-test-auth-real-KoSIT-handlers-PGlite','checks':checks},indent=2)+'\n')
if __name__=='__main__':main()
