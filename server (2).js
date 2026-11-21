const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const server=http.createServer((q,r)=>fs.readFile(path.join(__dirname,'public','index.html'),(e,d)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(d)}));
const wss=new WebSocketServer({server}),rooms={};
const uid=()=>Math.random().toString(36).slice(2,10);
const mkCode=()=>{let c;do c=Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('');while(rooms[c]);return c};
const shuf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
const send=(p,o)=>p.ws&&p.ws.readyState===1&&p.ws.send(JSON.stringify(o));
const alive=(r,role)=>r.players.filter(p=>p.alive&&(!role||p.role===role));
const byId=(r,id)=>r.players.find(p=>p.id===id);
const RN={mafia:'مافيا',doctor:'الدكتور',detective:'المحقق',citizen:'مواطن'};

function view(r,p){
  const d=r.phase==='day',nt=r.phase==='night',end=r.phase==='end',a=r.act,tally={};
  if(d)Object.values(r.votes).forEach(t=>{if(t!=='skip')tally[t]=(tally[t]||0)+1});
  return{code:r.code,phase:r.phase,day:r.day,host:r.hostId===p.id,me:p.id,msg:r.msg,winner:r.winner,tally,chat:r.chatAll.slice(-60),mchat:p.role==='mafia'&&r.phase!=='lobby'?r.chatMafia.slice(-60):[],
    acted:!!(nt&&a&&((p.role==='mafia'&&p.id in a.mafia)||(p.role==='doctor'&&a.doctor)||(p.role==='detective'&&a.detective))),
    voted:d&&p.id in r.votes,result:p.result||null,wait:d?alive(r).filter(q=>!(q.id in r.votes)).length:0,
    mpicks:nt&&p.role==='mafia'?Object.entries(a.mafia).map(([v,t])=>byId(r,v).name+' ← '+byId(r,t).name):[],
    players:r.players.map(q=>({id:q.id,name:q.name,alive:q.alive!==false,online:!!q.ws,
      role:(end||q.id===p.id||(r.phase!=='lobby'&&q.alive===false)||(p.role==='mafia'&&q.role==='mafia'))?q.role:null}))};
}
const bcast=r=>r.players.forEach(p=>send(p,{t:'state',s:view(r,p)}));

function start(r){
  const n=r.players.length,mc=n>=13?3:n>=9?2:1,rl=[...Array(mc).fill('mafia'),'doctor','detective'];
  while(rl.length<n)rl.push('citizen');shuf(rl);
  r.players.forEach((p,i)=>{p.role=rl[i];p.alive=true;p.result=null});r.day=0;r.winner=null;r.chatMafia=[];nightStart(r);
}
function nightStart(r){r.phase='night';r.day++;r.act={mafia:{},doctor:null,detective:null};r.votes={};r.players.forEach(p=>p.result=null);r.msg='🌙 الليل نزل على المدينة... كل واحد ينتظر دوره'}
function checkWin(r){
  const m=alive(r,'mafia').length,o=alive(r).length-m;
  if(m===0)r.winner='citizens';else if(m>=o)r.winner='mafia';else return false;
  r.phase='end';r.msg=r.winner==='citizens'?'🎉 فاز المواطنون! انكشفت المافيا كلها':'😈 فازت المافيا! سيطروا على المدينة';return true;
}
function tryNight(r,force){
  const a=r.act,mf=alive(r,'mafia');
  const done=mf.every(p=>p.id in a.mafia)&&(!alive(r,'doctor').length||a.doctor)&&(!alive(r,'detective').length||a.detective);
  if(!done&&!force)return;
  const c={};Object.values(a.mafia).forEach(t=>c[t]=(c[t]||0)+1);
  const mx=Math.max(0,...Object.values(c)),top=Object.keys(c).filter(k=>c[k]===mx);
  const t=top.length?top[Math.random()*top.length|0]:null;let m;
  if(t&&t!==a.doctor){const v=byId(r,t);v.alive=false;m=`☀️ طلع الصبح... انقتل ${v.name} وكان ${RN[v.role]}`}
  else m='☀️ طلع الصبح... ولا أحد انقتل الليلة!';
  r.msg=m;if(checkWin(r))return;r.phase='day';r.votes={};
}
function tryDay(r,force){
  if(!force&&!alive(r).every(p=>p.id in r.votes))return;
  const c={};Object.values(r.votes).forEach(t=>{if(t!=='skip')c[t]=(c[t]||0)+1});
  const mx=Math.max(0,...Object.values(c)),top=Object.keys(c).filter(k=>c[k]===mx);
  if(mx>0&&top.length===1){const v=byId(r,top[0]);v.alive=false;r.msg=`⚖️ انعدم ${v.name} وكان ${RN[v.role]}`}
  else r.msg='⚖️ التصويت تعادل أو انتهى بالامتناع... ما انعدم أحد';
  if(checkWin(r))return;nightStart(r);r.msg+=' — 🌙 الليل نزل';
}

wss.on('connection',ws=>{
  const fail=m=>ws.send(JSON.stringify({t:'err',m}));
  ws.on('message',raw=>{
    let d;try{d=JSON.parse(raw)}catch{return}
    const clean=s=>String(s||'').trim().slice(0,14);
    if(d.t==='create'){
      const name=clean(d.name);if(!name)return fail('اكتب اسمك');
      const r={code:mkCode(),players:[],phase:'lobby',votes:{},day:0,chatAll:[],chatMafia:[]};
      const p={id:uid(),name,ws};r.players.push(p);r.hostId=p.id;rooms[r.code]=r;ws.p=p;ws.r=r;return bcast(r);
    }
    if(d.t==='join'){
      const r=rooms[String(d.code||'').toUpperCase()],name=clean(d.name);
      if(!r)return fail('الكود غير صحيح');if(!name)return fail('اكتب اسمك');
      if(r.phase!=='lobby')return fail('اللعبة بدت');if(r.players.length>=15)return fail('الغرفة ممتلئة (١٥)');
      if(r.players.some(x=>x.name===name))return fail('الاسم مستخدم');
      const p={id:uid(),name,ws};r.players.push(p);ws.p=p;ws.r=r;return bcast(r);
    }
    if(d.t==='resume'){
      const r=rooms[d.code],p=r&&byId(r,d.id);
      if(!p)return ws.send(JSON.stringify({t:'gone'}));
      p.ws=ws;ws.p=p;ws.r=r;return bcast(r);
    }
    const p=ws.p,r=ws.r;if(!p||!r)return;
    if(d.t==='chat'){
      const text=String(d.text||'').trim().slice(0,200),now=Date.now(),ch=d.ch==='mafia'?'mafia':'all';
      if(!text||(p.lastChat&&now-p.lastChat<700))return;
      const ok=ch==='all'?(r.phase==='lobby'||r.phase==='end'||(r.phase==='day'&&p.alive)):(p.role==='mafia'&&p.alive&&(r.phase==='night'||r.phase==='day'));
      if(!ok)return;p.lastChat=now;
      const arr=ch==='all'?r.chatAll:r.chatMafia;arr.push({n:p.name,id:p.id,t:text});if(arr.length>100)arr.shift();
      return bcast(r);
    }
    if(d.t==='start'&&r.hostId===p.id&&r.phase==='lobby'){
      if(r.players.length<6)return fail('أقل عدد ٦ لاعبين');start(r);return bcast(r);
    }
    if(d.t==='again'&&r.hostId===p.id&&r.phase==='end'){r.phase='lobby';r.players.forEach(q=>{q.role=null;q.alive=true});r.msg='';r.chatMafia=[];return bcast(r)}
    if(d.t==='force'&&r.hostId===p.id){if(r.phase==='night')tryNight(r,true);else if(r.phase==='day')tryDay(r,true);return bcast(r)}
    const tg=byId(r,d.target);
    if(d.t==='act'&&r.phase==='night'&&p.alive&&tg&&tg.alive){
      if(p.role==='mafia'){if(tg.role==='mafia'||p.id in r.act.mafia)return;r.act.mafia[p.id]=tg.id}
      else if(p.role==='doctor'&&!r.act.doctor)r.act.doctor=tg.id;
      else if(p.role==='detective'&&!r.act.detective&&tg.id!==p.id){r.act.detective=tg.id;p.result=`🔍 ${tg.name}: ${tg.role==='mafia'?'مافيا ✅':'مو مافيا ❌'}`}
      else return;
      tryNight(r);return bcast(r);
    }
    if(d.t==='vote'&&r.phase==='day'&&p.alive&&!(p.id in r.votes)){
      if(d.target==='skip')r.votes[p.id]='skip';else if(tg&&tg.alive&&tg.id!==p.id)r.votes[p.id]=tg.id;else return;
      tryDay(r);return bcast(r);
    }
  });
  ws.on('close',()=>{
    const p=ws.p,r=ws.r;if(!p||!r||p.ws!==ws)return;p.ws=null;
    if(r.phase==='lobby'){r.players=r.players.filter(x=>x!==p);if(!r.players.length)delete rooms[r.code];else{if(r.hostId===p.id)r.hostId=r.players[0].id;bcast(r)}}
    else bcast(r);
  });
});
server.listen(process.env.PORT||3000,()=>console.log('عابد مافيا يشتغل على المنفذ',process.env.PORT||3000));
