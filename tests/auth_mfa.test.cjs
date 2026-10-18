const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','auth.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate)};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const required=()=>json({type:'user_more_factors_required',message:'More factors required'},401);
const alice={$id:'alice',prefs:{onboarding_completed:true}};
const challenge=()=>({$id:'challenge-one',userId:'alice',expire:new Date(Date.now()+300000).toISOString()});
function node(tag='div'){
  const classes=new Set(),events={},field={classList:{toggle(){}}};let value='';
  return {tagName:tag.toUpperCase(),textContent:'',disabled:false,children:[],required:false,events,
    get value(){return value},set value(v){value=v},get options(){return this.children},
    classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,b){if(b??!classes.has(c))classes.add(c);else classes.delete(c)}},
    closest:()=>field,checkValidity:()=>true,focus(){this.focused=true},
    append(el){this.children.push(el);if(!value)value=el.value},replaceChildren(){this.children=[];value=''},
    addEventListener(type,fn){events[type]=fn},
    async click(){if(!this.disabled)return events.click?.({preventDefault(){}})},
    async submit(){return events.submit?.({preventDefault(){}})},async change(){return events.change?.()}
  };
}
function setup({reply,search='?next=%2FOrbit.html',initial='mfa'}={}){
  const nodes=new Map(),requests=[],redirects=[];
  for(const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const el=node(m[1]);if(/class="[^"]*\bhidden\b/.test(m[2]))el.classList.add('hidden');nodes.set(m[3],el);
  }
  const document={getElementById:id=>{assert(nodes.has(id),id);return nodes.get(id)},createElement:node};
  let verified=initial==='signed-in',started=initial!=='signed-out';
  const context=vm.createContext({document,URL,URLSearchParams,AbortSignal,Date,Response,Object,console,crypto:require('node:crypto').webcrypto,
    location:{search,origin:'https://www.alaada.com',replace:url=>redirects.push(url),assign:url=>redirects.push(url)},history:{replaceState(){}},
    fetch:async(url,options={})=>{
      const req={path:new URL(url).pathname.replace('/v1',''),method:options.method||'GET',data:options.body?JSON.parse(options.body):undefined,options};requests.push(req);
      if(reply){const r=await reply(req);if(r!==undefined)return r}
      if(req.path==='/account')return !started?json({type:'user_unauthorized'},401):verified?json(alice):required();
      if(req.path==='/account/sessions/email'||req.path==='/account/sessions/token'){started=true;return json({$id:'session-one',userId:'alice'})}
      if(req.path==='/account/mfa/factors')return json({totp:true,email:true,phone:false,recoveryCode:true});
      if(req.path==='/account/mfa/challenges'&&req.method==='POST')return json(challenge(),201);
      if(req.path==='/account/mfa/challenges'&&req.method==='PUT'){verified=true;return json({$id:'session-one',userId:'alice'})}
      if(req.path==='/account/sessions/session-one'&&req.method==='DELETE')return new Response(null,{status:204});
      throw Error('Unexpected '+req.method+' '+req.path);
    }});
  vm.runInContext(source,context);
  return {$:id=>document.getElementById(id),requests,redirects,context};
}
const posted=env=>env.requests.filter(r=>r.path==='/account/mfa/challenges'&&r.method==='POST');
const submitted=env=>env.requests.filter(r=>r.path==='/account/mfa/challenges'&&r.method==='PUT');

test('An existing partial session loads verified methods without sending any code or redirect',async()=>{
  const env=setup();await flush();
  assert.equal(env.$('mfa-panel').classList.contains('hidden'),false);
  assert.equal(env.$('primary-auth').classList.contains('hidden'),true);
  assert.deepEqual(env.$('mfa-factor').options.map(o=>o.value),['totp','email','recoveryCode']);
  assert.equal(posted(env).length,0);assert.deepEqual(env.redirects,[]);
});
test('Password sign-in detects MFA, clears the password and preserves the product destination',async()=>{
  const env=setup({initial:'signed-out'});await flush();env.$('email').value='test@example.test';env.$('password').value='fixture-password';
  await env.$('form').submit();assert.equal(env.$('password').value,'');assert.equal(env.redirects.length,0);
  await env.$('mfa-start').click();env.$('mfa-code').value='123456';await env.$('mfa-form').submit();
  assert.deepEqual(env.redirects,['/Orbit.html']);assert.equal(env.$('mfa-code').value,'');
  assert.equal(submitted(env)[0].data.challengeId,'challenge-one');
  assert(env.requests.every(r=>r.options.credentials==='include'&&r.options.cache==='no-store'));
});
test('Magic-link and OAuth completions enter the same MFA flow',async()=>{
  for(const search of ['?magic=complete&userId=alice&secret=fixture-secret&next=%2FSpreadsheets.html','?oauth=complete&next=%2FAccounts.html']){
    const env=setup({search});await flush();assert.equal(env.$('mfa-panel').classList.contains('hidden'),false);assert.equal(env.redirects.length,0);assert.equal(posted(env).length,0);
  }
});
test('Other authorization and service errors do not masquerade as MFA',async()=>{
  for(const response of [()=>json({type:'user_unauthorized'},401),()=>json({type:'general_unknown'},503),()=>new Response('')]){
    const env=setup({reply:r=>r.path==='/account'?response():undefined});await flush();
    assert.equal(env.$('mfa-panel').classList.contains('hidden'),true);assert.equal(env.requests.length,1);assert.equal(env.redirects.length,0);
  }
});
test('Malformed or empty factor lists fail closed and can be reloaded',async()=>{
  let valid=false;const env=setup({reply:r=>r.path==='/account/mfa/factors'?json(valid?{totp:true,email:false,phone:false}:{totp:'true'}):undefined});await flush();
  assert.equal(env.$('mfa-start').classList.contains('hidden'),true);assert.equal(env.$('mfa-retry').classList.contains('hidden'),false);
  valid=true;await env.$('mfa-retry').click();assert.equal(env.$('mfa-start').classList.contains('hidden'),false);
  assert.deepEqual(env.$('mfa-factor').options.map(o=>o.value),['totp']);
});
test('Challenge requests are single-flight and email delivery needs an explicit action',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);const env=setup({reply:r=>r.path==='/account/mfa/challenges'&&r.method==='POST'?pending:undefined});await flush();
  env.$('mfa-factor').value='email';await env.$('mfa-factor').change();assert.equal(posted(env).length,0);
  const first=env.$('mfa-start').click();await flush();await env.$('mfa-start').click();assert.equal(posted(env).length,1);
  finish(json(challenge()));await first;assert.match(env.$('mfa-instruction').textContent,/verified email/);
});
test('Malformed or expired challenges never expose a usable verification form',async()=>{
  for(const value of [{}, {...challenge(),$id:'../other'}, {...challenge(),userId:42}, {...challenge(),expire:'invalid'}, {...challenge(),expire:'2000-01-01T00:00:00Z'}]){
    const env=setup({reply:r=>r.path==='/account/mfa/challenges'?json(value):undefined});await flush();await env.$('mfa-start').click();
    assert.equal(env.$('mfa-form').classList.contains('hidden'),true);assert.equal(env.redirects.length,0);assert.equal(submitted(env).length,0);
  }
});
test('An unknown challenge response is not automatically replayed',async()=>{
  const env=setup({reply:r=>r.path==='/account/mfa/challenges'&&r.method==='POST'?Promise.reject(new Error('private-network-details')):undefined});await flush();await env.$('mfa-start').click();
  assert.equal(posted(env).length,1);assert.match(env.$('status').textContent,/No code was retried/);assert.doesNotMatch(env.$('status').textContent,/private-network/);
});
test('Rejected codes stay on the same challenge and are never retained in the input',async()=>{
  const env=setup({reply:r=>r.path==='/account/mfa/challenges'&&r.method==='PUT'?json({type:'user_invalid_token'},401):undefined});await flush();await env.$('mfa-start').click();
  env.$('mfa-code').value='123456';await env.$('mfa-form').submit();
  assert.equal(env.$('mfa-code').value,'');assert.match(env.$('status').textContent,/not accepted/);assert.equal(posted(env).length,1);assert.equal(env.redirects.length,0);
});
test('Recovery codes use the documented factor and are not changed or stored',async()=>{
  const env=setup();await flush();env.$('mfa-factor').value='recoveryCode';await env.$('mfa-start').click();
  env.$('mfa-code').value='RECOVERY123';await env.$('mfa-form').submit();
  assert.equal(posted(env)[0].data.factor,'recoveryCode');assert.equal(submitted(env)[0].data.otp,'RECOVERY123');assert.equal(env.$('mfa-code').value,'');assert.equal(env.redirects.length,1);
  assert.doesNotMatch(source,/localStorage|sessionStorage|console\.log\(/);
});
test('Verification double-clicks submit one code only',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);const env=setup({reply:r=>r.path==='/account/mfa/challenges'&&r.method==='PUT'?pending:undefined});await flush();await env.$('mfa-start').click();
  env.$('mfa-code').value='123456';const first=env.$('mfa-form').submit();await env.$('mfa-form').submit();assert.equal(submitted(env).length,1);
  finish(json({userId:'alice'}));await first;assert.equal(env.redirects.length,0); // /account still requires verification.
});
test('An ambiguous verification outcome requires a read-only status check, not another code submission',async()=>{
  let completed=false;const env=setup({reply:r=>{
    if(r.path==='/account'&&completed)return json(alice);
    if(r.path==='/account/mfa/challenges'&&r.method==='PUT'){completed=true;throw Error('lost response')}
  }});await flush();await env.$('mfa-start').click();env.$('mfa-code').value='123456';await env.$('mfa-form').submit();
  assert.equal(env.redirects.length,0);assert.equal(env.$('mfa-check').classList.contains('hidden'),false);
  await env.$('mfa-form').submit();assert.equal(submitted(env).length,1);
  await env.$('mfa-check').click();assert.deepEqual(env.redirects,['/Orbit.html']);assert.equal(submitted(env).length,1);
});
test('A different account after verification cannot be redirected into the requested product',async()=>{
  let changed=false;const env=setup({reply:r=>{
    if(r.path==='/account'&&changed)return json({...alice,$id:'bob'});
    if(r.path==='/account/mfa/challenges'&&r.method==='PUT'){changed=true;return json({userId:'alice'})}
  }});await flush();await env.$('mfa-start').click();env.$('mfa-code').value='123456';await env.$('mfa-form').submit();await env.$('mfa-check').click();
  assert.equal(env.redirects.length,0);assert.match(env.$('status').textContent,/account changed/);
});
test('Cancellation only revokes the session created on this page and redirects once confirmed',async()=>{
  for(const ok of [false,true]){
    const env=setup({initial:'signed-out',reply:r=>r.method==='DELETE'?ok?new Response(null,{status:204}):json({},503):undefined});await flush();
    env.$('email').value='test@example.test';env.$('password').value='fixture-password';await env.$('form').submit();await env.$('mfa-cancel').click();
    assert.equal(env.requests.filter(r=>r.method==='DELETE').length,1);assert.equal(env.redirects.length,ok?1:0);
    assert.equal(env.requests.find(r=>r.method==='DELETE').path,'/account/sessions/session-one');
    if(!ok)assert.match(env.$('status').textContent,/Sign-out could not be confirmed/);
  }
});
test('Returning home from an existing partial session never revokes an unknown current session',async()=>{
  const env=setup();await flush();assert.equal(env.$('mfa-cancel').textContent,'Back to Alaada');await env.$('mfa-cancel').click();
  assert.deepEqual(env.redirects,['/']);assert.equal(env.requests.filter(r=>r.method==='DELETE').length,0);
});
test('A confirmed code followed by a denied account read cannot replay the consumed code',async()=>{
  const env=setup({reply:r=>r.path==='/account/mfa/challenges'&&r.method==='PUT'?json({userId:'alice'}):undefined});await flush();await env.$('mfa-start').click();
  env.$('mfa-code').value='123456';await env.$('mfa-form').submit();assert.equal(env.$('mfa-check').classList.contains('hidden'),false);
  assert.equal(env.$('mfa-form').classList.contains('hidden'),true);assert.equal(env.redirects.length,0);
  await env.$('mfa-form').submit();assert.equal(submitted(env).length,1);
});
test('No MFA flow can use an external post-login destination',async()=>{
  const env=setup({initial:'signed-in',search:'?next=https%3A%2F%2Fevil.example%2F'});await flush();assert.deepEqual(env.redirects,['/account.html']);
});
