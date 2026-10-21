/* Browser-local transport chat. Files stay in the shared attachment database. */
(() => {
  "use strict";
  const T=window.MineTransport,A=window.MineAttachmentStore;
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const emojis=["😀","😊","😂","👍","👌","🙏","💪","👏","❤️","🌹","✅","收到","辛苦了","🚚","⛏️","⚠️"];
  let host=null,ctx=null,active="chat:all",owner="",drafts=new Map(),urls=new Map(),digest="",observer=null,readTimer=null,readBusy=false,readIds=new Set(),limit=100,sending=false,recorder=null,stream=null,recordTimer=null,recordSeconds=0,recordCancel=false,requestGeneration=0,requesting=false,viewer=null,voiceMode=false,holdGesture=null;
  const node=id=>host?.querySelector('[data-chat="'+id+'"]');
  const draft=()=>{if(!drafts.has(active))drafts.set(active,{text:"",files:[],clientId:crypto.randomUUID()});return drafts.get(active);};
  const stamp=value=>new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",hour12:false});
  const unread=msg=>!(msg.readBy||[]).includes(ctx.person.id);
  const messages=()=>T.visibleMessages(ctx.d,ctx.person);
  const title=()=>"公共聊天";
  function html(){return '<section class="transport-chat" data-chat-root><div class="chat-main"><header class="chat-header"><div><strong data-chat="title"></strong><small>当前仅在同一浏览器内联动，跨手机聊天尚未接入共享服务。</small></div><button type="button" class="soft" data-chat-action="read-all">本会话已读</button></header><div class="chat-log" data-chat="log" role="log" aria-label="聊天记录" aria-live="polite" tabindex="0"></div><div class="chat-composer" data-chat="composer"><label class="chat-input-label" data-chat="text-wrap">文字消息<textarea data-chat="text" maxlength="4000" rows="2" placeholder="输入消息，Enter发送，Shift+Enter换行" aria-label="消息内容"></textarea></label><div class="chat-voice-pad" data-chat="voice-pad" hidden><button type="button" class="chat-hold-talk" data-chat="record" aria-label="按住说话，松开发送，上滑取消">按住说话</button><small>松开发送，上滑取消</small></div><div class="chat-voice-overlay" data-chat="voice-overlay" role="status" aria-live="polite" hidden><div class="chat-voice-wave" aria-hidden="true">▂ ▅ █ ▅ ▂</div><strong data-chat="voice-time"></strong><span data-chat="voice-hint"></span></div><div class="chat-tools"><button type="button" class="soft" data-chat-action="photo">照片</button><button type="button" class="soft" data-chat-action="voice-mode" data-chat="voice-toggle" aria-pressed="false">语音</button><button type="button" class="soft" data-chat-action="emoji" aria-expanded="false">表情</button><span data-chat="record-status" role="status"></span></div><div class="chat-emoji" data-chat="emojis" hidden>'+emojis.map(emoji=>'<button type="button" data-chat-action="insert-emoji" data-emoji="'+esc(emoji)+'">'+esc(emoji)+'</button>').join("")+'</div><div class="chat-pending" data-chat="pending"></div><div class="chat-send-row"><small>每条最多6个附件，单个不超过10 MB；录音最长60秒。</small><button type="button" data-chat-action="send" data-chat="send">发送</button></div><input data-chat="photo-input" type="file" accept="image/*" multiple hidden></div></div></section>';}
  function releaseUrls(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();}
  function clearObserver(){observer?.disconnect();observer=null;if(readTimer)clearTimeout(readTimer);readTimer=null;readIds.clear();}
  async function flushRead(){
    readTimer=null;
    if(!ctx||!host?.isConnected||document.visibilityState!=="visible"||!readIds.size)return;
    if(readBusy){readTimer=setTimeout(flushRead,500);return;}
    readBusy=true;const current=ctx,ids=[...readIds];readIds.clear();
    try{await T.act("readMessages",{ids},{personId:current.person.id,role:current.role});if(ctx===current)current.onChanged();}
    catch(error){if(ctx===current)current.toast(error.message);}
    finally{readBusy=false;}
  }
  function observeRows(){
    clearObserver();
    if(!("IntersectionObserver" in window))return;
    observer=new IntersectionObserver(entries=>{
      if(!ctx||document.visibilityState!=="visible")return;
      for(const entry of entries)if(entry.isIntersecting){const id=entry.target.dataset.messageId,msg=messages().find(msg=>msg.id===id);if(msg&&unread(msg)){readIds.add(id);observer.unobserve(entry.target);}}
      if(readIds.size&&!readTimer)readTimer=setTimeout(flushRead,350);
    },{root:node("log"),threshold:0.4});
    host.querySelectorAll("[data-message-id]").forEach(el=>observer.observe(el));
  }
  async function hydrate(){
    const currentHost=host;
    for(const el of host.querySelectorAll("[data-chat-file]")){
      const id=el.dataset.chatFile;
      try{
        let url=urls.get(id);
        if(!url){const file=await A.get(id);if(host!==currentHost||!el.isConnected)return;if(!file?.blob){el.replaceWith(document.createTextNode("附件未在当前浏览器找到"));continue;}url=URL.createObjectURL(file.blob);urls.set(id,url);}
        if(host!==currentHost||!el.isConnected)return;
        el.src=url;
      }catch{if(el.isConnected)el.replaceWith(document.createTextNode("附件读取失败，请重试"));}
    }
  }
  function drawPending(){
    const current=draft();node("pending").innerHTML=current.files.map((file,index)=>'<span>'+esc(file.type.startsWith("image/")?"照片："+file.name:"语音："+file.name)+'<button type="button" data-chat-action="remove-file" data-index="'+index+'" aria-label="移除附件">×</button></span>').join("");
  }
  function updateControls(){
    if(!host)return;
    const recording=recorder?.state==="recording",recordBusy=!!recorder||requesting,canceling=!!holdGesture?.cancel;
    node("send").disabled=sending||recordBusy;
    node("send").textContent=sending?"发送中…":"发送";
    node("record").disabled=sending||!!recorder&&!recording;
    node("record").textContent=requesting?"正在开启麦克风…":recording?(canceling?"松开取消":"松开发送"):"按住说话";
    node("record").classList.toggle("is-holding",recording);
    node("record").classList.toggle("is-canceling",canceling);
    node("record").setAttribute("aria-pressed",String(!!holdGesture));
    node("text-wrap").hidden=voiceMode;node("voice-pad").hidden=!voiceMode;
    node("voice-toggle").textContent=voiceMode?"键盘":"语音";
    node("voice-toggle").setAttribute("aria-pressed",String(voiceMode));
    node("voice-toggle").disabled=sending||recordBusy||!!holdGesture;
    node("voice-overlay").hidden=!recording&&!requesting;
    node("voice-overlay").classList.toggle("is-canceling",canceling);
    node("voice-time").textContent=requesting?"等待麦克风授权":recordSeconds+"秒";
    node("voice-hint").textContent=canceling?"松开手指，取消发送":"上滑取消 · 松开发送";
    node("record-status").textContent="";
    node("text").disabled=sending||recordBusy;
    for(const b of host.querySelectorAll('[data-chat-action="photo"],[data-chat-action="remove-file"],[data-chat-action="emoji"]'))b.disabled=sending||recordBusy;
  }
  function senderLabel(msg){
    if(msg.kind!=="chat")return "系统通知";
    const p=ctx.m.people.find(p=>p.id===msg.senderId),historical=T.chatVehicleAt(ctx.d,ctx.m,msg.senderId,msg.at);
    const name=msg.senderName||p?.name||"原人员",team=msg.senderTeam??(historical.team||p?.team||""),role=msg.senderRole||p?.applicationRole,vehicle=msg.senderVehicleCode||historical.vehicleCode;
    return name+(msg.senderId===ctx.person.id?"（我）":"")+" · "+(team||"班组未设置")+(["driver","excavator"].includes(role)&&vehicle?" · "+vehicle:"")+(msg.target!=="chat:all"?" · 历史私聊":"");
  }
  function draw(){
    if(!host?.isConnected||!ctx)return;
    node("title").textContent=title();
    node("composer").hidden=false;
    const text=node("text");if(text.value!==draft().text)text.value=draft().text;
    drawPending();updateControls();
    const all=messages().sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)),rows=all.slice(-limit);
    const next=ctx.person.id+"|"+active+"|"+limit+"|"+rows.map(msg=>msg.id).join(",");
    if(next===digest)return;
    const log=node("log"),oldTop=log.scrollTop,atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<65,switched=!digest||digest.split("|")[1]!==active;
    digest=next;clearObserver();releaseUrls();
    log.innerHTML=(all.length>limit?'<button type="button" class="soft chat-earlier" data-chat-action="earlier">加载更早消息</button>':"")+(rows.length?rows.map(msg=>{
      const own=msg.senderId===ctx.person.id;
      return '<article class="chat-message'+(own?' mine':'')+(msg.kind!=="chat"?' system-message':'')+'" data-message-id="'+esc(msg.id)+'"><div class="chat-message-meta">'+esc(senderLabel(msg))+' · '+esc(stamp(msg.at))+'</div><div class="chat-bubble">'+(msg.body?'<p>'+esc(msg.body)+'</p>':"")+(msg.attachments||[]).map(file=>file.type.startsWith("image/")?'<button type="button" class="chat-photo-button" data-chat-action="view-photo" data-file-id="'+esc(file.id)+'"><img data-chat-file="'+esc(file.id)+'" alt="'+esc(file.name||"聊天照片")+'" loading="lazy"></button>':'<audio controls preload="none" data-chat-file="'+esc(file.id)+'" aria-label="语音消息"></audio>').join("")+'</div></article>';
    }).join(""):'<div class="chat-empty">'+(active==="system"?"暂无系统通知":"暂无消息，发送第一条消息吧")+'</div>');
    log.scrollTop=switched||atBottom?log.scrollHeight:oldTop;hydrate();observeRows();
  }
  async function filesAdded(files){
    if(sending)return;
    const current=draft(),valid=[];
    for(const file of files){if(!/^image\/|^audio\//.test(file.type)){ctx.toast("请选择照片或语音文件");continue;}if(!file.size||file.size>A.MAX_BYTES){ctx.toast("附件须大于0且不超过10 MB");continue;}if(current.files.length+valid.length>=6){ctx.toast("每条消息最多6个附件");break;}valid.push(file);}
    current.files.push(...valid);drawPending();
  }
  function stopRecording(cancel=false){
    requestGeneration++;requesting=false;recordCancel=cancel;holdGesture=null;if(recorder)recorder.chatCanceled=cancel;
    if(recordTimer)clearInterval(recordTimer);recordTimer=null;
    if(recorder&&recorder.state!=="inactive")recorder.stop();
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
    updateControls();
  }
  async function record(){
    if(recorder||requesting||sending||!holdGesture)return;
    if(draft().files.length>=6){holdGesture=null;updateControls();return ctx.toast("请先发送或移除部分附件");}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){holdGesture=null;updateControls();return ctx.toast("当前浏览器不支持录音，请使用支持麦克风录音的浏览器");}
    const generation=++requestGeneration,currentOwner=owner,currentThread=active,currentCtx=ctx,currentHost=host;
    requesting=true;updateControls();
    try{
      const acquired=await navigator.mediaDevices.getUserMedia({audio:true});
      if(generation!==requestGeneration||!holdGesture||!host?.isConnected||host!==currentHost||owner!==currentOwner||active!==currentThread){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;const mime=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(type=>MediaRecorder.isTypeSupported(type));
      recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);const chunks=[],thisRecorder=recorder;
      recordCancel=false;recordSeconds=0;thisRecorder.chatStartedAt=Date.now();
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=()=>{currentCtx.toast("录音失败，请重新录音");stopRecording(true);};
      recorder.onstop=()=>{
        const canceled=thisRecorder.chatCanceled===true;thisRecorder.stream.getTracks().forEach(track=>track.stop());if(recorder===thisRecorder)recorder=null;
        if(!canceled&&owner===currentOwner&&active===currentThread&&host===currentHost&&host?.isConnected){
          const duration=Date.now()-thisRecorder.chatStartedAt,type=thisRecorder.mimeType||chunks[0]?.type||"audio/webm",blob=new Blob(chunks,{type}),ext=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
          if(duration<1000)currentCtx.toast("说话时间太短，请重新按住说话");
          else if(!blob.size)currentCtx.toast("未录到声音，请重试");
          else if(blob.size>A.MAX_BYTES)currentCtx.toast("语音超过10 MB，请缩短后重新录音");
          else send(new File([blob],"语音_"+Date.now()+"."+ext,{type}));
        }
        updateControls();
      };
      recorder.start();requesting=false;updateControls();
      recordTimer=setInterval(()=>{recordSeconds++;updateControls();if(recordSeconds>=60){const cancel=!!holdGesture?.cancel;stopRecording(cancel);}},1000);
    }catch(error){if(generation!==requestGeneration)return;currentCtx.toast(error.name==="NotAllowedError"?"未获得麦克风权限，请允许后重新按住说话":"无法开始录音："+error.message);stopRecording(true);}
    finally{if(generation===requestGeneration){requesting=false;updateControls();}}
  }
  function beginHold(event){
    if(!voiceMode||sending||recorder||requesting||holdGesture)return;
    if(event.type==="pointerdown"&&(event.isPrimary===false||event.button!==0))return;
    if(event.type==="keydown"&&(![" ","Enter"].includes(event.key)||event.repeat))return;
    event.preventDefault();
    holdGesture={pointerId:event.pointerId??"keyboard",startY:event.clientY??0,cancel:false};
    if(event.pointerId!=null)try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}
    record();
  }
  function moveHold(event){
    if(!holdGesture||event.pointerId!==holdGesture.pointerId)return;
    holdGesture.cancel=holdGesture.startY-event.clientY>=60;updateControls();
  }
  function finishHold(event){
    if(!holdGesture)return;
    if(event.type==="keyup"&&![" ","Enter"].includes(event.key))return;
    if(event.pointerId!=null&&event.pointerId!==holdGesture.pointerId)return;
    if(event.type==="keyup"&&holdGesture.pointerId!=="keyboard")return;
    event.preventDefault();const cancel=holdGesture.cancel||["pointercancel","lostpointercapture","blur"].includes(event.type);
    stopRecording(cancel);
    if(cancel&&ctx)ctx.toast("已取消语音");
  }
  async function send(voiceFile=null){
    if(sending||requesting||recorder||active==="system")return;
    const current=voiceFile?{text:"",files:[voiceFile],clientId:crypto.randomUUID()}:draft(),body=current.text.trim(),sender=ctx,target=active,files=[...current.files];
    if(!body&&!files.length)return ctx.toast("请输入消息或添加照片、语音");
    const saved=[];let committed=false;sending=true;updateControls();
    try{
      for(const file of files)saved.push(await A.save(file));
      await T.act("sendChat",{target,body,attachments:saved,clientId:current.clientId},{personId:sender.person.id,role:sender.role});committed=true;
      current.text="";current.files=[];current.clientId=crypto.randomUUID();sender.onChanged();if(host?.isConnected)draw();sender.toast("消息已保存");
    }catch(error){if(!committed){await Promise.allSettled(saved.map(file=>A.remove(file.id)));if(voiceFile&&owner===sender.person.id&&host?.isConnected){const retry=draft();if(retry.files.length<6){retry.files.push(voiceFile);drawPending();}}}sender.toast("发送失败："+error.message); }
    finally{sending=false;updateControls();}
  }
  async function photo(id){
    try{const file=await A.get(id);if(!file?.blob)return ctx.toast("照片未在当前浏览器找到");if(!host?.isConnected)return;
      if(viewer){viewer.close();viewer.remove();}const url=URL.createObjectURL(file.blob);viewer=document.createElement("dialog");viewer.className="chat-image-viewer";viewer.innerHTML='<button type="button" aria-label="关闭">×</button><img alt="聊天照片">';viewer.querySelector("img").src=url;viewer.querySelector("button").onclick=()=>viewer.close();const dialog=viewer;dialog.addEventListener("close",()=>{URL.revokeObjectURL(url);dialog.remove();if(viewer===dialog)viewer=null;},{once:true});document.body.appendChild(dialog);dialog.showModal();
    }catch(error){ctx.toast(error.message);}
  }
  function click(event){
    const b=event.target.closest("[data-chat-action]");if(!b)return;
    const action=b.dataset.chatAction;
    if(action==="send")return send();
    if(action==="photo")return node("photo-input").click();
    if(action==="voice-mode"){if(sending||recorder||requesting||holdGesture)return;voiceMode=!voiceMode;node("emojis").hidden=true;updateControls();if(!voiceMode)node("text").focus();return;}
    if(action==="emoji"){voiceMode=false;updateControls();node("emojis").hidden=!node("emojis").hidden;b.setAttribute("aria-expanded",String(!node("emojis").hidden));return;}
    if(action==="insert-emoji"){const input=node("text"),start=input.selectionStart||0,end=input.selectionEnd||start,value=input.value.slice(0,start)+b.dataset.emoji+input.value.slice(end);if(value.length>4000)return ctx.toast("消息最多4000字");draft().text=value;input.value=value;input.focus();input.setSelectionRange(start+b.dataset.emoji.length,start+b.dataset.emoji.length);return;}
    if(action==="remove-file"&&!sending){draft().files.splice(Number(b.dataset.index),1);drawPending();return;}
    if(action==="view-photo")return photo(b.dataset.fileId);
    if(action==="earlier"){limit+=100;digest="";draw();return;}
    if(action==="read-all"){for(const msg of messages().filter(msg=>unread(msg)))readIds.add(msg.id);return flushRead();}
  }
  function dispose(){
    stopRecording(true);clearObserver();releaseUrls();if(viewer)viewer.close();host=null;ctx=null;digest="";
  }
  function update(next){
    if(owner&&owner!==next.person.id){dispose();drafts=new Map();active="chat:all";}
    owner=next.person.id;ctx=next;
    const nextHost=document.querySelector("[data-chat-root]");
    if(!nextHost)return;
    if(host!==nextHost){if(host)dispose();ctx=next;host=nextHost;digest="";host.addEventListener("click",click);host.addEventListener("input",event=>{if(event.target===node("text"))draft().text=event.target.value;});
      const holdButton=node("record");holdButton.addEventListener("pointerdown",beginHold);holdButton.addEventListener("pointermove",moveHold);for(const type of ["pointerup","pointercancel","lostpointercapture","keyup","blur"])holdButton.addEventListener(type,finishHold);holdButton.addEventListener("keydown",beginHold);holdButton.addEventListener("contextmenu",event=>event.preventDefault());
      host.addEventListener("change",event=>{if(event.target.matches('input[type="file"]')){filesAdded([...event.target.files]);event.target.value="";}});
      node("text").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();send();}});
    }
    draw();
  }
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){stopRecording(true);clearObserver();}else if(host?.isConnected)observeRows();});
  window.addEventListener("pagehide",dispose);window.addEventListener("blur",()=>{if(holdGesture)stopRecording(true);});
  window.MineTransportChat={html,update,dispose};
})();
