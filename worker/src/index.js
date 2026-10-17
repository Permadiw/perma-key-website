const H = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
const FREE = 21600, LIMIT = 5;
const TASKS = [
  ["subscribe_channel","SUBSCRIBE TO THE PERMA DIW STUDIO YOUTUBE CHANNEL","Open the official PERMA DIW STUDIO channel, subscribe if you choose to, then return and confirm honestly. This site cannot independently verify a subscription without YouTube account authorization.","https://www.youtube.com/channel/UCiSTRqsRTp0Lem3_qxYQIwA",30],
  ["like_video","LIKE A PERMA DIW STUDIO YOUTUBE VIDEO","Open a video published by PERMA DIW STUDIO and like it if you choose to. Return and confirm honestly; a timer alone cannot prove a like.","https://www.youtube.com/channel/UCiSTRqsRTp0Lem3_qxYQIwA/videos",30],
  ["comment_video","COMMENT ON A PERMA DIW STUDIO YOUTUBE VIDEO","Open a PERMA DIW STUDIO video and leave a relevant comment if you choose to. Do not post spam. Return and confirm honestly; this site does not automatically verify comments.","https://www.youtube.com/channel/UCiSTRqsRTp0Lem3_qxYQIwA/videos",30],
  ["watch_video","WATCH A PERMA DIW STUDIO YOUTUBE VIDEO FOR AT LEAST 1 MINUTE","Open a PERMA DIW STUDIO video, watch at least one minute, then return to this page.","https://www.youtube.com/channel/UCiSTRqsRTp0Lem3_qxYQIwA/videos",60],
  ["discord_join","JOIN THE PERMA DIW STUDIO DISCORD","Open the official Discord invite and join the server, then return here.","https://discord.gg/PvKTnGnJs",30]
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

async function ensureColumn(db,table,column,definition){
  const info=await db.prepare(`PRAGMA table_info(${table})`).all();
  if(!(info.results||[]).some(c=>c.name===column)){
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS keys(
    key_hash TEXT PRIMARY KEY,key_type TEXT NOT NULL CHECK(key_type IN('FREE','PREMIUM')),
    status TEXT NOT NULL DEFAULT 'UNUSED' CHECK(status IN('UNUSED','ACTIVE','REVOKED')),
    created_at INTEGER NOT NULL,activated_at INTEGER,expires_at INTEGER,note TEXT,last_used_at INTEGER
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER NOT NULL DEFAULT 15,active INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS task_submissions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,task_id TEXT NOT NULL,action TEXT,
    created_at INTEGER NOT NULL,ip_hash TEXT,metadata TEXT,user_ref TEXT,proof TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',reviewed_at INTEGER,review_note TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS free_task_sessions(
    session_id TEXT PRIMARY KEY,completed_json TEXT NOT NULL DEFAULT '[]',
    challenge_task TEXT,challenge_answer TEXT,challenge_expires_at INTEGER,
    task_started_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,ip_hash TEXT,
    issued_key_hash TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits(
    id INTEGER PRIMARY KEY AUTOINCREMENT,ip_hash TEXT NOT NULL,created_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,detail TEXT,created_at INTEGER NOT NULL
  )`).run();

  // Non-destructive compatibility migration for older D1 schemas.
  for(const [c,d] of [
    ["user_ref","TEXT"],["proof","TEXT"],["status","TEXT NOT NULL DEFAULT 'PENDING'"],
    ["reviewed_at","INTEGER"],["review_note","TEXT"]
  ]) await ensureColumn(db,"task_submissions",c,d);
  await ensureColumn(db,"tasks","active","INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db,"tasks","enabled","INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db,"tasks","sort_order","INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db,"tasks","created_at","TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db,"free_task_sessions","task_started_json","TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn(db,"free_task_sessions","human_verified_at","INTEGER");

  await db.prepare("UPDATE tasks SET active=0,enabled=0 WHERE id IN ('subscribe','like','watch','comment','read_rules','install_guide','security_basics','api_basics')").run();
  for(let i=0;i<TASKS.length;i++){
    const t=TASKS[i];
    await db.prepare(`INSERT INTO tasks
      (id,title,description,url,duration_seconds,active,enabled,sort_order,created_at)
      VALUES(?,?,?,?,?,1,1,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(t[0],t[1],t[2],t[3],t[4],(i+1)*10,new Date().toISOString()).run();
  }
  await db.prepare(`UPDATE tasks SET sort_order=CASE id
    WHEN 'subscribe_channel' THEN 10 WHEN 'like_video' THEN 20
    WHEN 'comment_video' THEN 30 WHEN 'watch_video' THEN 40
    WHEN 'discord_join' THEN 50 ELSE sort_order END
    WHERE id IN ('subscribe_channel','like_video','comment_video','watch_video','discord_join')`).run();
}
async function activeTasks(db){
  const result=await db.prepare("SELECT id,title,description,url,duration_seconds FROM tasks WHERE active=1 AND enabled=1 ORDER BY sort_order ASC,rowid ASC").all();
  return (result.results||[]).map(t=>({...t,duration_seconds:Math.max(0,Number(t.duration_seconds)||0)}));
}
async function verifyTurnstile(req, token, env){
  const secret = String(env.TURNSTILE_SECRET_KEY || "");
  if(!secret) return {ok:false,code:"TURNSTILE_NOT_CONFIGURED",message:"Human verification is not configured on the API yet."};
  if(!token) return {ok:false,code:"TURNSTILE_REQUIRED",message:"Complete the human verification first."};
  try{
    const form = new URLSearchParams();
    form.set("secret",secret);
    form.set("response",String(token).slice(0,2048));
    const ip = req.headers.get("CF-Connecting-IP");
    if(ip) form.set("remoteip",ip);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:form});
    const result = await response.json();
    if(result.success === true) return {ok:true};
    return {ok:false,code:"TURNSTILE_FAILED",message:"Human verification failed or expired. Please verify again."};
  }catch(e){
    return {ok:false,code:"TURNSTILE_ERROR",message:"Unable to verify human check right now. Please try again."};
  }
}
async function audit(db,type,detail=""){
  try{await db.prepare("INSERT INTO audit_events(event_type,detail,created_at) VALUES(?,?,?)")
    .bind(str(type,100),str(detail,1000),now()).run()}catch(e){console.error("Audit:",e.message)}
}
async function getKey(db,key){
  key=norm(key);if(!key)return null;
  return db.prepare("SELECT * FROM keys WHERE key_hash=?").bind(await hash(key)).first();
}
// Admin endpoints may receive the stored SHA-256 hash from the key table.
// This helper is only used after the caller has passed admin authorization.
async function getAdminKey(db,key){
  key=norm(key);if(!key)return null;
  const byHash=await db.prepare("SELECT * FROM keys WHERE key_hash=?").bind(key.toLowerCase()).first();
  return byHash || getKey(db,key);
}
async function create(db,type,note="",activeFree=false){
  type=str(type).toUpperCase();
  if(!["FREE","PREMIUM"].includes(type))throw Error("TYPE_MUST_BE_FREE_OR_PREMIUM");
  const key=gen(type),h=await hash(key),t=now();
  const status=(type==="PREMIUM"||(type==="FREE"&&activeFree))?"ACTIVE":"UNUSED";
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
  const u=new URL(req.url),p=u.pathname.replace(/\/+$/,"")||"/",m=req.method.toUpperCase(),db=env.DB;
  await schema(db);


  // Public executor bootstrap. Keep the actual Lua payload in the PERMA_LUA_SOURCE secret,
  // never in this public repository.
  if(p==="/loader"&&m==="GET"){
    const bootstrap = String.raw`local API = "https://perma-key-api.herdiansyah0239.workers.dev"
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local function notify(message)
  pcall(function()
    game:GetService("StarterGui"):SetCore("SendNotification", {Title="PERMA KEY", Text=message, Duration=6})
  end)
end
local gui = Instance.new("ScreenGui")
gui.Name = "PermaKeyLoader"
gui.ResetOnSpawn = false
local ok = pcall(function() gui.Parent = game:GetService("CoreGui") end)
if not ok then gui.Parent = player:WaitForChild("PlayerGui") end
-- Five-second branded intro before the key form appears.
local splash = Instance.new("Frame", gui)
splash.Size = UDim2.fromOffset(330, 150)
splash.AnchorPoint = Vector2.new(0.5, 0.5)
splash.Position = UDim2.fromScale(0.5, 0.5)
splash.BackgroundColor3 = Color3.fromRGB(14, 25, 44)
splash.BorderSizePixel = 0
local splashCorner = Instance.new("UICorner", splash); splashCorner.CornerRadius = UDim.new(0, 16)
local splashStroke = Instance.new("UIStroke", splash); splashStroke.Color = Color3.fromRGB(70, 220, 255); splashStroke.Thickness = 2
local splashTitle = Instance.new("TextLabel", splash)
splashTitle.Size = UDim2.new(1, -24, 0, 34); splashTitle.Position = UDim2.fromOffset(12, 15)
splashTitle.BackgroundTransparency = 1; splashTitle.Text = "PERMA IMPORT"
splashTitle.TextColor3 = Color3.fromRGB(248, 252, 255); splashTitle.Font = Enum.Font.GothamBlack; splashTitle.TextSize = 22
local splashSub = Instance.new("TextLabel", splash)
splashSub.Size = UDim2.new(1, -24, 0, 22); splashSub.Position = UDim2.fromOffset(12, 51)
splashSub.BackgroundTransparency = 1; splashSub.Text = "RBXM TO STUDIO LITE  •  SECURE ACCESS"
splashSub.TextColor3 = Color3.fromRGB(100, 225, 255); splashSub.Font = Enum.Font.GothamBold; splashSub.TextSize = 10
local splashTrack = Instance.new("Frame", splash)
splashTrack.Size = UDim2.new(1, -28, 0, 8); splashTrack.Position = UDim2.fromOffset(14, 88)
splashTrack.BackgroundColor3 = Color3.fromRGB(39, 56, 80); splashTrack.BorderSizePixel = 0
Instance.new("UICorner", splashTrack).CornerRadius = UDim.new(1, 0)
local splashFill = Instance.new("Frame", splashTrack)
splashFill.Size = UDim2.new(0, 0, 1, 0); splashFill.BackgroundColor3 = Color3.fromRGB(66, 210, 255); splashFill.BorderSizePixel = 0
Instance.new("UICorner", splashFill).CornerRadius = UDim.new(1, 0)
local splashStatus = Instance.new("TextLabel", splash)
splashStatus.Size = UDim2.new(1, -28, 0, 20); splashStatus.Position = UDim2.fromOffset(14, 105)
splashStatus.BackgroundTransparency = 1; splashStatus.Text = "INITIALIZING SECURE SESSION..."
splashStatus.TextColor3 = Color3.fromRGB(198, 224, 247); splashStatus.Font = Enum.Font.GothamBold; splashStatus.TextSize = 10
for i = 1, 5 do
  splashStatus.Text = ({"CONNECTING TO PERMA SERVER...","PREPARING KEY GATE...","LOADING IMPORT MODULES...","CHECKING SESSION...","READY — ENTER YOUR KEY"})[i]
  game:GetService("TweenService"):Create(splashFill, TweenInfo.new(1, Enum.EasingStyle.Linear), {Size = UDim2.new(i / 5, 0, 1, 0)}):Play()
  task.wait(1)
end
splash:Destroy()
local frame = Instance.new("Frame", gui)
frame.Size = UDim2.fromOffset(340, 290)
frame.Position = UDim2.new(0.5, -170, 0.5, -145)
frame.BackgroundColor3 = Color3.fromRGB(10, 17, 31)
frame.BorderSizePixel = 0
local corner = Instance.new("UICorner", frame); corner.CornerRadius = UDim.new(0, 12)
local stroke = Instance.new("UIStroke", frame); stroke.Color = Color3.fromRGB(45, 180, 230); stroke.Thickness = 1.5
local title = Instance.new("TextLabel", frame)
title.Size = UDim2.new(1, -24, 0, 32); title.Position = UDim2.fromOffset(12, 8)
title.BackgroundTransparency = 1; title.Text = "PERMA KEY"; title.TextColor3 = Color3.fromRGB(100, 225, 255)
title.Font = Enum.Font.GothamBold; title.TextSize = 21
local freeBadge = Instance.new("TextLabel", frame)
freeBadge.Size = UDim2.fromOffset(143, 24); freeBadge.Position = UDim2.fromOffset(14, 43)
freeBadge.BackgroundColor3 = Color3.fromRGB(19, 125, 83); freeBadge.BorderSizePixel = 0
freeBadge.Text = "✦  FREE KEY  •  6 HOURS"; freeBadge.TextColor3 = Color3.fromRGB(237, 255, 247)
freeBadge.Font = Enum.Font.GothamBold; freeBadge.TextSize = 9
Instance.new("UICorner", freeBadge).CornerRadius = UDim.new(0, 7)
local premiumBadge = Instance.new("TextLabel", frame)
premiumBadge.Size = UDim2.fromOffset(151, 24); premiumBadge.Position = UDim2.fromOffset(175, 43)
premiumBadge.BackgroundColor3 = Color3.fromRGB(103, 65, 177); premiumBadge.BorderSizePixel = 0
premiumBadge.Text = "♛  PREMIUM  •  LIFETIME"; premiumBadge.TextColor3 = Color3.fromRGB(255, 248, 226)
premiumBadge.Font = Enum.Font.GothamBold; premiumBadge.TextSize = 9
Instance.new("UICorner", premiumBadge).CornerRadius = UDim.new(0, 7)
local input = Instance.new("TextBox", frame)
input.Size = UDim2.new(1, -28, 0, 38); input.Position = UDim2.fromOffset(14, 83)
input.BackgroundColor3 = Color3.fromRGB(20, 31, 49); input.TextColor3 = Color3.new(1,1,1)
input.PlaceholderText = "Masukkan Free / Premium Key"; input.PlaceholderColor3 = Color3.fromRGB(145,160,180)
input.Text = ""; input.ClearTextOnFocus = false; input.Font = Enum.Font.Gotham; input.TextSize = 13
local ic = Instance.new("UICorner", input); ic.CornerRadius = UDim.new(0, 7)
local button = Instance.new("TextButton", frame)
button.Size = UDim2.new(1, -28, 0, 36); button.Position = UDim2.fromOffset(14, 129)
button.BackgroundColor3 = Color3.fromRGB(0, 145, 210); button.TextColor3 = Color3.new(1,1,1)
button.Text = "VERIFY KEY & EXECUTE"; button.Font = Enum.Font.GothamBold; button.TextSize = 13
local bc = Instance.new("UICorner", button); bc.CornerRadius = UDim.new(0, 7)
local status = Instance.new("TextLabel", frame)
status.Size = UDim2.new(1, -24, 0, 30); status.Position = UDim2.fromOffset(12, 247)
status.BackgroundTransparency = 1; status.TextColor3 = Color3.fromRGB(180, 200, 220)
status.Text = "Free Key berlaku 6 jam; Premium mengikuti pengaturan admin."
status.Font = Enum.Font.Gotham; status.TextSize = 10; status.TextWrapped = true
local getFree = Instance.new("TextButton", frame)
getFree.Size = UDim2.new(1, -28, 0, 30); getFree.Position = UDim2.fromOffset(14, 171)
getFree.BackgroundColor3 = Color3.fromRGB(28, 105, 72); getFree.TextColor3 = Color3.new(1,1,1)
getFree.Text = "GET FREE KEY — OPEN WEBSITE"; getFree.Font = Enum.Font.GothamBold; getFree.TextSize = 11
local gfc = Instance.new("UICorner", getFree); gfc.CornerRadius = UDim.new(0, 7)
getFree.Activated:Connect(function()
  local url = "https://permafreekey.pages.dev/"
  local opened = pcall(function() game:GetService("GuiService"):OpenBrowserWindow(url) end)
  if not opened then
    local copied = pcall(function()
      local fn = (type(getgenv)=="function" and getgenv().setclipboard) or setclipboard
      if type(fn)=="function" then fn(url) else error("clipboard unavailable") end
    end)
    status.Text = copied and "Link website disalin. Buka browser untuk mendapat key." or ("Buka website: "..url)
  else
    status.Text = "Website Free Key dibuka."
  end
end)
local busy = false
button.Activated:Connect(function()
  if busy then return end
  local key = string.gsub(input.Text or "", "^%s*(.-)%s*$", "%1")
  if key == "" then status.Text = "Masukkan key terlebih dahulu."; return end
  busy = true; button.Text = "CHECKING..."; status.Text = "Memeriksa key ke server..."
  task.spawn(function()
    local success, result = pcall(function()
      return game:HttpGet(API .. "/execute?key=" .. HttpService:UrlEncode(key))
    end)
    if not success then
      status.Text = "Gagal menghubungi API. Coba lagi."
      button.Text = "VERIFY KEY & EXECUTE"; busy = false; return
    end
    if string.find(result, "PERMA_KEY_ERROR:", 1, true) == 1 then
      status.Text = string.sub(result, 17, 220)
      button.Text = "VERIFY KEY & EXECUTE"; busy = false; return
    end
    status.Text = "Key valid. Memuat script..."
    local authEnv = _G
    pcall(function() if type(getgenv) == "function" then authEnv = getgenv() end end)
    pcall(function() authEnv.PERMA_KEY_AUTHORIZED = true; authEnv.PERMA_KEY_TYPE = string.find(key, "PREMIUM", 1, true) and "PREMIUM" or "FREE" end)
    pcall(function()
      local write = (type(getgenv)=="function" and getgenv().writefile) or writefile
      if type(write)=="function" then write("PERMA_IMPORT_LAST_KEY.txt", key) end
    end)
    local compile, chunk = pcall(loadstring, result)
    if not compile or type(chunk) ~= "function" then
      status.Text = "Script gagal dimuat / response tidak valid."
      button.Text = "VERIFY KEY & EXECUTE"; busy = false; return
    end
    gui:Destroy()
    local ran, failure = pcall(chunk)
    if not ran then warn("[PERMA KEY] Script error: " .. tostring(failure)); notify("Script mengalami error. Periksa console.") end
  end)
end)`;
    return new Response(bootstrap,{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"}});
  }

  if(p==="/execute"&&m==="GET"){
    const key = raw({},u);
    if(!key)return new Response("PERMA_KEY_ERROR: Masukkan key terlebih dahulu.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    const checked = await validate(db,key);
    if(checked.valid!==true)return new Response("PERMA_KEY_ERROR: "+str(checked.message||"Key tidak valid.",180),{status:403,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    let lua = String(env.PERMA_LUA_SOURCE||"");
    // Preferred source: a private GitHub repository. Configure GITHUB_TOKEN as a
    // Cloudflare Worker secret with read-only Contents access to the private importer repo.
    if(!lua.trim()&&env.GITHUB_TOKEN){
      const gh = await fetch("https://api.github.com/repos/Permadiw/PERMA-IMPORT-RBXM-TO-STUDIO-LITE-/contents/main.lua?ref=main",{
        headers:{
          "Authorization":"Bearer "+env.GITHUB_TOKEN,
          "Accept":"application/vnd.github.raw+json",
          "X-GitHub-Api-Version":"2022-11-28",
          "User-Agent":"PERMA-KEY-API"
        }
      });
      if(gh.ok){
        const contentType=gh.headers.get("content-type")||"";
        if(contentType.includes("application/json")){
          const data=await gh.json();
          if(data&&data.content)lua=atob(String(data.content).replace(/\\s/g,""));
        }else{
          lua=await gh.text();
        }
      }else{
        console.error("Private importer fetch failed:",gh.status);
      }
    }
    if(!lua.trim())return new Response("PERMA_KEY_ERROR: Script privat belum dapat diambil. Admin perlu mengatur GITHUB_TOKEN dan menjadikan repository importer privat.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    await audit(db,"SCRIPT_DELIVERED",checked.key_type||checked.type||"KEY");
    return new Response(lua,{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff"}});
  }

  if(p==="/health"&&m==="GET")return res({success:true,service:"PERMA KEY API",status:"online",time:new Date().toISOString()});

  if(p==="/tasks/list"&&m==="GET"){
    return res({success:true,tasks:await activeTasks(db)});
  }

  if(p==="/public/tasks/start"&&m==="POST"){
    const b=await body(req),existingId=str(b.session_id,100),tasks=await activeTasks(db);
    if(!tasks.length)return err("NO_ACTIVE_TASKS","No active Free Key tasks are configured. Please contact the site owner.",503);
    if(existingId){
      const existing=await db.prepare("SELECT * FROM free_task_sessions WHERE session_id=?").bind(existingId).first();
      if(existing&&now()-Number(existing.created_at)<=7200){
        return res({success:true,session_id:existingId,completed_tasks:JSON.parse(existing.completed_json||"[]"),human_verified:!!existing.human_verified_at,tasks});
      }
    }
    const ip=await hash(req.headers.get("CF-Connecting-IP")||"unknown");
    const sid=crypto.randomUUID(),t=now();
    await db.prepare("INSERT INTO free_task_sessions(session_id,completed_json,created_at,updated_at,ip_hash) VALUES(?,'[]',?,?,?)")
      .bind(sid,t,t,ip).run();
    return res({success:true,session_id:sid,completed_tasks:[],human_verified:false,tasks});
  }

  if(p==="/public/tasks/verify"&&m==="POST"){
    const b=await body(req),sid=str(b.session_id,100),token=str(b.turnstile_token,2048);
    if(!sid)return err("SESSION_REQUIRED","Complete the tasks before human verification.",403);
    const session=await db.prepare("SELECT * FROM free_task_sessions WHERE session_id=?").bind(sid).first();
    if(!session||now()-Number(session.created_at)>7200)return err("SESSION_EXPIRED","Start the task flow again.",410);
    const completed=JSON.parse(session.completed_json||"[]"),tasks=await activeTasks(db);
    if(!tasks.length||!tasks.every(x=>completed.includes(x.id)))return err("TASKS_INCOMPLETE","Complete all active tasks before human verification.",403);
    const humanCheck=await verifyTurnstile(req,token,env);
    if(!humanCheck.ok)return err(humanCheck.code,humanCheck.message,403);
    await db.prepare("UPDATE free_task_sessions SET human_verified_at=?,updated_at=? WHERE session_id=?")
      .bind(now(),now(),sid).run();
    return res({success:true,verified:true,message:"Human verification successful."});
  }

  if(p==="/public/tasks/begin"&&m==="POST"){
    const b=await body(req),sid=str(b.session_id,100),taskId=str(b.task_id,100),tasks=await activeTasks(db);
    const index=tasks.findIndex(x=>x.id===taskId);
    if(!sid||index<0)return err("INVALID_TASK","A valid session_id and active task_id are required.");
    const session=await db.prepare("SELECT * FROM free_task_sessions WHERE session_id=?").bind(sid).first();
    if(!session||now()-Number(session.created_at)>7200)return err("SESSION_EXPIRED","Start the task flow again.",410);
    const completed=JSON.parse(session.completed_json||"[]");
    if(index>0&&!completed.includes(tasks[index-1].id))return err("TASK_LOCKED","Complete the previous task first.",409);
    if(completed.includes(taskId))return res({success:true,completed:true,task_id:taskId});
    const starts=JSON.parse(session.task_started_json||"{}");
    if(!Number(starts[taskId]))starts[taskId]=now();
    await db.prepare("UPDATE free_task_sessions SET task_started_json=?,updated_at=? WHERE session_id=?")
      .bind(JSON.stringify(starts),now(),sid).run();
    const duration=Number(tasks[index].duration_seconds)||0;
    return res({success:true,task_id:taskId,started_at:Number(starts[taskId]),duration_seconds:duration,deadline:Number(starts[taskId])+duration});
  }

  // Legacy quiz endpoint disabled: all tasks use the same timer + honest confirmation flow.
  if(p==="/public/tasks/challenge"&&m==="POST"){
    return err("QUIZ_REMOVED","Quiz questions have been removed. Wait for the task timer and confirm honestly.",410);
  }

  if(p==="/public/tasks/complete"&&m==="POST"){
    const b=await body(req),sid=str(b.session_id,100),taskId=str(b.task_id,100),confirmed=b.confirmed===true;
    if(!sid||!taskId||!confirmed)return err("CONFIRMATION_REQUIRED","Confirm that you genuinely completed this task.",400);
    const session=await db.prepare("SELECT * FROM free_task_sessions WHERE session_id=?").bind(sid).first();
    if(!session||now()-Number(session.created_at)>7200)return err("SESSION_EXPIRED","Start the task flow again.",410);
    const completed=JSON.parse(session.completed_json||"[]"),tasks=await activeTasks(db);
    const index=tasks.findIndex(x=>x.id===taskId);
    if(index<0)return err("INVALID_TASK","Unknown or inactive task.",400);
    if(index>0&&!completed.includes(tasks[index-1].id))return err("TASK_LOCKED","Complete the previous task first.",409);
    if(completed.includes(taskId))return res({success:true,completed:true,task_id:taskId,completed_tasks:completed,all_complete:tasks.length>0&&tasks.every(x=>completed.includes(x.id))});
    const starts=JSON.parse(session.task_started_json||"{}"),startedAt=Number(starts[taskId]||0),duration=Number(tasks[index].duration_seconds)||0;
    if(!startedAt)return err("TASK_NOT_STARTED","Start this task before confirming it.",409);
    if(now()-startedAt<duration)return err("TASK_TIMER_ACTIVE","Please wait until the server-side timer finishes.",409);
    completed.push(taskId);
    await db.prepare("UPDATE free_task_sessions SET completed_json=?,challenge_task=NULL,challenge_answer=NULL,challenge_expires_at=NULL,updated_at=? WHERE session_id=?")
      .bind(JSON.stringify(completed),now(),sid).run();
    await audit(db,"FREE_TASK_CONFIRMED",taskId);
    const currentTasks=await activeTasks(db);
    return res({success:true,completed:true,task_id:taskId,completed_tasks:completed,all_complete:currentTasks.length>0&&currentTasks.every(x=>completed.includes(x.id))});
  }

  if(p==="/public/get-key"&&m==="POST"){
    if(!await rate(req,db))return err("RATE_LIMITED","Free Key limit reached. Try again later.",429);
    const b=await body(req),sid=str(b.session_id,100);
    if(!sid)return err("TASKS_REQUIRED","Complete the website tasks before requesting a key.",403);
    const session=await db.prepare("SELECT * FROM free_task_sessions WHERE session_id=?").bind(sid).first();
    if(!session||now()-Number(session.created_at)>7200)return err("SESSION_EXPIRED","Start the task flow again.",410);
    const completed=JSON.parse(session.completed_json||"[]"),tasks=await activeTasks(db);
    if(!tasks.length||!tasks.every(x=>completed.includes(x.id)))return err("TASKS_INCOMPLETE","Complete all active server-checked website tasks first.",403);
    if(!Number(session.human_verified_at)||now()-Number(session.human_verified_at)>600)return err("HUMAN_VERIFICATION_REQUIRED","Please verify that you are human before requesting a key.",403);
    if(session.issued_key_hash)return err("KEY_ALREADY_ISSUED","This task session has already received a key.",409);
    const issued=await create(db,"FREE","Website tasks completed",true);
    await db.prepare("UPDATE free_task_sessions SET issued_key_hash=?,updated_at=? WHERE session_id=? AND issued_key_hash IS NULL")
      .bind(await hash(issued.key),now(),sid).run();
    return res({success:true,code:"KEY_CREATED",message:"Free Key activated immediately. Six-hour validity starts now.",...issued});
  }

  // Read-only status check for a previously issued key. Does not activate UNUSED keys.
  if(p==="/public/key-status"&&m==="POST"){
    const b=await body(req),key=raw(b,u),r=await getKey(db,key);
    if(!r)return res({success:true,exists:false,valid:false,code:"INVALID_KEY",message:"Key not found."});
    if(r.status==="REVOKED")return res({success:true,exists:true,valid:false,code:"REVOKED",message:"This key has been revoked.",key_type:r.key_type,status:r.status});
    if(r.key_type==="FREE"&&r.status==="ACTIVE"&&(!r.expires_at||Number(r.expires_at)<=now()))
      return res({success:true,exists:true,valid:false,code:"EXPIRED",message:"Free key has expired.",key_type:r.key_type,status:r.status,expires_at:r.expires_at});
    return res({success:true,exists:true,valid:true,code:"KEY_EXISTS",message:"Key exists and is not expired.",key_type:r.key_type,status:r.status,expires_at:r.expires_at??null});
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
    const userRef=str(b.user_ref||b.user||b.session_id,200);
    const proof=str(b.proof,2000),stamp=new Date().toISOString();
    const r=await db.prepare(`INSERT INTO task_submissions
      (session_id,task_id,action,created_at,user_ref,proof,status,metadata)
      VALUES(?,?,?,?,?,?, 'PENDING', ?)`)
      .bind(str(b.session_id||userRef||crypto.randomUUID(),200),id,str(b.action||id,100),stamp,userRef,proof,
        JSON.stringify({source:"perma-key-api"})).run();
    return res({success:true,code:"SUBMISSION_RECEIVED",message:"Submission received for review.",submission_id:r.meta?.last_row_id??null});
  }

  const paths=["/admin/list","/admin/create","/admin/activate","/admin/revoke","/admin/delete","/admin/tasks","/admin/tasks/create","/admin/tasks/review","/admin/events","/admin/events/delete","/admin/events/clear"];
  if(paths.includes(p)&&!env.ADMIN_TOKEN)return err("CONFIG_ERROR","ADMIN_TOKEN secret is missing on this Worker.",500);
  if(paths.includes(p)&&!admin(req,env))return err("UNAUTHORIZED","Admin authorization required.",401);

  if(p==="/admin/list"&&m==="GET"){
    const r=await db.prepare(`SELECT key_hash,key_type,status,created_at,activated_at,expires_at,note,last_used_at FROM keys ORDER BY created_at DESC`).all();
    return res({success:true,count:r.results?.length||0,keys:r.results||[]});
  }

  if(p==="/admin/create"&&m==="POST"){
    const b=await body(req),type=str(b.type||b.key_type||"FREE").toUpperCase();
    if(!["FREE","PREMIUM"].includes(type))return err("INVALID_TYPE","type must be FREE or PREMIUM.");
    return res({success:true,code:"KEY_CREATED",message:`${type} key created and activated.`,...await create(db,type,b.note||"",true)});
  }

  if(p==="/admin/activate"&&m==="POST"){
    const b=await body(req),r=await getAdminKey(db,raw(b,u));
    if(!r)return err("INVALID_KEY","Key not found.",404);
    if(r.status==="REVOKED")return err("REVOKED","Revoked keys cannot be activated.",409);
    const t=now(),expiry=r.key_type==="FREE"?t+FREE:null;
    await db.prepare(`UPDATE keys SET status='ACTIVE',activated_at=?,expires_at=? WHERE key_hash=? AND status!='REVOKED'`).bind(t,expiry,r.key_hash).run();
    await audit(db,"KEY_ACTIVATED",r.key_type);
    return res({success:true,code:"KEY_ACTIVATED",key_type:r.key_type,status:"ACTIVE",activated_at:t,expires_at:expiry});
  }

  if(p==="/admin/revoke"&&m==="POST"){
    const b=await body(req),r=await getAdminKey(db,raw(b,u));
    if(!r)return err("INVALID_KEY","Key not found.",404);
    await db.prepare("UPDATE keys SET status='REVOKED' WHERE key_hash=?").bind(r.key_hash).run();
    await audit(db,"KEY_REVOKED",r.key_type);
    return res({success:true,code:"KEY_REVOKED",key_type:r.key_type,status:"REVOKED"});
  }

  if(p==="/admin/delete"&&m==="POST"){
    const b=await body(req),r=await getAdminKey(db,raw(b,u));
    if(!r)return err("INVALID_KEY","Key not found.",404);
    await audit(db,"KEY_PERMANENTLY_DELETED",`type=${r.key_type}; status=${r.status}`);
    const result=await db.prepare("DELETE FROM keys WHERE key_hash=?").bind(r.key_hash).run();
    if(Number(result.meta?.changes)===0)return err("DELETE_FAILED","Key was not deleted.",500);
    return res({success:true,code:"KEY_PERMANENTLY_DELETED",message:"Key permanently deleted.",key_type:r.key_type,deleted:Number(result.meta?.changes??1)});
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
    const active=b.active===false||b.active===0?0:1;
    const order=await db.prepare("SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM tasks").first();
    await db.prepare(`INSERT INTO tasks(id,title,description,url,duration_seconds,active,enabled,sort_order,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,url=excluded.url,
      duration_seconds=excluded.duration_seconds,active=excluded.active,enabled=excluded.enabled`)
      .bind(id,title,str(b.description,1000),str(b.url,2000),duration,active,active,Number(order?.next_order||10),new Date().toISOString()).run();
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

  if(p==="/admin/events/delete"&&m==="POST"){
    const b=await body(req),id=Number(b.id);
    if(!Number.isSafeInteger(id)||id<=0)return err("INVALID_ID","A valid log ID is required.");
    const result=await db.prepare("DELETE FROM audit_events WHERE id=?").bind(id).run();
    if(!result.meta?.changes)return err("LOG_NOT_FOUND","Log not found.",404);
    return res({success:true,code:"LOG_DELETED",message:"Admin log deleted.",deleted:1});
  }

  if(p==="/admin/events/clear"&&m==="POST"){
    const result=await db.prepare("DELETE FROM audit_events").run();
    return res({success:true,code:"LOGS_CLEARED",message:"All admin logs cleared.",deleted:Number(result.meta?.changes||0)});
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
