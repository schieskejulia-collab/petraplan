const AUTH_ORIGIN = 'https://yxhllviostywckxoehgf.supabase.co';

/** Only parse a user-pasted unused email challenge; never follow its redirect. */
export function emailVerification(input: string, email: string):
  {type:'email';email:string;token:string} | {type:'email';token_hash:string} {
  const value=input.trim();
  if (/^\d{6,10}$/.test(value)) {
    const normalized=email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    return {type:'email',email:normalized,token:value};
  }
  let url: URL;
  try { url=new URL(value); } catch { throw new Error('Bitte den Code oder den vollständigen Anmeldelink aus der E-Mail einfügen.'); }
  if (url.origin!==AUTH_ORIGIN || url.pathname!=='/auth/v1/verify' || url.username || url.password || url.hash
    || url.searchParams.getAll('type').length!==1 || !['email','magiclink'].includes(url.searchParams.get('type')??'')) {
    throw new Error('Dieser Link ist kein Anmeldelink für PetraPlan.');
  }
  const hashes=[...url.searchParams.getAll('token'),...url.searchParams.getAll('token_hash')];
  if (hashes.length!==1 || !/^[A-Za-z0-9_-]{16,256}$/.test(hashes[0])) throw new Error('Der Anmeldelink enthält keinen eindeutigen gültigen Prüfcode.');
  return {type:'email',token_hash:hashes[0]};
}
