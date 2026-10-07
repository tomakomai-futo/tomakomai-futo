// 苫小牧埠頭野球部 成績管理アプリ v3.10.3
const KEY='tomakomai_futo_v1';
let db=JSON.parse(localStorage.getItem(KEY)||'null')||{players:[],games:[],atBats:[],pitches:[],events:[],announcements:[]};
if(!db.atBats) db.atBats=[];
if(!db.pitches) db.pitches=[];
if(!db.events) db.events=[];
if(!db.announcements) db.announcements=[];
if(!db.annualStats) db.annualStats={};
if(!db.annualStats[2026]) db.annualStats[2026]={locked:false,teamGames:0,players:{}};
if(!('currentPlayerId' in db)) db.currentPlayerId=null;
db.players=db.players.map(p=>({...p,position:p.position||''}));
// 旧バージョンの「アウト＋打球」を新しい打席結果へ移行
db.atBats=db.atBats.map(x=>x.result==='アウト' && x.detail ? {...x,result:x.detail,detail:null} : x);
let screen='home',gameId=null,playerId=null,type='公式戦',batEditId=null,pitchEditId=null,eventId=null,announcementId=null,upcomingOnly=false,calMonth=new Date().getMonth(),calYear=new Date().getFullYear();
let admin=false;
let adminPwSession='';
let cloudReady=false;
let cloudInitPromise=null;
let cloudSaveChain=Promise.resolve();
const SUPA = window.TOMAKOMAI_SUPABASE || {};
const sb = (window.supabase && SUPA.url && SUPA.publishableKey) ? window.supabase.createClient(SUPA.url,SUPA.publishableKey) : null;
function requireAdmin(){
  if(admin) return true;
  toast('管理者のみ変更できます');
  return false;
}
async function askPassword(title, message, confirmText='確定'){
  return await new Promise(resolve=>{
    const old=document.getElementById('password-modal');
    if(old) old.remove();
    const wrap=document.createElement('div');
    wrap.id='password-modal';
    wrap.innerHTML=`<div class="password-backdrop"><div class="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title"><h3 id="password-dialog-title">${esc(title)}</h3><p>${esc(message)}</p><input id="password-dialog-input" type="password" autocomplete="off" inputmode="text" placeholder="パスワードを入力" aria-label="パスワード"><div class="password-actions"><button type="button" id="password-cancel" class="secondary">キャンセル</button><button type="button" id="password-ok" class="primary">${esc(confirmText)}</button></div></div></div>`;
    document.body.appendChild(wrap);
    const input=document.getElementById('password-dialog-input');
    const finish=v=>{wrap.remove();resolve(v)};
    document.getElementById('password-cancel').onclick=()=>finish(null);
    document.getElementById('password-ok').onclick=()=>finish(input.value);
    input.addEventListener('keydown',e=>{if(e.key==='Enter')finish(input.value);if(e.key==='Escape')finish(null)});
    setTimeout(()=>input.focus(),0);
  });
}
async function adminLogin(){
  const pw=await askPassword('管理者ログイン','管理者パスワードを入力してください');
  if(pw===null)return;
  if(!sb){toast('クラウドに接続できないため管理者ログインできません');return}
  try{
    const {data,error}=await sb.rpc('verify_admin_password',{p_password:pw});
    if(!error && data===true){admin=true;adminPwSession=pw;toast('管理者モードになりました');render();return;}
    if(error) console.warn(error);
  }catch(e){console.warn(e)}
  toast('パスワードが違います');
}
function adminLogout(){admin=false;adminPwSession='';toast('管理者モードを終了しました');render()}
async function changeAdminPassword(){
  if(!requireAdmin()) return;
  const pw=await askPassword('管理者パスワードの変更','新しいパスワードを入力してください（4文字以上）','変更する');
  if(pw===null)return;
  if(pw.length<4)return toast('4文字以上で設定してください');
  if(!sb)return toast('クラウドに接続できないため変更できません');
  try{
    const {data,error}=await sb.rpc('change_admin_password',{p_old_password:adminPwSession,p_new_password:pw});
    if(error || data!==true){toast('パスワード変更に失敗しました');return;}
  }catch(e){toast('パスワード変更に失敗しました');return;}
  adminPwSession=pw;toast('管理者パスワードを変更しました');
}
function localSave(){localStorage.setItem(KEY,JSON.stringify(db))}
function cloudPayload(){const x=JSON.parse(JSON.stringify(db));x.currentPlayerId=null;return x}
async function cloudSaveAdmin(payload,pw){
  if(!sb||!pw)return false;
  if(cloudInitPromise){
    try{await cloudInitPromise}catch(e){}
  }
  if(!cloudReady)return false;
  try{
    const {data,error}=await sb.rpc('save_app_state',{p_password:pw,p_data:payload});
    if(error || data!==true){
      console.warn('cloud save failed',error||'save_app_state returned false');
      toast('クラウド保存に失敗しました');
      return false;
    }
    return true;
  }catch(e){
    console.warn(e);
    toast('クラウド保存に失敗しました');
    return false;
  }
}
function save(){
  localSave();
  if(admin&&adminPwSession){
    const payload=cloudPayload();
    const pw=adminPwSession;
    cloudSaveChain=cloudSaveChain
      .then(()=>cloudSaveAdmin(payload,pw))
      .catch(e=>{console.warn('cloud save queue failed',e);toast('クラウド保存に失敗しました')});
  }
}
function saveLocalOnly(){localSave()}
async function refreshCloudState(){
  if(!sb)return false;
  try{
    const {data,error}=await sb.from('app_state').select('data').eq('id',1).maybeSingle();
    if(error||!data?.data)return false;
    const localCurrent=db.currentPlayerId||null;
    db=data.data;
    db.currentPlayerId=localCurrent;
    localSave();
    render();
    return true;
  }catch(e){console.warn('cloud refresh failed',e);return false}
}
async function syncAttendanceCloud(eventId,playerId,status,note){
  if(!sb||!cloudReady)return false;
  try{
    const {data,error}=await sb.rpc('update_attendance',{p_event_id:eventId,p_player_id:playerId,p_status:status,p_note:note||''});
    if(error||data!==true){
      console.warn('attendance sync failed',error||'update_attendance returned false');
      toast('出欠のクラウド保存に失敗しました');
      return false;
    }
    // 出欠は専用RPCだけで即時保存する。ここで全体データを再取得しない。
    return true;
  }catch(e){console.warn(e);toast('出欠のクラウド保存に失敗しました');return false}
}
async function cloudInit(){
  if(!sb){console.warn('Supabase config missing');return}
  try{
    const {data,error}=await sb.from('app_state').select('data').eq('id',1).maybeSingle();
    if(error){console.warn('cloud load failed',error);return}
    if(data?.data){
      const localCurrent=db.currentPlayerId||null;
      db=data.data;
      db.currentPlayerId=localCurrent;
      localSave();
    }
    cloudReady=true;
    render();
  }catch(e){console.warn(e)}
}
let bat={result:null,detail:null,pos:null,rbi:0,runs:0,steals:0,cs:0};
let pitch={inningsOuts:0,bf:0,ab:0,pitches:0,hits:0,hr:0,sacBunt:0,sacFly:0,bb:0,hbp:0,k:0,wp:0,balk:0,runs:0,earnedRuns:0,decision:'',save:0};
function exportAppData(){
  if(!requireAdmin())return;
  const payload={schema:'tomakomai-futo-local-backup',version:'3.3',exportedAt:new Date().toISOString(),db,championshipPhoto:localStorage.getItem('tomakomai_futo_championship_photo')||null};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  const d=new Date().toISOString().slice(0,10);
  a.href=url;a.download=`tomakomai-futo-backup-${d}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  toast('バックアップを保存しました');
}
function importAppData(input){
  if(!requireAdmin())return;
  const f=input?.files?.[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const payload=JSON.parse(r.result);
      const compatible=(payload?.schema==='tomakomai-futo-local-backup'||payload?.format==='tomakomai-futo-backup');if(!compatible||!payload.db||!Array.isArray(payload.db.players)||!Array.isArray(payload.db.games))throw new Error('形式が違います');
      if(!confirm('このバックアップで現在のデータを置き換えます。現在のデータは上書きされます。続けますか？')){input.value='';return;}
      db=payload.db;
      if(payload.championshipPhoto)localStorage.setItem('tomakomai_futo_championship_photo',payload.championshipPhoto);else localStorage.removeItem('tomakomai_futo_championship_photo');
      save();applyChampionshipPhoto();input.value='';toast('バックアップを復元しました');render();
    }catch(e){input.value='';toast('バックアップの読み込みに失敗しました');alert('バックアップファイルを読み込めませんでした。');}
  };
  r.readAsText(f);
}
function seasonYearFromDate(date){const d=new Date((date||'')+'T00:00:00');if(Number.isNaN(d.getTime()))return 0;const y=d.getFullYear(),m=d.getMonth()+1;return m>=4?y:y-1;}
function currentSeasonYear(){const d=new Date();return d.getMonth()+1>=4?d.getFullYear():d.getFullYear()-1;}
function esc(x){return String(x??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function toast(x){let e=document.getElementById('toast');e.textContent=x;e.className='show';setTimeout(()=>e.className='',1600)}

function applyChampionshipPhoto(){const photo=localStorage.getItem("tomakomai_futo_championship_photo");document.documentElement.style.setProperty("--championship-photo",photo?`url("${photo}")`:'url("championship.jpg")');}
function setChampionshipPhoto(input){const f=input?.files?.[0];if(!f)return;if(!f.type.startsWith("image/"))return toast("画像ファイルを選択してください");const r=new FileReader();r.onload=()=>{localStorage.setItem("tomakomai_futo_championship_photo",r.result);applyChampionshipPhoto();toast("優勝集合写真を設定しました");render()};r.readAsDataURL(f)}
function clearChampionshipPhoto(){localStorage.removeItem("tomakomai_futo_championship_photo");applyChampionshipPhoto();toast("優勝集合写真を削除しました");render()}
function render(){applyChampionshipPhoto();let a=document.getElementById('app');({home:()=>a.innerHTML=home(),games:()=>a.innerHTML=games(),game:()=>a.innerHTML=gameForm(),players:()=>a.innerHTML=players(),player:()=>a.innerHTML=playerForm(),batting:()=>a.innerHTML=batting(),atbats:()=>a.innerHTML=atbats(),pitching:()=>a.innerHTML=pitching(),pitches:()=>a.innerHTML=pitches(),stats:()=>a.innerHTML=stats(),annual2026:()=>a.innerHTML=annual2026(),calendar:()=>a.innerHTML=calendar(),event:()=>a.innerHTML=eventForm(),settings:()=>a.innerHTML=settings(),selfplayer:()=>a.innerHTML=selfPlayer(),announcements:()=>a.innerHTML=announcements(),announcement:()=>a.innerHTML=announcementForm()})[screen]()}
function home(){
  const years=[...new Set([
    new Date().getFullYear(),
    ...db.games.map(g=>+g.year||+(g.date||'').slice(0,4)).filter(Boolean),
    ...db.events.map(e=>+(e.date||'').slice(0,4)).filter(Boolean)
  ])].sort((a,b)=>b-a);
  const y=window.homeYear||new Date().getFullYear();
  if(!years.includes(y)) window.homeYear=years[0];
  const year=window.homeYear||y;
  const season=db.games.filter(x=>(+x.year||+(x.date||'').slice(0,4))===year);
  const w=season.filter(x=>['勝','不戦勝'].includes(x.result)).length;
  const l=season.filter(x=>['負','不戦敗'].includes(x.result)).length;
  const d=season.filter(x=>x.result==='引分').length;
  const decided=w+l;
  const rate=decided?(w/decided).toFixed(3).replace(/^0/,''):'-';
  const sortedGames=season.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const today=new Date().toISOString().slice(0,10);
  const scheduleSort=(a,b)=>((a.date||'')+' '+(a.time||'')).localeCompare(((b.date||'')+' '+(b.time||'')));
  const upcomingPractice=db.events.filter(e=>(e.date||'')>=today&&e.kind==='練習').sort(scheduleSort)[0]||null;
  const upcomingGame=[
    ...db.games.filter(g=>(g.date||'')>=today).map(g=>({...g,_kind:'game',title:g.opponent||'試合'})),
    ...db.events.filter(e=>(e.date||'')>=today&&e.kind==='試合').map(e=>({...e,_kind:'event',title:e.note||'試合'}))
  ].sort(scheduleSort)[0]||null;
  const recent=sortedGames.slice(0,5);
  const announcements=db.announcements.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||((b.id||0)-(a.id||0))).slice(0,3);
  const gameBadge=g=>`<span class="home-badge ${g.type==='公式戦'?'official':''}">${esc(g.type||'試合')}</span>`;
  return `<section class="home-dashboard">
    <div class="home-cover">
      <div class="cover-photo baseball-photo" aria-hidden="true"></div>
      <div class="cover-overlay"></div>
      <div class="cover-content">
        <div class="cover-tools"><label class="cover-player-select"><span>👤 自分の選手を選択</span><select onchange="setCurrentPlayer(this.value)"><option value="">未設定</option><option value="admin" ${db.currentPlayerId==='admin'?'selected':''}>管理者</option>${db.players.map(p=>`<option value="${p.id}" ${db.currentPlayerId===p.id?'selected':''}>${esc(p.name)}（#${esc(p.number)}）</option>`).join('')}</select></label></div>
        <div class="home-summary-row home-summary-in-cover">
          <div class="slogan-photo-wrap"><div class="stadium-card home-stadium-card"><div class="stadium-art championship-photo"><span>仲間と、<br>最高の景色を。</span></div></div></div>
          <div class="season-board home-season-board">
            <div class="season-board-title"><span class="season-ball" aria-hidden="true">⚾</span><b>今季成績</b><span class="season-select-wrap"><select onchange="homeYear=+this.value;render()">${years.map(v=>`<option value="${v}" ${v===year?'selected':''}>${v}年度</option>`).join('')}</select></span></div>
            <div class="season-metrics"><div><span>勝</span><b>${w}</b></div><div><span>負</span><b>${l}</b></div><div><span>引分</span><b>${d}</b></div><div><span>勝率</span><b>${rate}</b></div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="home-dashboard-inner">
      
      <div class="home-main-actions">
        <button class="dashboard-action orange" onclick="screen='games';render()"><span class="dash-icon">▦</span><span><b>試合一覧</b><small>試合の確認・登録・編集・削除</small></span><em>›</em></button>
        <button class="dashboard-action green" onclick="screen='players';render()"><span class="dash-icon">♟</span><span><b>選手一覧</b><small>選手の確認・登録・編集・削除</small></span><em>›</em></button>
        <button class="dashboard-action blue" onclick="screen='stats';render()"><span class="dash-icon">▥</span><span><b>成績を見る</b><small>今季成績・打撃成績・投手成績</small></span><em>›</em></button>
        <button class="dashboard-action purple" onclick="screen='calendar';render()"><span class="dash-icon">▦</span><span><b>カレンダー</b><small>予定の確認・登録・編集・削除</small></span><em>›</em></button>
      </div>

      <div class="dashboard-panel schedule-panel"><div class="schedule-title"><h3>▣ 今後の予定</h3><button onclick="screen='calendar';render()">もっと見る ›</button></div><div class="schedule-grid schedule-grid-two">${upcomingPractice?`<button class="schedule-item" onclick="eventId=${upcomingPractice.id};upcomingOnly=true;screen='event';render()"><div><b>${esc((upcomingPractice.date||'').slice(5).replace('-','/'))}</b><span class="schedule-badge practice">練習</span></div><strong>${esc(upcomingPractice.note||'練習')}</strong><small>${esc(((upcomingPractice.time||'')+' '+(upcomingPractice.venue||'')).trim())}</small></button>`:`<div class="schedule-item schedule-empty-item"><div><span class="schedule-badge practice">練習</span></div><strong>予定なし</strong><small>今後の練習予定はありません。</small></div>`}${upcomingGame?`<button class="schedule-item" onclick="${upcomingGame._kind==='game'?`gameId=${upcomingGame.id};screen='atbats';render()`: `eventId=${upcomingGame.id};upcomingOnly=true;screen='event';render()`}"><div><b>${esc((upcomingGame.date||'').slice(5).replace('-','/'))}</b><span class="schedule-badge game">${esc(upcomingGame.type||'試合')}</span></div><strong>${esc(upcomingGame._kind==='game'?(upcomingGame.opponent||'試合'):(upcomingGame.note||'試合'))}</strong><small>${esc(upcomingGame._kind==='game'?((upcomingGame.time||'')+' '+(upcomingGame.venue||upcomingGame.tournament||'')).trim():((upcomingGame.time||'')+' '+(upcomingGame.venue||'')).trim())}</small></button>`:`<div class="schedule-item schedule-empty-item"><div><span class="schedule-badge game">試合</span></div><strong>予定なし</strong><small>今後の試合予定はありません。</small></div>`}</div></div>

      <div class="dashboard-panel notice-panel"><div class="panel-heading"><h3>📣 お知らせ</h3><button onclick="screen='announcements';render()">もっと見る ›</button></div>${announcements.length?announcements.map(e=>`<div class="notice-row"><b>${esc((e.date||'').slice(5).replace('-','/'))}</b><span>${esc(e.text||e.title)}</span></div>`).join(''):'<div class="dashboard-empty">お知らせはありません。</div>'}</div>
    </div>
  </section>`;
}
function games(){return `<section class=screen><div class=row><h2>試合一覧</h2>${admin?`<button class=primary onclick="screen='game';gameId=null;render()">＋ 試合を登録</button>`:''}</div>${db.games.length?db.games.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(g=>`<div class=item onclick="gameId=${g.id};screen='atbats';render()"><div class=row><span class="badge ${g.type==='公式戦'?'official':''}">${g.type}</span><span>${g.year||((g.date||'').slice(0,4))}年度　${g.date}</span></div><div class=row><h3>${esc(g.opponent||'相手未入力')}</h3>${admin?`<div><button class=secondary onclick="event.stopPropagation();gameId=${g.id};screen='game';render()">修正</button><button class=secondary onclick="event.stopPropagation();deleteGame(${g.id})">削除</button></div>`:''}</div><div class=row><span>${esc(g.tournament||'')}</span><b class=score>${g.runs}-${g.against}</b></div></div>`).join(''):'<div class=empty>まだ試合がありません。<br>「＋登録」から登録してください。</div>'}</section>`}
function deleteGame(id){if(!requireAdmin())return;let g=db.games.find(x=>x.id===id);if(!g)return;if(!confirm(`${g.date||''} ${g.opponent||'相手未入力'} の試合を削除しますか？\n打席・投球記録も削除されます。`))return;db.games=db.games.filter(x=>x.id!==id);db.atBats=db.atBats.filter(x=>x.gameId!==id);db.pitches=db.pitches.filter(x=>x.gameId!==id);save();toast('試合を削除しました');render()}
function gameForm(){let g=db.games.find(x=>x.id===gameId);let edit=!!g;return `<section class=screen><button class=secondary onclick="screen='games';render()">← 戻る</button><h2>${edit?'試合を修正':'試合を登録'}</h2><div class=card><div class=field><label>試合区分</label><select id=gtype><option value="公式戦" ${g?.type==='公式戦'?'selected':''}>公式戦</option><option value="練習試合" ${g?.type==='練習試合'?'selected':''}>練習試合</option></select></div><div class=field><label>年度</label><select id=gyear ${admin?'':'disabled'}>${Array.from({length:7},(_,i)=>new Date().getFullYear()+2-i).map(y=>`<option value="${y}" ${String(g?.year||((g?.date||new Date().toISOString().slice(0,10)).slice(0,4)))===String(y)?'selected':''}>${y}年度</option>`).join('')}</select></div><div class=field><label>日付</label><input id=gdate ${admin?'':'disabled'} type=date value="${g?.date||new Date().toISOString().slice(0,10)}"></div><div class=field><label>大会・イベント名</label><input id=gtournament ${admin?'':'disabled'} placeholder="例：支部A級大会" value="${esc(g?.tournament||'')}"></div><div class=field><label>球場</label><input id=gvenue ${admin?'':'disabled'} placeholder="例：とましんスタジアム" value="${esc(g?.venue||'')}"></div><div class=field><label>相手チーム</label><input id=gopp ${admin?'':'disabled'} placeholder="相手チーム名" value="${esc(g?.opponent||'')}"></div><div class=field><label>結果</label><select id=gresult><option ${g?.result==='勝'?'selected':''}>勝</option><option ${g?.result==='負'?'selected':''}>負</option><option ${g?.result==='引分'?'selected':''}>引分</option><option ${g?.result==='不戦勝'?'selected':''}>不戦勝</option><option ${g?.result==='不戦敗'?'selected':''}>不戦敗</option></select></div><div class=row><div class=field><label>得点</label><input id=gruns ${admin?'':'disabled'} type=number min=0 value="${g?.runs??0}"></div><div class=field><label>失点</label><input id=gagainst ${admin?'':'disabled'} type=number min=0 value="${g?.against??0}"></div></div>${admin?`<button class=primary onclick="saveGame()">${edit?'この試合を修正':'この試合を登録'}</button>`:`<p class=muted>閲覧モード：試合データの変更は管理者のみ可能です。</p>`}${edit&&admin?`<button class=secondary onclick="if(confirm('この試合を削除しますか？打席・投球記録も削除されます。')){db.games=db.games.filter(x=>x.id!==gameId);db.atBats=db.atBats.filter(x=>x.gameId!==gameId);db.pitches=db.pitches.filter(x=>x.gameId!==gameId);save();gameId=null;screen='games';toast('試合を削除しました');render()}">この試合を削除</button>`:''}</div></section>`}
function saveGame(){if(!requireAdmin())return;let g={id:gameId||Date.now(),year:+document.getElementById('gyear').value,type:document.getElementById('gtype').value,date:document.getElementById('gdate').value,tournament:document.getElementById('gtournament').value.trim(),venue:document.getElementById('gvenue').value.trim(),opponent:document.getElementById('gopp').value.trim(),result:document.getElementById('gresult').value,runs:+document.getElementById('gruns').value,against:+document.getElementById('gagainst').value};let edit=!!db.games.find(x=>x.id===g.id);if(edit){db.games=db.games.map(x=>x.id===g.id?g:x);toast('試合を修正しました')}else{db.games.push(g);toast('試合を登録しました')}save();gameId=g.id;screen='atbats';render()}
function players(){const list=db.players.slice().sort((a,b)=>{const na=Number(a.number),nb=Number(b.number);const rank=n=>n===30?0:n===10?1:2;return rank(na)-rank(nb)||na-nb||String(a.name).localeCompare(String(b.name),'ja')});return `<section class=screen><div class=row><div><h2>選手一覧</h2></div>${admin?`<button class=primary onclick="screen='player';playerId=null;render()">＋ 選手を登録</button>`:''}</div>${list.map(p=>`<div class=item><div class=row><div><span class=badge>背番号 ${esc(p.number)}</span><span class=position-badge>${esc(p.position||'未設定')}</span><h3>${esc(p.name)}</h3></div><div class=row>${admin?`<button class=secondary onclick="playerId=${p.id};screen='player';render()">修正</button><button class=secondary onclick="deletePlayer(${p.id})">削除</button>`:''}</div></div></div>`).join('')}</section>`}
function deletePlayer(id){if(!requireAdmin())return;let p=db.players.find(x=>x.id===id);if(!p)return;if(!confirm(`${p.name}（背番号${p.number}）を削除しますか？\n登録済みの打席・投球記録も削除されます。`))return;db.players=db.players.filter(x=>x.id!==id);db.atBats=db.atBats.filter(x=>x.playerId!==id);db.pitches=db.pitches.filter(x=>x.playerId!==id);save();toast('選手を削除しました');render()}
function playerForm(){let p=db.players.find(x=>x.id===playerId);let edit=!!p;return `<section class=screen><button class=secondary onclick="screen='players';render()">← 戻る</button><h2>${edit?'選手情報を修正':'選手を登録'}</h2><div class=card><div class=field><label>背番号</label><input id=pnum ${admin?'':'disabled'} type=number min=0 value="${esc(p?.number||'')}"></div><div class=field><label>氏名</label><input id=pname ${admin?'':'disabled'} placeholder="例：佐藤 太郎" value="${esc(p?.name||'')}"></div><div class=field><label>ポジション区分</label><select id=pposition ${admin?'':'disabled'}><option value="" ${!p?.position?'selected':''}>未設定</option><option value="投手" ${p?.position==='投手'?'selected':''}>投手</option><option value="捕手" ${p?.position==='捕手'?'selected':''}>捕手</option><option value="内野手" ${p?.position==='内野手'?'selected':''}>内野手</option><option value="外野手" ${p?.position==='外野手'?'selected':''}>外野手</option></select></div>${admin?`<button class=primary onclick="savePlayer()">${edit?'この選手を修正':'登録する'}</button>`:`<p class=muted>閲覧モード：選手情報の変更は管理者のみ可能です。</p>`}</div></section>`}
function savePlayer(){if(!requireAdmin())return;let name=document.getElementById('pname').value.trim();let number=document.getElementById('pnum').value;let position=document.getElementById('pposition').value;if(!name)return toast('氏名を入力してください');if(playerId){db.players=db.players.map(p=>p.id===playerId?{...p,name,number,position}:p);toast('選手情報を修正しました')}else{db.players.push({id:Date.now(),name,number,position});toast('選手を登録しました')}save();screen='players';render()}
function resetBat(){bat={result:null,detail:null,pos:null,rbi:0,runs:0,steals:0,cs:0};batEditId=null}
function batting(){let g=db.games.find(x=>x.id===gameId);if(!playerId)playerId=db.players[0]?.id;let editing=!!batEditId;const batted=['ゴロ','フライ','ライナー'];return `<section class=screen><button class=secondary onclick="screen='atbats';resetBat();render()">← 打席履歴</button><div class=card><b>${esc(g?.opponent)}</b>　<span class=badge>${g?.type}</span><p>${g?.date}　${g?.runs}-${g?.against}</p></div><div class=card>${!admin?'<p class=muted>🔒 閲覧モード：打席の変更は管理者のみ可能です。</p>':''}<div class=field><label>打者</label><select onchange="playerId=+this.value;render()">${db.players.map(p=>`<option value=${p.id} ${p.id===playerId?'selected':''}>${esc(p.number)}　${esc(p.name)}</option>`).join('')}</select></div><h3>① 打席結果 ${editing?'（修正中）':''}</h3><div class=result-grid>${['単打','二塁打','三塁打','本塁打','四球','死球','三振','ゴロ','フライ','ライナー','犠打','犠飛','野選','エラー'].map(x=>`<button class="result ${bat.result===x?'active':''}" onclick="choose('${x}')">${x}</button>`).join('')}</div>${batted.includes(bat.result)?`<h3>② 守備位置</h3><div class=subgrid>${['投手','捕手','一塁','二塁','三塁','遊撃','左翼','中堅','右翼'].map(x=>`<button class="sub ${bat.pos===x?'active':''}" onclick="bat.pos='${x}';render()">${x}</button>`).join('')}</div>`:''}<h3>打点・得点・走塁</h3>${counter('rbi','打点')}${counter('runs','得点')}${counter('steals','盗塁')}${counter('cs','盗塁死')}${admin?`<button class=primary onclick="saveAtBat()">${editing?'この打席を修正':'この打席を登録'}</button>`:`<p class=muted>閲覧モード：打席結果の変更は管理者のみ可能です。</p>`}${editing?`<button class=secondary onclick="resetBat();screen='atbats';render()">修正をやめる</button>`:''}</div></section>`}
function counter(k,n){return `<div class=counter><span>${n}</span><button onclick="bat.${k}=Math.max(0,bat.${k}-1);render()">−</button><b>${bat[k]}</b><button onclick="bat.${k}++;render()">＋</button></div>`}
function choose(x){bat.result=x;bat.detail=null;bat.pos=null;render()}
function saveAtBat(){if(!requireAdmin())return;if(!bat.result)return toast('打席結果を選んでください');if(['ゴロ','フライ','ライナー'].includes(bat.result)&&!bat.pos)return toast('守備位置を選んでください');let rec={id:batEditId||Date.now(),gameId,playerId,...bat};if(batEditId){db.atBats=db.atBats.map(x=>x.id===batEditId?rec:x);toast('打席を修正しました')}else{db.atBats.push(rec);toast('打席を登録しました')}save();resetBat();screen='atbats';render()}
function editAtBat(id){if(!requireAdmin())return;let x=db.atBats.find(a=>a.id===id);if(!x)return;batEditId=id;playerId=x.playerId;bat={result:x.result,detail:null,pos:x.pos||null,rbi:+x.rbi||0,runs:+x.runs||0,steals:+x.steals||0,cs:+x.cs||0};screen='batting';render()}
function deleteAtBat(id){if(!requireAdmin())return;if(!confirm('この打席結果を削除しますか？'))return;db.atBats=db.atBats.filter(x=>x.id!==id);save();toast('打席結果を削除しました');render()}
function atbats(){let g=db.games.find(x=>x.id===gameId),a=db.atBats.filter(x=>x.gameId===gameId);return `<section class=screen><div class=row><button class=secondary onclick="screen='games';render()">← 試合一覧</button><div>${admin?`<button class=secondary onclick="screen='batting';render()">＋ 打席入力</button>`:''}<button class=secondary onclick="screen='pitches';render()">投球成績</button></div></div><div class=card><b>${esc(g?.opponent)}</b>　${g?.type}<div class=score>${g?.runs}-${g?.against}</div></div>${a.length?a.slice().reverse().map(x=>{let p=db.players.find(q=>q.id===x.playerId);return `<div class=item><div class=row><b>${esc(p?.name||'選手')}</b><b>${x.result}</b></div><small>${x.detail?x.detail+'・'+x.pos:''}　打点${x.rbi}　得点${x.runs}　盗塁${x.steals}　盗塁死${x.cs}</small><div class=row><span></span><div>${admin?`<button class=secondary onclick="editAtBat(${x.id})">修正</button><button class=secondary onclick="deleteAtBat(${x.id})">削除</button>`:''}</div></div></div>`}).join(''):'<div class=empty>まだ打席がありません。</div>'}</section>`}
function resetPitch(){pitch={inningsOuts:0,bf:0,ab:0,pitches:0,hits:0,hr:0,sacBunt:0,sacFly:0,bb:0,hbp:0,k:0,wp:0,balk:0,runs:0,earnedRuns:0,decision:'',save:0};pitchEditId=null}
function ipText(outs){let w=Math.floor((outs||0)/3),t=(outs||0)%3;return `${w}回${t?`${t}/3`:''}`}
function pitching(){let g=db.games.find(x=>x.id===gameId);if(!playerId)playerId=db.players[0]?.id;let editing=!!pitchEditId;let p=pitch;return `<section class=screen><button class=secondary onclick="screen='pitches';resetPitch();render()">← 投球履歴</button><div class=card><b>${esc(g?.opponent)}</b>　<span class=badge>${g?.type}</span><p>${g?.date}　${g?.runs}-${g?.against}</p></div><div class=card>${!admin?'<p class=muted>🔒 閲覧モード：投球結果の変更は管理者のみ可能です。</p>':''}<h3>${editing?'投球結果を修正':'投球結果を入力'}</h3><div class=field><label>投手</label><select onchange="playerId=+this.value;render()">${db.players.map(x=>`<option value=${x.id} ${x.id===playerId?'selected':''}>${esc(x.number)}　${esc(x.name)}</option>`).join('')}</select></div><div class=field><label>投球回</label><div class=row><input id=ipWhole type=number min=0 value="${Math.floor(p.inningsOuts/3)}" style="width:90px"><select id=ipThird style="width:120px"><option value=0 ${p.inningsOuts%3===0?'selected':''}>0/3</option><option value=1 ${p.inningsOuts%3===1?'selected':''}>1/3</option><option value=2 ${p.inningsOuts%3===2?'selected':''}>2/3</option></select></div></div>${pitchField('bf','打者')}${pitchField('ab','打数')}${pitchField('pitches','投球数')}${pitchField('hits','安打')}${pitchField('hr','本塁打')}${pitchField('sacBunt','犠打')}${pitchField('sacFly','犠飛')}${pitchField('bb','四球')}${pitchField('hbp','死球')}${pitchField('k','三振')}${pitchField('wp','暴投')}${pitchField('balk','ボーク')}${pitchField('runs','失点')}${pitchField('earnedRuns','自責点')}<div class=field><label>勝敗</label><select id=pdecision><option value="" ${!p.decision?'selected':''}>なし</option><option value="勝" ${p.decision==='勝'?'selected':''}>勝</option><option value="敗" ${p.decision==='敗'?'selected':''}>敗</option></select></div><div class=field><label>セーブ</label><select id=psave><option value=0 ${!p.save?'selected':''}>なし</option><option value=1 ${p.save?'selected':''}>1S</option></select></div>${admin?`<button class=primary onclick="savePitch()">${editing?'この投球結果を修正':'この投球結果を登録'}</button>`:`<p class=muted>閲覧モード：投球結果の変更は管理者のみ可能です。</p>`}${editing?`<button class=secondary onclick="resetPitch();screen='pitches';render()">修正をやめる</button>`:''}</div></section>`}
function pitchField(k,label){return `<div class=field><label>${label}</label><input id=pf_${k} type=number min=0 value="${pitch[k]??0}"></div>`}
function savePitch(){if(!requireAdmin())return;let whole=Math.max(0,parseInt(document.getElementById('ipWhole').value||0)),third=+document.getElementById('ipThird').value;let rec={id:pitchEditId||Date.now(),gameId,playerId,inningsOuts:whole*3+third,bf:+document.getElementById('pf_bf').value||0,ab:+document.getElementById('pf_ab').value||0,pitches:+document.getElementById('pf_pitches').value||0,hits:+document.getElementById('pf_hits').value||0,hr:+document.getElementById('pf_hr').value||0,sacBunt:+document.getElementById('pf_sacBunt').value||0,sacFly:+document.getElementById('pf_sacFly').value||0,bb:+document.getElementById('pf_bb').value||0,hbp:+document.getElementById('pf_hbp').value||0,k:+document.getElementById('pf_k').value||0,wp:+document.getElementById('pf_wp').value||0,balk:+document.getElementById('pf_balk').value||0,runs:+document.getElementById('pf_runs').value||0,earnedRuns:+document.getElementById('pf_earnedRuns').value||0,decision:document.getElementById('pdecision').value,save:+document.getElementById('psave').value};if(pitchEditId){db.pitches=db.pitches.map(x=>x.id===pitchEditId?rec:x);toast('投球結果を修正しました')}else{db.pitches.push(rec);toast('投球結果を登録しました')}save();resetPitch();screen='pitches';render()}
function editPitch(id){if(!requireAdmin())return;let x=db.pitches.find(a=>a.id===id);if(!x)return;pitchEditId=id;playerId=x.playerId;pitch={...pitch,...x};screen='pitching';render()}
function deletePitch(id){if(!requireAdmin())return;if(!confirm('この投球結果を削除しますか？'))return;db.pitches=db.pitches.filter(x=>x.id!==id);save();toast('投球結果を削除しました');render()}
function pitches(){let g=db.games.find(x=>x.id===gameId),a=db.pitches.filter(x=>x.gameId===gameId);return `<section class=screen><div class=row><button class=secondary onclick="screen='atbats';render()">← 打席履歴</button>${admin?`<button class=primary onclick="resetPitch();screen='pitching';render()">＋ 投球入力</button>`:''}</div><div class=card><b>${esc(g?.opponent)}</b>　${g?.type}<div class=score>${g?.runs}-${g?.against}</div></div>${a.length?a.slice().reverse().map(x=>{let p=db.players.find(q=>q.id===x.playerId);return `<div class=item><div class=row><b>${esc(p?.name||'投手')}</b><b>${ipText(x.inningsOuts)}</b></div><small>打者${x.bf}　投球${x.pitches}　安打${x.hits}　四球${x.bb}　死球${x.hbp}　三振${x.k}　失点${x.runs}　自責${x.earnedRuns}　${x.decision||''}${x.save?'　S':''}</small><div class=row><span></span><div>${admin?`<button class=secondary onclick="editPitch(${x.id})">修正</button><button class=secondary onclick="deletePitch(${x.id})">削除</button>`:''}</div></div></div>`}).join(''):'<div class=empty>まだ投球結果がありません。</div>'}</section>`}
function annual2026Active(){const y=db.annualStats?.[2026];return !!(y && (y.active || y.locked || y.teamGames>0 || Object.keys(y.players||{}).length));}
function annualPlayer(id){return db.annualStats?.[2026]?.players?.[id]||null;}
function annualNum(v){const n=Number(v);return Number.isFinite(n)?n:0}
const BAT_ANNUAL_FIELDS=[['games','試合'],['pa','打席'],['ab','打数'],['runs','得点'],['h','安打'],['d2','二塁打'],['d3','三塁打'],['hr','本塁打'],['rbi','打点'],['steals','盗塁'],['sacBunt','犠打'],['sacFly','犠飛'],['bbHbp','四死球'],['k','三振'],['errors','失策'],['rispAB','得点圏打数'],['rispH','得点圏安打'],['pitches','投球数']];
const PITCH_ANNUAL_FIELDS=[['games','登板'],['w','勝'],['l','敗'],['s','セーブ'],['bf','打者'],['ab','打数'],['pitches','投球数'],['hits','安打'],['hr','本塁打'],['sacBunt','犠打'],['sacFly','犠飛'],['bb','四球'],['hbp','死球'],['k','三振'],['wp','暴投'],['balk','ボーク'],['runs','失点'],['earnedRuns','自責点']];
function annualInput(field,label,value,step=1,disabled=false){return `<div class="annual-input"><label>${label}</label><input type="number" min="0" step="${step}" data-field="${field}" value="${annualNum(value)}" ${disabled?'disabled':''}></div>`}
function annualIpInputs(outs,locked){const o=annualNum(outs),whole=Math.floor(o/3),third=o%3;return `<div class=annual-input><label>投球回</label><div class=annual-ip-row><input type=number min=0 id=annual_ip_whole data-annual-ip-whole value="${whole}" ${locked?'disabled':''}><span>回</span><select id=annual_ip_third data-annual-ip-third ${locked?'disabled':''}><option value=0 ${third===0?'selected':''}>0/3</option><option value=1 ${third===1?'selected':''}>1/3</option><option value=2 ${third===2?'selected':''}>2/3</option></select></div><small class=muted>投球回はイニング数＋1/3・2/3で入力</small></div>`}
function annual2026(){
  if(!requireAdmin()) {screen='settings';render();return '';}
  const y=db.annualStats[2026];
  const locked=!!y.locked;
  const teamGames=y.teamGames||db.games.filter(g=>gameYear(g.id)===2026).length;
  const rows=db.players.map(p=>{const b=y.players?.[p.id]?.batting||{},q=y.players?.[p.id]?.pitching||{};const batFields=BAT_ANNUAL_FIELDS.map(([f,l,st])=>annualInput(f,l,f==='bbHbp'?annualNum(b.bb)+annualNum(b.hbp):b[f],st||1,locked)).join('');return `<div class="annual-player-card" data-player-id="${p.id}"><div class="annual-player-head"><b>${esc(p.name)}（#${esc(p.number)}）</b></div><h4>打者成績</h4><div class="annual-grid">${batFields}</div><h4>投手成績</h4><div class="annual-grid">${annualIpInputs(q.outs,locked)}${PITCH_ANNUAL_FIELDS.map(([f,l])=>annualInput('p_'+f,l,q[f],1,locked)).join('')}</div></div>`}).join('');
  return `<section class="screen"><div class="row"><button class="secondary" onclick="screen='settings';render()">← 設定</button><h2>2026年度一括入力</h2></div><div class="card"><h3>🔒 ${locked?'確定済み':'シーズン終了データ'}</h3><p class="muted">2026年度の年間成績を入力します。確定してロックすると、以後この画面から編集できません。</p><div class="field"><label>2026年度 チーム試合数</label><input id="annualTeamGames" type="number" min="0" value="${teamGames}" ${locked?'disabled':''}></div>${locked?`<div class="notice-box"><b>2026年度成績は確定・ロックされています。</b><br>管理者が設定画面からロック解除できます。</div>`:''}</div>${rows}${locked?'':`<div class="card"><button class="primary" onclick="saveAnnual2026()">入力内容を保存</button><button class="secondary" style="width:100%;margin-top:8px" onclick="lockAnnual2026()">入力内容を確定してロック</button></div>`}</section>`;
}
function collectAnnual2026(){const y=db.annualStats[2026];y.teamGames=Math.max(0,annualNum(document.getElementById('annualTeamGames')?.value));y.active=true;y.players={};document.querySelectorAll('.annual-player-card').forEach(card=>{const p=db.players.find(x=>x.id===+card.dataset.playerId);if(!p)return;const batting={},pitching={};card.querySelectorAll('input[data-field]').forEach(inp=>{const f=inp.dataset.field;const v=annualNum(inp.value);if(f.startsWith('p_'))pitching[f.slice(2)]=v;else if(f==='bbHbp'){batting.bb=v;batting.hbp=0;}else batting[f]=v;});const whole=annualNum(card.querySelector('[data-annual-ip-whole]')?.value),third=annualNum(card.querySelector('[data-annual-ip-third]')?.value);pitching.outs=whole*3+Math.min(2,third);y.players[p.id]={batting,pitching};});}
function saveAnnual2026(){if(!requireAdmin())return;collectAnnual2026();save();toast('2026年度の一括入力を保存しました');render()}
function lockAnnual2026(){if(!requireAdmin())return;if(!confirm('2026年度の成績を確定してロックしますか？\nロック後は設定画面から解除するまで編集できません。'))return;collectAnnual2026();db.annualStats[2026].locked=true;db.annualStats[2026].active=true;save();toast('2026年度成績を確定・ロックしました');render()}
function unlockAnnual2026(){if(!requireAdmin())return;if(!confirm('2026年度成績のロックを解除しますか？'))return;db.annualStats[2026].locked=false;save();toast('2026年度成績のロックを解除しました');render()}

function calc(id,year=null){
  if(year===2026 && annual2026Active()){
    const b=annualPlayer(id)?.batting||{};const pa=annualNum(b.pa),ab=annualNum(b.ab),h=annualNum(b.h),d2=annualNum(b.d2),d3=annualNum(b.d3),hr=annualNum(b.hr),tb=h-d2-d3-hr+2*d2+3*d3+4*hr;
    const runs=annualNum(b.runs),rbi=annualNum(b.rbi),steals=annualNum(b.steals),sacBunt=annualNum(b.sacBunt),sacFly=annualNum(b.sacFly),bb=annualNum(b.bb),hbp=annualNum(b.hbp),k=annualNum(b.k),errors=annualNum(b.errors);
    const avg=ab?h/ab:0,slg=ab?tb/ab:0,obp=(ab+bb+hbp+sacFly)?(h+bb+hbp)/(ab+bb+hbp+sacFly):0,fmt=v=>v.toFixed(3).replace(/^0/,'');
    const rispAB=annualNum(b.rispAB),rispH=annualNum(b.rispH),rispAvg=rispAB?(rispH/rispAB).toFixed(3).replace(/^0/,''): '-',pitches=annualNum(b.pitches),pitchAvg=pa?(pitches/pa).toFixed(2):'-'; return {avg:fmt(avg),pa,ab,runs,h,d2,d3,hr,tb,rbi,steals,sacBunt,sacFly,bbHbp:bb+hbp,bb,hbp,k,errors,slg:fmt(slg),obp:fmt(obp),ops:fmt(slg+obp),rispAvg,rispAB,rispH,pitches,pitchAvg};
  }
  let a=db.atBats.filter(x=>x.playerId===id && (year==null || gameYear(x.gameId)===year));
  const isHit=x=>['単打','二塁打','三塁打','本塁打'].includes(x.result),isSac=x=>['犠打','犠飛'].includes(x.result),isBB=x=>['四球','死球'].includes(x.result),pa=a.length,ab=a.filter(x=>!isBB(x)&&!isSac(x)).length,h=a.filter(isHit).length,d2=a.filter(x=>x.result==='二塁打').length,d3=a.filter(x=>x.result==='三塁打').length,hr=a.filter(x=>x.result==='本塁打').length,tb=a.reduce((n,x)=>n+(x.result==='単打'?1:x.result==='二塁打'?2:x.result==='三塁打'?3:x.result==='本塁打'?4:0),0),runs=a.reduce((n,x)=>n+(+x.runs||0),0),rbi=a.reduce((n,x)=>n+(+x.rbi||0),0),steals=a.reduce((n,x)=>n+(+x.steals||0),0),sacBunt=a.filter(x=>x.result==='犠打').length,sacFly=a.filter(x=>x.result==='犠飛').length,bbHbp=a.filter(isBB).length,k=a.filter(x=>x.result==='三振').length,errors=a.filter(x=>x.result==='エラー').length,avg=ab?h/ab:0,slg=ab?tb/ab:0,obp=(ab+bbHbp+sacFly)?(h+bbHbp)/(ab+bbHbp+sacFly):0,fmt=v=>v.toFixed(3).replace(/^0/,'');
  return {avg:fmt(avg),pa,ab,runs,h,d2,d3,hr,tb,rbi,steals,sacBunt,sacFly,bbHbp,bb: a.filter(x=>x.result==='四球').length,hbp:a.filter(x=>x.result==='死球').length,k,errors,slg:fmt(slg),obp:fmt(obp),ops:fmt(slg+obp),rispAvg:'-',rispAB:'-',rispH:'-',pitches:'-',pitchAvg:'-'};
}
function pitchCalc(id,year=null){
  if(year===2026 && annual2026Active()){
    const b=annualPlayer(id)?.pitching||{},outs=annualNum(b.outs),er=annualNum(b.earnedRuns),era=outs?(er*27/outs).toFixed(2):'-';
    return {games:annualNum(b.games),w:annualNum(b.w),l:annualNum(b.l),s:annualNum(b.s),outs,era,bf:annualNum(b.bf),ab:annualNum(b.ab),pitches:annualNum(b.pitches),hits:annualNum(b.hits),hr:annualNum(b.hr),sacBunt:annualNum(b.sacBunt),sacFly:annualNum(b.sacFly),bb:annualNum(b.bb),hbp:annualNum(b.hbp),k:annualNum(b.k),wp:annualNum(b.wp),balk:annualNum(b.balk),runs:annualNum(b.runs),earnedRuns:er};
  }
  let a=db.pitches.filter(x=>x.playerId===id && (year==null || gameYear(x.gameId)===year)),outs=a.reduce((n,x)=>n+(x.inningsOuts||0),0),er=a.reduce((n,x)=>n+(x.earnedRuns||0),0),era=outs?(er*27/outs).toFixed(2):'-';return{games:new Set(a.map(x=>x.gameId)).size,w:a.filter(x=>x.decision==='勝').length,l:a.filter(x=>x.decision==='敗').length,s:a.reduce((n,x)=>n+(x.save||0),0),outs,era,bf:a.reduce((n,x)=>n+(x.bf||0),0),ab:a.reduce((n,x)=>n+(x.ab||0),0),pitches:a.reduce((n,x)=>n+(x.pitches||0),0),hits:a.reduce((n,x)=>n+(x.hits||0),0),hr:a.reduce((n,x)=>n+(x.hr||0),0),sacBunt:a.reduce((n,x)=>n+(x.sacBunt||0),0),sacFly:a.reduce((n,x)=>n+(x.sacFly||0),0),bb:a.reduce((n,x)=>n+(x.bb||0),0),hbp:a.reduce((n,x)=>n+(x.hbp||0),0),k:a.reduce((n,x)=>n+(x.k||0),0),wp:a.reduce((n,x)=>n+(x.wp||0),0),balk:a.reduce((n,x)=>n+(x.balk||0),0),runs:a.reduce((n,x)=>n+(x.runs||0),0),earnedRuns:er}
}
function stats(){
  const defaultYear=currentSeasonYear();
  const availableYears=[...new Set([defaultYear,...Object.keys(db.annualStats||{}).map(Number),...db.games.map(g=>gameYear(g.id)).filter(Boolean)])].sort((a,b)=>b-a);
  const year=availableYears.includes(window.statsYear)?window.statsYear:defaultYear;
  window.statsYear=year;
  const seasonGames=db.games.filter(g=>(+g.year||+(g.date||'').slice(0,4))===year);
  const teamGames=(year===2026 && annual2026Active() && db.annualStats[2026].teamGames!=null)?annualNum(db.annualStats[2026].teamGames):seasonGames.length;
  const battingReq=teamGames*2.7, pitchingReq=teamGames*0.8;
  const rowsBat=db.players.map(p=>{const s=calc(p.id,year);const games=(year===2026&&annual2026Active())?annualNum(annualPlayer(p.id)?.batting?.games||0):new Set(db.atBats.filter(x=>x.playerId===p.id && gameYear(x.gameId)===year).map(x=>x.gameId)).size;return {...s,p,games,qualified:s.pa>battingReq};}).filter(x=>x.games>0);
  const rowsPitch=db.players.map(p=>{const s=pitchCalc(p.id,year);return {...s,p,qualified:s.outs>pitchingReq*3};}).filter(x=>x.games>0);
  const sortNum=(v)=>v==='-'?-Infinity:+v;
  const qbat=rowsBat.filter(x=>x.qualified).sort((a,b)=>sortNum(b.avg)-sortNum(a.avg)||b.pa-a.pa||a.p.number.localeCompare(b.p.number));
  const uBat=rowsBat.filter(x=>!x.qualified).sort((a,b)=>b.pa-a.pa||sortNum(b.avg)-sortNum(a.avg)||a.p.number.localeCompare(b.p.number));
  const qpitch=rowsPitch.filter(x=>x.qualified).sort((a,b)=>sortNum(a.era)-sortNum(b.era)||b.outs-a.outs||a.p.number.localeCompare(b.p.number));
  const uPitch=rowsPitch.filter(x=>!x.qualified).sort((a,b)=>b.outs-a.outs||sortNum(a.era)-sortNum(b.era)||a.p.number.localeCompare(b.p.number));
  const leaderClass=(x,key,source,mode='max')=>{const vals=source.map(v=>annualNum(v[key])).filter(v=>Number.isFinite(v));if(!vals.length)return '';const best=mode==='min'?Math.min(...vals):Math.max(...vals);if(best===0)return '';return annualNum(x[key])===best?' top-stat':''};
  const batLeaders={};
  ['games','pa','ab','runs','h','d2','d3','hr','tb','rbi','steals','sacBunt','sacFly','bbHbp','k','errors','rispAB','rispH','pitches'].forEach(k=>batLeaders[k]=rowsBat);
  ['avg','slg','obp','ops','rispAvg','pitchAvg'].forEach(k=>batLeaders[k]=qbat);
  const pitchLeaders={};
  ['games','w','l','s','outs','bf','ab','pitches','hits','hr','sacBunt','sacFly','bb','hbp','k','wp','balk','runs','earnedRuns'].forEach(k=>pitchLeaders[k]=rowsPitch);
  pitchLeaders.era=qpitch;
  const batTable=rows=>rows.map(x=>`<tr class="${x.qualified?'qualified':''}"><td>${esc(x.p.name)}(${esc(x.p.number)})</td><td class="${leaderClass(x,'avg',batLeaders.avg,'max')}"><b>${x.avg}</b></td><td class="${leaderClass(x,'games',batLeaders.games)}">${x.games}</td><td class="${leaderClass(x,'pa',batLeaders.pa)}">${x.pa}</td><td class="${leaderClass(x,'ab',batLeaders.ab)}">${x.ab}</td><td class="${leaderClass(x,'runs',batLeaders.runs)}">${x.runs}</td><td class="${leaderClass(x,'h',batLeaders.h)}">${x.h}</td><td class="${leaderClass(x,'d2',batLeaders.d2)}">${x.d2}</td><td class="${leaderClass(x,'d3',batLeaders.d3)}">${x.d3}</td><td class="${leaderClass(x,'hr',batLeaders.hr)}">${x.hr}</td><td class="${leaderClass(x,'tb',batLeaders.tb)}">${x.tb}</td><td class="${leaderClass(x,'rbi',batLeaders.rbi)}">${x.rbi}</td><td class="${leaderClass(x,'steals',batLeaders.steals)}">${x.steals}</td><td class="${leaderClass(x,'sacBunt',batLeaders.sacBunt)}">${x.sacBunt}</td><td class="${leaderClass(x,'sacFly',batLeaders.sacFly)}">${x.sacFly}</td><td class="${leaderClass(x,'bbHbp',batLeaders.bbHbp)}">${x.bbHbp}</td><td class="${leaderClass(x,'k',batLeaders.k)}">${x.k}</td><td class="${leaderClass(x,'errors',batLeaders.errors)}">${x.errors}</td><td class="${leaderClass(x,'slg',batLeaders.slg)}">${x.slg}</td><td class="${leaderClass(x,'obp',batLeaders.obp)}">${x.obp}</td><td class="${leaderClass(x,'ops',batLeaders.ops)}">${x.ops}</td><td class="${leaderClass(x,'rispAvg',batLeaders.rispAvg)}">${x.rispAvg}</td><td class="${leaderClass(x,'rispAB',batLeaders.rispAB)}">${x.rispAB}</td><td class="${leaderClass(x,'rispH',batLeaders.rispH)}">${x.rispH}</td><td class="${leaderClass(x,'pitches',batLeaders.pitches)}">${x.pitches}</td><td class="${leaderClass(x,'pitchAvg',batLeaders.pitchAvg)}">${x.pitchAvg}</td></tr>`).join('');
  const batAll=rowsBat.reduce((t,x)=>{for(const k of ['pa','ab','runs','h','d2','d3','hr','tb','rbi','steals','sacBunt','sacFly','bbHbp','k','errors','rispAB','rispH','pitches'])t[k]+=annualNum(x[k]);return t;},{pa:0,ab:0,runs:0,h:0,d2:0,d3:0,hr:0,tb:0,rbi:0,steals:0,sacBunt:0,sacFly:0,bbHbp:0,k:0,errors:0,rispAB:0,rispH:0,pitches:0});
  const batAvg=batAll.ab?batAll.h/batAll.ab:0,batSlg=batAll.ab?batAll.tb/batAll.ab:0,batObp=(batAll.ab+batAll.bbHbp+batAll.sacFly)?(batAll.h+batAll.bbHbp)/(batAll.ab+batAll.bbHbp+batAll.sacFly):0;
  const fmt3=v=>v.toFixed(3).replace(/^0/,'');
  const teamBatRow=`<tr class="team-total"><td><b>チーム計</b></td><td><b>${fmt3(batAvg)}</b></td><td>${teamGames}</td><td>${batAll.pa}</td><td>${batAll.ab}</td><td>${batAll.runs}</td><td>${batAll.h}</td><td>${batAll.d2}</td><td>${batAll.d3}</td><td>${batAll.hr}</td><td>${batAll.tb}</td><td>${batAll.rbi}</td><td>${batAll.steals}</td><td>${batAll.sacBunt}</td><td>${batAll.sacFly}</td><td>${batAll.bbHbp}</td><td>${batAll.k}</td><td>${batAll.errors}</td><td>${fmt3(batSlg)}</td><td>${fmt3(batObp)}</td><td>${fmt3(batSlg+batObp)}</td><td>${batAll.rispAB?fmt3(batAll.rispH/batAll.rispAB):'-'}</td><td>${batAll.rispAB}</td><td>${batAll.rispH}</td><td>${batAll.pitches}</td><td>${batAll.pa?(batAll.pitches/batAll.pa).toFixed(2):'-'}</td></tr>`;
  const pitchTable=rows=>rows.map(x=>`<tr class="${x.qualified?'qualified':''}"><td>${esc(x.p.name)}(${esc(x.p.number)})</td><td class="${leaderClass(x,'era',pitchLeaders.era,'min')}"><b>${x.era}</b></td><td class="${leaderClass(x,'games',pitchLeaders.games)}">${x.games}</td><td class="${leaderClass(x,'w',pitchLeaders.w)}">${x.w||''}</td><td class="${leaderClass(x,'l',pitchLeaders.l)}">${x.l||''}</td><td class="${leaderClass(x,'s',pitchLeaders.s)}">${x.s||''}</td><td class="${leaderClass(x,'outs',pitchLeaders.outs)}">${ipText(x.outs)}</td><td class="${leaderClass(x,'bf',pitchLeaders.bf)}">${x.bf}</td><td class="${leaderClass(x,'ab',pitchLeaders.ab)}">${x.ab}</td><td class="${leaderClass(x,'pitches',pitchLeaders.pitches)}">${x.pitches}</td><td class="${leaderClass(x,'hits',pitchLeaders.hits)}">${x.hits}</td><td class="${leaderClass(x,'hr',pitchLeaders.hr)}">${x.hr}</td><td class="${leaderClass(x,'sacBunt',pitchLeaders.sacBunt)}">${x.sacBunt}</td><td class="${leaderClass(x,'sacFly',pitchLeaders.sacFly)}">${x.sacFly}</td><td class="${leaderClass(x,'bb',pitchLeaders.bb)}">${x.bb}</td><td class="${leaderClass(x,'hbp',pitchLeaders.hbp)}">${x.hbp}</td><td class="${leaderClass(x,'k',pitchLeaders.k)}">${x.k}</td><td class="${leaderClass(x,'wp',pitchLeaders.wp)}">${x.wp}</td><td class="${leaderClass(x,'balk',pitchLeaders.balk)}">${x.balk}</td><td class="${leaderClass(x,'runs',pitchLeaders.runs)}">${x.runs}</td><td class="${leaderClass(x,'earnedRuns',pitchLeaders.earnedRuns)}">${x.earnedRuns}</td></tr>`).join('');
  const pitchAll=rowsPitch.reduce((t,x)=>{for(const k of ['outs','w','l','s','bf','ab','pitches','hits','hr','sacBunt','sacFly','bb','hbp','k','wp','balk','runs','earnedRuns'])t[k]+=annualNum(x[k]);return t;},{outs:0,w:0,l:0,s:0,bf:0,ab:0,pitches:0,hits:0,hr:0,sacBunt:0,sacFly:0,bb:0,hbp:0,k:0,wp:0,balk:0,runs:0,earnedRuns:0});
  const teamEra=pitchAll.outs?(pitchAll.earnedRuns*27/pitchAll.outs).toFixed(2):'-';
  const teamPitchRow=`<tr class="team-total"><td><b>チーム計</b></td><td><b>${teamEra}</b></td><td>${teamGames}</td><td>${pitchAll.w}</td><td>${pitchAll.l}</td><td>${pitchAll.s}</td><td>${ipText(pitchAll.outs)}</td><td>${pitchAll.bf}</td><td>${pitchAll.ab}</td><td>${pitchAll.pitches}</td><td>${pitchAll.hits}</td><td>${pitchAll.hr}</td><td>${pitchAll.sacBunt}</td><td>${pitchAll.sacFly}</td><td>${pitchAll.bb}</td><td>${pitchAll.hbp}</td><td>${pitchAll.k}</td><td>${pitchAll.wp}</td><td>${pitchAll.balk}</td><td>${pitchAll.runs}</td><td>${pitchAll.earnedRuns}</td></tr>`;
  return `<section class=screen><div class=row><h2>成績</h2><select onchange="statsYear=+this.value;render()">${availableYears.map(v=>`<option value="${v}" ${v===year?'selected':''}>${v}年度</option>`).join('')}</select></div>
  <div class="card"><h3>打撃成績</h3><p class=muted>チーム試合数 ${teamGames}試合 ／ 規定打席 <b>${battingReq.toFixed(1)}</b>打席（${teamGames}×2.7）。<br>規定打席を<strong>超えた選手</strong>を打率順で上位に表示しています。</p>
  <div class="stat-section-title">🏆 規定打席到達者（${qbat.length}名）</div><div class=tablewrap><table><tr><th>選手</th><th>打率</th><th>試合</th><th>打席数</th><th>打数</th><th>得点</th><th>安打</th><th>2塁打</th><th>3塁打</th><th>本塁打</th><th>塁打数</th><th>打点</th><th>盗塁</th><th>犠打</th><th>犠飛</th><th>四死球</th><th>三振</th><th>失策</th><th>長打率</th><th>出塁率</th><th>OPS</th><th>得点圏打率</th><th>得点圏打数</th><th>得点圏安打</th><th>投球数</th><th>/1打席平均</th></tr>${batTable(qbat)}</table></div>
  ${uBat.length?`<div class="stat-section-title muted-title">規定打席未到達者</div><div class=tablewrap><table><tr><th>選手</th><th>打率</th><th>試合</th><th>打席数</th><th>打数</th><th>得点</th><th>安打</th><th>2塁打</th><th>3塁打</th><th>本塁打</th><th>塁打数</th><th>打点</th><th>盗塁</th><th>犠打</th><th>犠飛</th><th>四死球</th><th>三振</th><th>失策</th><th>長打率</th><th>出塁率</th><th>OPS</th><th>得点圏打率</th><th>得点圏打数</th><th>得点圏安打</th><th>投球数</th><th>/1打席平均</th></tr>${batTable(uBat)}</table></div>`:''}<div class="tablewrap team-total-wrap"><table><tr><th>選手</th><th>打率</th><th>試合</th><th>打席数</th><th>打数</th><th>得点</th><th>安打</th><th>2塁打</th><th>3塁打</th><th>本塁打</th><th>塁打数</th><th>打点</th><th>盗塁</th><th>犠打</th><th>犠飛</th><th>四死球</th><th>三振</th><th>失策</th><th>長打率</th><th>出塁率</th><th>OPS</th><th>得点圏打率</th><th>得点圏打数</th><th>得点圏安打</th><th>投球数</th><th>/1打席平均</th></tr>${teamBatRow}</table></div></div>
  <div class="card"><h3>投手成績</h3><p class=muted>チーム試合数 ${teamGames}試合 ／ 規定投球回数 <b>${pitchingReq.toFixed(1)}</b>回（${teamGames}×0.8）。<br>規定投球回数を<strong>超えた投手</strong>を防御率順で上位に表示しています。</p>
  <div class="stat-section-title">🏆 規定投球回数到達者（${qpitch.length}名）</div><div class=tablewrap><table><tr><th>投手</th><th>防御率</th><th>試合</th><th>勝</th><th>敗</th><th>S（セーブ）</th><th>投球回</th><th>打者</th><th>打数</th><th>投球数</th><th>安打</th><th>本塁打</th><th>犠打</th><th>犠飛</th><th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr>${pitchTable(qpitch)}</table></div>
  ${uPitch.length?`<div class="stat-section-title muted-title">規定投球回数未到達者</div><div class=tablewrap><table><tr><th>投手</th><th>防御率</th><th>試合</th><th>勝</th><th>敗</th><th>S（セーブ）</th><th>投球回</th><th>打者</th><th>打数</th><th>投球数</th><th>安打</th><th>本塁打</th><th>犠打</th><th>犠飛</th><th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr>${pitchTable(uPitch)}</table></div>`:''}<div class="tablewrap team-total-wrap"><table><tr><th>投手</th><th>防御率</th><th>試合</th><th>勝</th><th>敗</th><th>S（セーブ）</th><th>投球回</th><th>打者</th><th>打数</th><th>投球数</th><th>安打</th><th>本塁打</th><th>犠打</th><th>犠飛</th><th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr>${teamPitchRow}</table></div></div></section>`;
}
function gameYear(gameId){const g=db.games.find(x=>x.id===gameId);if(g?.year)return +g.year;return seasonYearFromDate(g?.date)}

function calendar(){
  const first=new Date(calYear,calMonth,1), last=new Date(calYear,calMonth+1,0);
  const start=first.getDay(), days=last.getDate();
  let cells='';
  for(let i=0;i<start;i++) cells+='<div class="calcell emptyday"></div>';
  for(let d=1;d<=days;d++){
    const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const ev=db.events.filter(x=>x.date===ds);
    const gm=db.games.filter(x=>x.date===ds);
    cells+=`<div class="calcell"><b>${d}</b>${gm.map(g=>`<button class="calitem game" onclick="gameId=${g.id};screen='atbats';render()">⚾ ${esc(g.opponent||'試合')}</button>`).join('')}${ev.map(x=>`<button class="calitem ${x.kind==='練習'?'practice':'other'}" onclick="eventId=${x.id};upcomingOnly=false;screen='event';render()">${x.kind==='練習'?'🏃':x.kind==='試合'?'⚾':'📅'} ${esc(x.kind)}</button>`).join('')}</div>`;
  }
  return `<section class=screen><div class=row><button class=secondary onclick="calMonth--;if(calMonth<0){calMonth=11;calYear--};render()">‹</button><h2>${calYear}年 ${calMonth+1}月</h2><button class=secondary onclick="calMonth++;if(calMonth>11){calMonth=0;calYear++};render()">›</button></div><div class="card"><div class="calhead"><b>日</b><b>月</b><b>火</b><b>水</b><b>木</b><b>金</b><b>土</b></div><div class="calendar">${cells}</div></div>${admin?`<button class=primary onclick="eventId=null;screen='event';render()">＋ 予定を登録</button>`:''}<div class=card><b>この月の予定</b>${[...db.games.map(x=>({...x,_game:true,title:(x.opponent||'試合'),kind:'試合'})),...db.events].filter(x=>x.date?.startsWith(`${calYear}-${String(calMonth+1).padStart(2,'0')}`)).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<div class=item><div class=row><span>${x.date}</span><span class=badge>${x._game?(x.type||'試合'):x.kind}</span></div><b>${esc(x._game?(x.opponent||'試合'):(x.kind||'予定'))}</b>${x._game?`<div>${esc(x.opponent||'')} ${x.runs}-${x.against}</div>`:`<div>${esc(x.time||'')} ${esc(x.venue||'')}</div>${x.note?`<div class=muted>${esc(x.note)}</div>`:''}<div>参加 ${attendanceCount(x.id,'参加')}　欠席 ${attendanceCount(x.id,'欠席')}　未回答 ${attendanceCount(x.id,'未回答')}</div><div class=muted style="font-size:12px;line-height:1.7;margin-top:4px"><div><b>参加：</b>${esc(attendanceDisplay(x.id,'参加'))}</div><div><b>欠席：</b>${esc(attendanceDisplay(x.id,'欠席'))}</div><div><b>未回答：</b>${esc(attendanceDisplay(x.id,'未回答'))}</div></div>`}</div>`).join('')||'<div class=empty>予定はありません。</div>'}</div></section>`;
}
function playerSurname(name){const s=String(name||'').trim();return (s.split(/\s+/)[0]||s)}
function attendanceNames(id,status){const e=db.events.find(e=>e.id===id);const att=e?.attendance||{};return db.players.filter(p=>((att[p.id]||'未回答')===status)).map(p=>playerSurname(p.name)).join('、')||'なし'}
function attendanceDisplay(id,status){const e=db.events.find(e=>e.id===id);const att=e?.attendance||{};const notes=e?.attendanceNotes||{};const rows=db.players.filter(p=>((att[p.id]||'未回答')===status)).map(p=>{const name=playerSurname(p.name),note=String(notes[p.id]||'').trim();return note?`${name}（${note}）`:name});return rows.join('、')||'なし'}
function attendanceCount(id,status){return db.players.filter(p=>((db.events.find(e=>e.id===id)?.attendance||{})[p.id]||'未回答')===status).length}
function upcomingParticipantView(){
 const e=db.events.find(x=>x.id===eventId);
 if(!e) return `<section class=screen><button class=secondary onclick="screen='home';render()">← ホーム</button><div class=empty>予定が見つかりません。</div></section>`;
 const att=e.attendance||{};
 const participants=db.players.filter(p=>att[p.id]==='参加');
 return `<section class=screen><button class=secondary onclick="upcomingOnly=false;screen='home';render()">← ホーム</button><div class=card><div class=row><span class=badge>${esc(e.kind||'予定')}</span><b>${esc(e.date||'')}</b></div><h2 style="margin:12px 0 6px">${esc(e.note||e.kind||'予定')}</h2><div class=muted>${esc([e.time,e.venue].filter(Boolean).join('　'))}</div></div><div class=card><h3>参加者（${participants.length}名）</h3>${participants.length?`<div class=participant-list>${participants.map(p=>`<div class=participant-name><b>${esc(playerSurname(p.name))}</b><small>#${esc(p.number)}</small></div>`).join('')}</div>`:'<p class=muted>参加登録者はまだいません。</p>'}</div></section>`;
}
function eventForm(){
 if(upcomingOnly) return upcomingParticipantView();
 const e=db.events.find(x=>x.id===eventId), edit=!!e;
 const att=e?.attendance||{};
 const me=db.players.find(p=>p.id===db.currentPlayerId);
 const myStatus=me?(att[me.id]||'未回答'):'未設定';
 const statusOptions=['参加','欠席','未回答'];
 return `<section class=screen><button class=secondary onclick="screen='calendar';render()">← カレンダー</button><h2>${edit?'予定を修正':'予定を登録'}</h2><div class=card>
 <div class=field><label>区分</label><select id=ekind ${admin?'':'disabled'}><option ${e?.kind==='試合'?'selected':''}>試合</option><option ${e?.kind==='練習'?'selected':''}>練習</option><option ${e?.kind==='その他'?'selected':''}>その他</option></select></div>
 <div class=field><label>日付</label><input id=edate ${admin?'':'disabled'} type=date value="${e?.date||new Date().toISOString().slice(0,10)}"></div>
 <div class=field><label>時間</label><input id=etime ${admin?'':'disabled'} type=time value="${e?.time||''}"></div>
 <div class=field><label>場所</label><input id=evenue ${admin?'':'disabled'} value="${esc(e?.venue||'')}" placeholder="例：清水球場"></div>
 <div class=field><label>その他（特記事項）</label><textarea id=enote ${admin?'':'disabled'} rows=4 placeholder="連絡事項・集合時間・持ち物など">${esc(e?.note||'')}</textarea></div>
 ${admin?`<button class=primary onclick="saveEvent()">${edit?'この予定を修正':'この予定を登録'}</button>${edit?`<button class=secondary onclick="if(confirm('この予定を削除しますか？')){db.events=db.events.filter(x=>x.id!==eventId);save();eventId=null;screen='calendar';toast('予定を削除しました');render()}">この予定を削除</button>`:''}`:`<p class=muted>予定の登録・変更・削除は管理者のみできます。</p>`}</div>
 ${edit?`<div class=card><h3>自分の出欠</h3>${me?`<p><b>${esc(me.name)}</b>（#${esc(me.number)}）</p><div class=field><label>出欠</label><select onchange="setMyAttendance(this.value)">${statusOptions.map(x=>`<option ${myStatus===x?'selected':''}>${x}</option>`).join('')}</select></div><div class=field><label>備考</label><textarea id="myAttendanceNote" rows=3 placeholder="自由記載（例：仕事のため遅れて参加、送迎が必要 など）" onchange="setMyAttendanceNote(this.value)">${esc((e?.attendanceNotes||{})[me.id]||'')}</textarea></div><p class=muted>この端末に設定した「自分の選手」の出欠と備考だけ変更できます。</p>`:`<p class=muted>先に「設定」から自分の選手を設定してください。</p><button class=secondary onclick="screen='settings';render()">自分の選手を設定</button>`}</div>${admin?`<div class=card><h3>管理者用・全員の出欠</h3><p class=muted>管理者は各選手の出欠を変更できます。</p>${db.players.map(p=>`<div class="row attendance"><span><b>${esc(p.name)}</b> <small>#${esc(p.number)}</small></span><select onchange="setAttendance(${p.id},this.value)">${statusOptions.map(x=>`<option ${((att[p.id]||'未回答')===x)?'selected':''}>${x}</option>`).join('')}</select></div>`).join('')}</div>`:''}`:''}</section>`;
}
function saveEvent(){let old=db.events.find(x=>x.id===eventId);let e={id:eventId||Date.now(),kind:document.getElementById('ekind').value,date:document.getElementById('edate').value,time:document.getElementById('etime').value,venue:document.getElementById('evenue').value.trim(),note:document.getElementById('enote').value.trim(),attendance:old?.attendance||{},attendanceNotes:old?.attendanceNotes||{}};if(old)db.events=db.events.map(x=>x.id===e.id?e:x);else db.events.push(e);save();eventId=e.id;toast(old?'予定を修正しました':'予定を登録しました');render()}

function announcements(){return `<section class=screen><div class=row><h2>お知らせ</h2>${admin?`<button class=primary onclick="announcementId=null;screen='announcement';render()">＋ お知らせを登録</button>`:''}</div>${db.announcements.length?db.announcements.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.id||0)-(a.id||0)).map(x=>`<div class=item><div class=row><span>${esc(x.date||'')}</span>${admin?`<div><button class=secondary onclick="announcementId=${x.id};screen='announcement';render()">修正</button><button class=secondary onclick="deleteAnnouncement(${x.id})">削除</button></div>`:''}</div><div><b>${esc(x.text||'')}</b></div></div>`).join(''):'<div class=empty>お知らせはありません。</div>'}</section>`}
function announcementForm(){const x=db.announcements.find(a=>a.id===announcementId),edit=!!x;return `<section class=screen><button class=secondary onclick="screen='announcements';render()">← お知らせ一覧</button><h2>${edit?'お知らせを修正':'お知らせを登録'}</h2><div class=card><div class=field><label>日付</label><input id=adate type=date value="${x?.date||new Date().toISOString().slice(0,10)}"></div><div class=field><label>お知らせ内容</label><textarea id=atext rows=5 placeholder="チームへの連絡事項を入力してください">${esc(x?.text||'')}</textarea></div><button class=primary onclick="saveAnnouncement()">${edit?'このお知らせを修正':'このお知らせを登録'}</button>${edit?`<button class=secondary onclick="deleteAnnouncement(${x.id})">このお知らせを削除</button>`:''}</div></section>`}
function saveAnnouncement(){if(!requireAdmin())return;const text=document.getElementById('atext').value.trim();if(!text)return toast('お知らせ内容を入力してください');const x={id:announcementId||Date.now(),date:document.getElementById('adate').value,text};if(announcementId)db.announcements=db.announcements.map(a=>a.id===announcementId?x:a);else db.announcements.push(x);save();toast(announcementId?'お知らせを修正しました':'お知らせを登録しました');announcementId=x.id;screen='announcements';render()}
function deleteAnnouncement(id){if(!requireAdmin())return;if(!confirm('このお知らせを削除しますか？'))return;db.announcements=db.announcements.filter(x=>x.id!==id);save();announcementId=null;toast('お知らせを削除しました');screen='announcements';render()}

async function setAttendance(pid,status){if(!admin)return;let e=db.events.find(x=>x.id===eventId);if(!e)return;if(!e.attendance)e.attendance={};const oldStatus=e.attendance[pid]||'未回答';e.attendance[pid]=status;localSave();const ok=await syncAttendanceCloud(eventId,pid,status,(e.attendanceNotes||{})[pid]||'');if(!ok){e.attendance[pid]=oldStatus;localSave();return}render();toast('出欠を更新しました')}
async function setMyAttendanceNote(note){if(db.currentPlayerId==='admin'){toast('管理者は選手としての備考登録対象ではありません');return}if(admin)return;let e=db.events.find(x=>x.id===eventId),pid=db.currentPlayerId;if(!e||!pid)return;if(!e.attendanceNotes)e.attendanceNotes={};const oldNote=e.attendanceNotes[pid]||'';e.attendanceNotes[pid]=String(note||'').trim();saveLocalOnly();const ok=await syncAttendanceCloud(eventId,pid,e.attendance?.[pid]||'未回答',e.attendanceNotes[pid]);if(!ok){e.attendanceNotes[pid]=oldNote;saveLocalOnly();return}render();toast('備考を保存しました')}
async function setMyAttendance(status){if(db.currentPlayerId==='admin'){toast('管理者は選手としての出欠登録対象ではありません');return}if(admin)return setAttendance(db.currentPlayerId,status);let e=db.events.find(x=>x.id===eventId),pid=db.currentPlayerId;if(!e||!pid)return;if(!e.attendance)e.attendance={};const oldStatus=e.attendance[pid]||'未回答';e.attendance[pid]=status;saveLocalOnly();const ok=await syncAttendanceCloud(eventId,pid,status,(e.attendanceNotes||{})[pid]||'');if(!ok){e.attendance[pid]=oldStatus;saveLocalOnly();return}render();toast('自分の出欠を更新しました')}
function setCurrentPlayer(id){if(id==='admin'){db.currentPlayerId='admin';saveLocalOnly();toast('管理者を設定しました');render();return}id=+id||null;if(!db.players.some(p=>p.id===id))id=null;db.currentPlayerId=id;saveLocalOnly();toast(id?'自分の選手を設定しました':'自分の選手設定を解除しました');render()}

function selfPlayer(){const isAdminUser=db.currentPlayerId==='admin';const me=db.players.find(p=>p.id===db.currentPlayerId);return `<section class=screen><button class=secondary onclick="screen='home';render()">← メイン画面へ</button><h2>自分の選手を設定</h2><div class=card><h3>👤 この端末を使う人</h3><p class=muted>メイン画面に表示する名前を選択できます。</p><div class=field><label>自分の選手</label><select onchange="setCurrentPlayer(this.value)"><option value="">未設定</option><option value="admin" ${isAdminUser?'selected':''}>管理者</option>${db.players.map(p=>`<option value="${p.id}" ${me?.id===p.id?'selected':''}>${esc(p.name)}（#${esc(p.number)}）</option>`).join('')}</select></div>${isAdminUser?`<div class=notice-box><b>現在の設定</b><br>管理者</div>`:me?`<div class=notice-box><b>現在の設定</b><br>${esc(me.name)}（#${esc(me.number)}）</div>`:`<p class=muted>まだ自分の設定がされていません。</p>`}<button class=secondary onclick="setCurrentPlayer('')">自分の設定を解除</button></div></section>`}
function settings(){const y=db.annualStats[2026]||{};return `<section class=screen><h2>設定</h2><div class=card><h3>管理者モード</h3><p>${admin?'現在：管理者モード（成績の変更が可能）':'現在：閲覧モード（成績は変更できません）'}</p><p class="muted">クラウド：${cloudReady?'接続済み':'接続確認中'}</p>${admin?`<button class=primary onclick="adminLogout()">管理者モードを終了</button><button class=secondary onclick="changeAdminPassword()">管理者パスワードを変更</button>`:`<button class=primary onclick="adminLogin()">管理者ログイン</button>`}</div>${admin?`<div class=card><h3>📊 2026年度 年間成績</h3><p>${y.locked?'🔒 確定・ロック済み':'未確定（入力・保存できます）'}</p><button class=primary onclick="screen='annual2026';render()">${y.locked?'2026年度成績を確認':'2026年度成績を一括入力'}</button>${y.locked?`<button class=secondary style="width:100%;margin-top:8px" onclick="unlockAnnual2026()">🔓 ロックを解除</button>`:''}</div>`:''}<div class=card><b>データ保存・本番移行</b><p class=muted>現在の端末に保存されているデータをバックアップできます。クラウド版へ移行する際にも使用します。</p>${admin?`<button class=primary onclick="exportAppData()">📦 データをバックアップ</button><label class="secondary" style="display:block;text-align:center;margin-top:8px;cursor:pointer">📥 バックアップを復元<input type="file" accept="application/json,.json" style="display:none" onchange="importAppData(this)"></label><button class=secondary onclick="if(confirm('全データを削除しますか？')){localStorage.removeItem(KEY);location.reload()}">全データ削除</button>`:''}</div></section>`}
render();
cloudInitPromise=cloudInit();
