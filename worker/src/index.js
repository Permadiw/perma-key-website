const H = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
const FREE = 21600, LIMIT = 5;
const TASKS = [
  ["subscribe","Subscribe to the channel","Visit the YouTube channel","https://www.youtube.com/channel/UCiSTRqsRTp0Lem3_qxYQIwA",15],
  ["like","Like the video","Open and like the video","https://youtu.be/JcgUyeInJpw",15],
  ["watch","Watch the video","Watch the designated video","https://youtu.be/JcgUyeInJpw",30],
  ["comment","Leave a comment","Leave a relevant comment","https://youtu.be/JcgUyeInJpw",15]
];

function res(d,s=200){return new Response(JSON.stringify(d),{status:s,headers:H})}
function err(c,m,s=400){return res({success:false,code:c,message:m},s)}
function now(){return Math.floor(Date.now()/1000)}
function str(v,n=200){return String(v??"").trim().slice(0,n)}
function norm(v){return str(v,200).toUpperCase()}
function body(req){return req.json().catch(()=>({}))}
async function hash(v){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function part(){
  const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",b=crypto.getRandomValues(new Uint8Array(5));
  return [...b].map(x=>c[x%c.length]).join("");
}
function gen(t){return `PDS-${t==="PREMIUM"?"PRO":"FREE"}-${part()}-${part()}-${part()}`}
function admin(r,e){
  const t=String(e.ADMIN_TOKEN||"");
  return t.length>=16&&r.headers.get("Authorization")===`Bearer ${t}`;
}
function raw(b,u){return u.searchParams.get("key")||u.searchParams.get("licenseKey")||u.searchParams.get("license_key")||b.key||b.licenseKey||b.license_key||""}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS keys(
    key_hash TEXT PRIMARY KEY,key_type TEXT NOT NULL CHECK(key_type IN('FREE','PREMIUM')),
    status TEXT NOT NULL DEFAULT 'UNUSED' CHECK(status IN('UNUSED','ACTIVE','REVOKED')),
    created_at INTEGER NOT NULL,activated_at INTEGER,expires_at INTEGER,note TEXT,last_used_at INTEGER
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT,url TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 15,active INTEGER NOT NULL DEFAULT 1
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS task_submissions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,user_ref TEXT,proof TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',created_at INTEGER NOT NULL,reviewed_at INTEGER,review_note TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits(
    id INTEGER PRIMARY KEY AUTOINCREMENT,ip_hash TEXT NOT NULL,created_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,detail TEXT,created_at INTEGER NOT NULL
  )`).run();
  for(const t of TASKS) await db.prepare(`INSERT OR IGNORE INTO tasks
    (id,title,description,url,duration_seconds,active) VALUES(?,?,?,?,?,1)`).bind(...t).run();
}
async function audit(db,type,detail=""){
  try{await db.prepare("INSERT INTO audit_events(event_type,detail,created_at) VALUES(?,?,?)")
    .bind(str(type,100),str(detail,1000),now()).run()}catch(e){console.error("Audit:",e.message)}
}
async function getKey(db,key){
  key=norm(key);if(!key)return null;
  return db.prepare("SELECT * FROM keys WHERE key_hash=?").bind(await hash(key)).first();
}
async function create(db,type,note="",activeFree=false){
  type=str(type).toUpperCase();
  if(!["FREE","PREMIUM"].includes(type))throw Error("TYPE_MUST_BE_FREE_OR_PREMIUM");
  const key=gen(type),h=await hash(key),t=now();
  const status=type==="FREE"&&activeFree?"ACTIVE":"UNUSED";
  const activated=status==="ACTIVE"?t:null;
  const expiry=status==="ACTIVE"&&type==="FREE"?t+FREE:null;
  await db.prepare(`INSERT INTO keys(key_hash,key_type,status,created_at,activated_at,expires_at,note)
    VALUES(?,?,?,?,?,?,?)`).bind(h,type,status,t,activated,expiry,str(note)).run();
  await audit(db,"KEY_CREATED",`${type}; ${status}`);
  return {key,key_type:type,type,status,created_at:t,activated_at:activated,expires_at:expiry,note:str(note)};
}
async function validate(db,key){
  key=norm(key);
  if(!key)return {success:true,valid:false,isValid:false,code:"KEY_REQUIRED",message:"Please provide a key."};
  const h=await hash(key);
  let r=await db.prepare("SELECT * FROM keys WHERE key_hash=?").bind(h).first();
  if(!r)return {success:true,valid:false,isValid:false,code:"INVALID_KEY",message:"Key not found."};
  const invalid=(code,message)=>({success:true,valid:false,isValid:false,code,message,type:r.key_type,key_type:r.key_type,status:r.status,expires_at:r.expires_at});
  if(r.status==="REVOKED")return invalid("REVOKED","This key has been revoked.");
  if(r.key_type==="FREE"&&r.status==="UNUSED"){
    const t=now();
    await db.prepare(`UPDATE keys SET status='ACTIVE',activated_at=?,expires_at=?,last_used_at=?
      WHERE key_hash=? AND status='UNUSED'`).bind(t,t+FREE,t,h).run();
    r=await db.prepare("SELECT * FROM keys WHERE key_hash=?").bind(h).first();
    if(!r)return invalid("INVALID_KEY","Key not found.");
  }
  if(r.key_type==="PREMIUM"&&r.status!=="ACTIVE")return invalid("NOT_ACTIVATED","Premium key has not been activated by an admin.");
  if(r.status!=="ACTIVE")return invalid("INACTIVE","This key is not active.");
  const t=now();
  if(r.key_type==="FREE"&&(r.expires_at==null||!Number.isSafeInteger(Number(r.expires_at))||Number(r.expires_at)<=t))
    return invalid("EXPIRED","Free key has expired or has no valid expiry.");
  await db.prepare("UPDATE keys SET last_used_at=? WHERE key_hash=? AND status='ACTIVE'").bind(t,h).run();
  return {success:true,valid:true,isValid:true,code:"VALID",message:"Key is valid.",type:r.key_type,key_type:r.key_type,status:r.status,activated_at:r.activated_at,expires_at:r.key_type==="PREMIUM"?null:r.expires_at};
}
async function rate(req,db){
  const ip=await hash(req.headers.get("CF-Connecting-IP")||"unknown"),t=now();
  await db.prepare("DELETE FROM rate_limits WHERE created_at<?").bind(t-3600).run();
  const c=await db.prepare("SELECT COUNT(*) total FROM rate_limits WHERE ip_hash=? AND created_at>=?").bind(ip,t-3600).first();
  if(Number(c?.total||0)>=LIMIT)return false;
  await db.prepare("INSERT INTO rate_limits(ip_hash,created_at) VALUES(?,?)").bind(ip,t).run();
  return true;
}

async function handle(req,env){
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(!env.DB)return err("CONFIG_ERROR","D1 binding DB is missing.",500);
  if(!env.ADMIN_TOKEN)return err("CONFIG_ERROR","ADMIN_TOKEN secret is missing.",500);
  const u=new URL(req.url),p=u.pathname.replace(/\/+$/,"")||"/",m=req.method.toUpperCase(),db=env.DB;
  await schema(db);

  if(p==="/health"&&m==="GET")return res({success:true,service:"PERMA KEY API",status:"online",time:new Date().toISOString()});

  if(p==="/tasks/list"&&m==="GET"){
    const r=await db.prepare("SELECT id,title,description,url,duration_seconds FROM tasks WHERE active=1 ORDER BY rowid").all();
    return res({success:true,tasks:r.results||[]});
  }

  if(p==="/public/get-key"&&m==="POST"){
    if(!await rate(req,db))return err("RATE_LIMITED","Free Key limit reached. Try again later.",429);
    return res({success:true,code:"KEY_CREATED",message:"Free Key created. Six hours start at first validation.",...await create(db,"FREE","Public Free Key")});
  }

  if(p==="/validate"&&(m==="GET"||m==="POST")){
    const b=m==="POST"?await body(req):{};
    return res(await validate(db,raw(b,u)));
  }

  if(p==="/activate"&&m==="POST"){
    const b=await body(req),key=raw(b,u),r=await getKey(db,key);
    if(!r)return err("INVALID_KEY","Key not found.",404);
    if(r.key_type==="PREMIUM")return err("ADMIN_REQUIRED","Premium keys must be activated by an admin.",403);
    return res(await validate(db,key));
  }

  if(p==="/tasks/submit"&&m==="POST"){
    const b=await body(req),id=str(b.task_id||b.taskId,100);
    if(!id)return err("TASK_REQUIRED","task_id is required.");
    const task=await db.prepare("SELECT id FROM tasks WHERE id=? AND active=1").bind(id).first();
    if(!task)return err("TASK_NOT_FOUND","Task not found.",404);
    const r=await db.prepare(`INSERT INTO task_submissions(task_id,user_ref,proof,status,created_at)
      VALUES(?,?,?,'PENDING',?)`).bind(id,str(b.user_ref||b.user,200),str(b.proof,2000),now()).run();
    return res({success:true,code:"SUBMISSION_RECEIVED",message:"Submission received for review.",submission_id:r.meta?.last_row_id??null});
  }

  const paths=["/admin/list","/admin/create","/admin/activate","/admin/revoke","/admin/tasks","/admin/tasks/create","/admin/tasks/review","/admin/events"];
  if(paths.includes(p)&&!admin(req,env))return err("UNAUTHORIZED","Admin authorization required.",401);

  if(p==="/admin/list"&&m==="GET"){
    const r=await db.prepare(`SELECT key_hash,key_type,status,created_at,activated_at,expires_at,note,last_used_at FROM keys ORDER BY created_at DESC`).all();
    return res({success:true,count:r.results?.length||0,keys:r.results||[]});
  }

  if(p==="/admin/create"&&m==="POST"){
    const b=await body(req),type=str(b.type||b.key_type||"FREE").toUpperCase();
    if(!["FREE","PREMIUM"].includes(type))return err("INVALID_TYPE","type must be FREE or PREMIUM.");
    return res({success:true,code:"KEY_CREATED",message:`${type} key created.`,...await create(db,type,b.note||"",type==="FREE")});
  }

  if(p==="/admin/activate"&&m==="POST"){
    const b=await body(req),r=await getKey(db,raw(b,u));
    if(!r)return err("INVALID_KEY","Key not found.",404);
    if(r.status==="REVOKED")return err("REVOKED","Revoked keys cannot be activated.",409);
    const t=now(),expiry=r.key_type==="FREE"?t+FREE:null;
    await db.prepare(`UPDATE keys SET status='ACTIVE',activated_at=?,expires_at=? WHERE key_hash=? AND status!='REVOKED'`).bind(t,expiry,r.key_hash).run();
    await audit(db,"KEY_ACTIVATED",r.key_type);
    return res({success:true,code:"KEY_ACTIVATED",key_type:r.key_type,status:"ACTIVE",activated_at:t,expires_at:expiry});
  }

  if(p==="/admin/revoke"&&m==="POST"){
    const b=await body(req),r=await getKey(db,raw(b,u));
    if(!r)return err("INVALID_KEY","Key not found.",404);
    await db.prepare("UPDATE keys SET status='REVOKED' WHERE key_hash=?").bind(r.key_hash).run();
    await audit(db,"KEY_REVOKED",r.key_type);
    return res({success:true,code:"KEY_REVOKED",key_type:r.key_type,status:"REVOKED"});
  }

  if(p==="/admin/tasks"&&m==="GET"){
    const [t,s]=await Promise.all([
      db.prepare("SELECT * FROM tasks ORDER BY rowid").all(),
      db.prepare("SELECT * FROM task_submissions ORDER BY created_at DESC LIMIT 100").all()
    ]);
    return res({success:true,tasks:t.results||[],submissions:s.results||[]});
  }

  if(p==="/admin/tasks/create"&&m==="POST"){
    const b=await body(req),id=str(b.id||b.task_id,100),title=str(b.title,200);
    if(!id||!title)return err("FIELDS_REQUIRED","id and title are required.");
    const duration=Number(b.duration_seconds??15);
    if(!Number.isSafeInteger(duration)||duration<0)return err("INVALID_DURATION","duration_seconds must be a non-negative integer.");
    await db.prepare(`INSERT INTO tasks(id,title,description,url,duration_seconds,active) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,url=excluded.url,duration_seconds=excluded.duration_seconds,active=excluded.active`)
      .bind(id,title,str(b.description,1000),str(b.url,2000),duration,b.active===false||b.active===0?0:1).run();
    await audit(db,"TASK_SAVED",id);
    return res({success:true,code:"TASK_SAVED",id});
  }

  if(p==="/admin/tasks/review"&&m==="POST"){
    const b=await body(req),id=Number(b.id||b.submission_id),status=str(b.status||b.decision).toUpperCase();
    if(!Number.isSafeInteger(id)||id<=0)return err("INVALID_ID","A valid submission id is required.");
    if(!["APPROVED","REJECTED"].includes(status))return err("INVALID_STATUS","status must be APPROVED or REJECTED.");
    const r=await db.prepare("UPDATE task_submissions SET status=?,reviewed_at=?,review_note=? WHERE id=?")
      .bind(status,now(),str(b.note,1000),id).run();
    if(!r.meta?.changes)return err("SUBMISSION_NOT_FOUND","Submission not found.",404);
    await audit(db,"TASK_REVIEWED",`${id}:${status}`);
    return res({success:true,code:"TASK_REVIEWED",submission_id:id,status});
  }

  if(p==="/admin/events"&&m==="GET"){
    const r=await db.prepare("SELECT id,event_type,detail,created_at FROM audit_events ORDER BY created_at DESC LIMIT 200").all();
    return res({success:true,events:r.results||[]});
  }

  return err("NOT_FOUND","Endpoint not found.",404);
}

export default {
  async fetch(request,env){
    try{return await handle(request,env)}
    catch(e){
      console.error("PERMA KEY API error:",e?.message||e);
      return err("INTERNAL_ERROR","PERMA KEY API encountered an internal error.",500);
    }
  }
};
