const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  const recordId = String(req.query?.recordId ?? '');
  if (!UUID_RE.test(recordId)) return res.status(400).send('Ungültige Record-ID');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>PetraPlan · kontrollierter Widerrufs-Test</title>
<style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff}
  body{margin:0;padding:24px 18px 48px}
  main{max-width:680px;margin:0 auto}
  .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#6b7280;font-weight:700}
  h1{font-size:30px;line-height:1.1;margin:10px 0 14px}
  p{font-size:16px;line-height:1.5;color:#374151}
  .card{border:1px solid #e5e7eb;border-radius:20px;padding:18px;margin-top:18px;box-shadow:0 2px 10px rgba(0,0,0,.05)}
  .warning{background:#fff8e7}
  button,a.btn{display:block;width:100%;box-sizing:border-box;margin-top:14px;border:1px solid #d1d5db;border-radius:16px;background:#fff;padding:16px;font-size:17px;font-weight:700;text-align:center;color:#111;text-decoration:none}
  button:disabled{opacity:.45}
  pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border-radius:14px;padding:14px;font-size:12px;line-height:1.45;max-height:360px;overflow:auto}
  .ok{font-weight:800;color:#166534}.err{font-weight:800;color:#991b1b}
</style>
</head>
<body>
<main>
  <div class="eyebrow">PetraPlan · kontrollierter Test</div>
  <h1>Post-Release Widerruf prüfen</h1>
  <p>Dieser Test verändert weder Source noch Snapshot, Candidates, Representation Evidence oder Review. Er erzeugt ausschließlich eine absichtlich spätere negative Validation. Der Widerruf muss anschließend aus der normalen Release-Gate-Logik entstehen.</p>

  <div class="card warning">
    <strong>Testfall</strong>
    <p style="margin-bottom:0"><code>${recordId}</code></p>
  </div>

  <div class="card">
    <strong>Erwartete Kette</strong>
    <p>FREIGEGEBEN → spätere Validation FEHLGESCHLAGEN → Release-Gate → WIDERRUFEN</p>
    <button id="run">Kontrollierten Negativtest auslösen</button>
    <p id="status"></p>
    <pre id="result" hidden></pre>
    <a class="btn" id="back" href="/bridge/${recordId}" style="display:none">Zurück zu A-10266</a>
  </div>
</main>
<script>
function findAccessToken(){
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i)||'';
    if(!key.includes('auth-token')) continue;
    try{
      const parsed=JSON.parse(localStorage.getItem(key)||'null');
      const token=parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
      if(token) return token;
    }catch{}
  }
  return '';
}

const button=document.getElementById('run');
const status=document.getElementById('status');
const result=document.getElementById('result');
const back=document.getElementById('back');
button.addEventListener('click', async()=>{
  const token=findAccessToken();
  if(!token){
    status.className='err';
    status.textContent='Keine aktive PetraPlan-Sitzung gefunden. Bitte den Fall erneut über den Magic Link öffnen und diese Seite danach noch einmal aufrufen.';
    return;
  }
  button.disabled=true;
  status.className='';
  status.textContent='Test läuft …';
  result.hidden=true;
  back.style.display='none';
  try{
    const response=await fetch('/api/cases/${recordId}/test-negative-validation',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({reason:'Kontrollierter Nachweis: spätere negative Validation nach bestehender Freigabe für A-10266.'})
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(String(body.error||('HTTP '+response.status)));
    status.className='ok';
    status.textContent='Test ausgelöst. Die negative Validation wurde erzeugt und die Release-Gate-Reconciliation ausgeführt.';
    result.textContent=JSON.stringify({validation_id:body.validation_id,validation_created_at:body.validation_created_at,release_reconciliation:body.release_reconciliation},null,2);
    result.hidden=false;
    back.style.display='block';
  }catch(error){
    status.className='err';
    status.textContent=error instanceof Error ? error.message : 'Test fehlgeschlagen.';
  }finally{
    button.disabled=false;
  }
});
</script>
</body>
</html>`);
}
