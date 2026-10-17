import {useEffect,useState} from 'react';
import {bridgeAuth,bridgeAuthRedirectUrl} from '@/lib/bridge-auth';
import {emailVerification} from '@/lib/bridge-email-verification';

export function BridgeSignIn() {
 const [email,setEmail]=useState(''),[challenge,setChallenge]=useState(''),[message,setMessage]=useState('');
 const [busy,setBusy]=useState(false),[authenticated,setAuthenticated]=useState<boolean|null>(null);
 useEffect(()=>{
  let active=true;
  const {data:listener}=bridgeAuth.auth.onAuthStateChange((_event,session)=>{if(active)setAuthenticated(Boolean(session));});
  void bridgeAuth.auth.getSession().then(({data})=>{if(active)setAuthenticated(Boolean(data.session));});
  return()=>{active=false;listener.subscription.unsubscribe();};
 },[]);
 const send=async()=>{
  setBusy(true);setMessage('');
  try {
   const {error}=await bridgeAuth.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:bridgeAuthRedirectUrl()}});
   if(error)throw error;
   setMessage('E-Mail angefordert. Enthält sie einen Code, gib ihn unten ein. Enthält sie einen Anmeldelink, halte ihn gedrückt, kopiere ihn und füge ihn unten ein.');
  }catch(err){setMessage(err instanceof Error?err.message:'Die Anmelde-E-Mail konnte nicht angefordert werden.');}
  finally{setBusy(false);}
 };
 const verify=async()=>{
  setBusy(true);setMessage('');
  try {
   const payload=emailVerification(challenge,email);
   setChallenge('');
   const {data,error}=await bridgeAuth.auth.verifyOtp(payload);
   if(error || !data.session)throw new Error('Anmeldung nicht bestätigt. Fordere eine neue E-Mail an, falls Code oder Link bereits verwendet oder abgelaufen ist.');
   setMessage('Angemeldet. Die Fälle werden neu geladen.');
  }catch(err){setMessage(err instanceof Error?err.message:'Anmeldung konnte nicht bestätigt werden.');}
  finally{setBusy(false);}
 };
 if(authenticated!==false)return null;
 return <section className="rounded-xl border p-4 space-y-3">
  <h2 className="font-semibold">Auf dieser Seite anmelden</h2>
  <p className="text-sm">Die Vorschau hat eine eigene Anmeldung. Verwende den Code oder kopiere den noch nicht geöffneten Anmeldelink aus deiner E-Mail hierher. Du bleibst auf dieser Seite.</p>
  <form onSubmit={e=>{e.preventDefault();void send();}} className="space-y-2">
   <label className="block text-sm">E-Mail-Adresse<input required type="email" autoComplete="email" disabled={busy} className="block w-full rounded border p-2" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <button type="submit" disabled={busy} className="rounded border p-2">Anmelde-E-Mail anfordern</button>
  </form>
  <form onSubmit={e=>{e.preventDefault();void verify();}} className="space-y-2">
   <label className="block text-sm">Code oder kopierter Anmeldelink<input required type="password" autoComplete="off" spellCheck={false} disabled={busy} className="block w-full rounded border p-2" value={challenge} onChange={e=>setChallenge(e.target.value)}/></label>
   <button type="submit" disabled={busy||!challenge.trim()} className="rounded border p-2">Auf dieser Seite anmelden</button>
  </form>
  {message&&<p role="status" className="text-sm">{message}</p>}
 </section>;
}
