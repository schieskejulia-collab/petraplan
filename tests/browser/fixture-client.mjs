// Isolated PGlite query adapter. This is not Supabase Auth/PostgREST.
export async function fixtureClient(db, actorId, token) {
  const known = new Set((await db.query("select tablename from pg_tables where schemaname='public'")).rows.map(r=>r.tablename));
  const identifier = value => {
    if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error('Unsupported fixture identifier');
    return value;
  };
  const client = {
    auth:{getUser:async supplied=>({data:{user:supplied===token?{id:actorId}:null},error:null})},
    async rpc(name,args) {
      if (!/^bridge_[a-z_]+$/.test(name)) throw new Error('Unsupported fixture RPC');
      try {
        const values=Object.entries(args).map(([key,value])=>
          ['p_invoice','p_report','p_pdf'].includes(key) && typeof value==='string' && value.startsWith('\\x')
            ? Buffer.from(value.slice(2),'hex') : value);
        return {data:(await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) value`,values)).rows[0].value,error:null};
      } catch(error) {console.error('Fixture RPC failed',name,error.message);return {data:null,error};}
    },
    from(table) {
      identifier(table);
      const where=[],params=[];
      let order='',single=false,range=null;
      const query={
        select(){return query;},
        eq(column,value){params.push(value);where.push(`${identifier(column)}=$${params.length}`);return query;},
        in(column,values){
          if(!values.length)where.push('false');
          else where.push(`${identifier(column)} in (${values.map(v=>{params.push(v);return '$'+params.length;}).join(',')})`);
          return query;
        },
        order(column,options){order=` order by ${identifier(column)} ${options?.ascending===false?'desc':'asc'}`;return query;},
        maybeSingle(){single=true;return query;},
        range(first,last){range=[first,last];return query;},
        then(resolve,reject){
          return (async()=>{
            let rows=[];
            if(known.has(table)) {
              const select=table==='bridge_invoice_evidence'
                ? `select e.snapshot_id,e.validation_id,e.created_at,jsonb_build_object('source_hash',i.source_hash,'extracted_schema',i.extracted_schema) ingestion
                   from bridge_invoice_evidence e join ingestion_logs i on i.id=e.snapshot_id`
                : `select * from ${table}`;
              rows=(await db.query(select+(where.length?' where '+where.join(' and '):'')
                +(table==='bridge_invoice_evidence'?order.replace('created_at','e.created_at'):order),params)).rows;
            }
            if(table==='review_criterion_results')for(const row of rows)
              row.review_criteria=(await db.query('select * from review_criteria where id=$1',[row.criterion_id])).rows[0];
            const count=rows.length;
            if(range)rows=rows.slice(range[0],range[1]+1);
            rows=JSON.parse(JSON.stringify(rows));
            return {data:single?rows[0]??null:rows,count,error:null};
          })().then(resolve,reject);
        },
      };
      return query;
    },
  };
  return client;
}
