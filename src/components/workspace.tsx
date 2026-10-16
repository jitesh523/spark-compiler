'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Braces, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Copy, FileCode2, FolderCode, History, KeyRound, LoaderCircle, Maximize2, Minimize2, MoreHorizontal, PanelRightClose, PanelRightOpen, Play, Plus, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Square, Terminal, Trash2, Upload, WandSparkles, X, Zap } from 'lucide-react';
import { boundMessages, createSession, exportSession, loadSession, parseSession, saveSession, type Session, type Language, type ChatMessage, type RunEntry } from '@/lib/session';
import { executeCode, type RunResult } from '@/lib/runtime';
import { ResizeHandle } from './resize-handle';

type ToolTab = 'output' | 'input' | 'ai' | 'history';
const TOOL_TABS: {id:ToolTab;label:string;icon:typeof Terminal}[] = [
  {id:'output',label:'Output',icon:Terminal},
  {id:'input',label:'Input',icon:ChevronRight},
  {id:'ai',label:'Spark AI',icon:Sparkles},
  {id:'history',label:'History',icon:History},
];
const LAYOUT_KEY='spark-compiler.layout.v1';

const CodeEditor = dynamic(()=>import('./code-editor'),{ssr:false,loading:()=> <div className="editor-loading"><LoaderCircle className="spin" size={20}/> Opening your editor…</div>});
const languageInfo: Record<Language,{name:string;file:string;mark:string;className:string}> = {
  python:{name:'Python',file:'main.py',mark:'Py',className:'python'},
  c:{name:'C',file:'main.c',mark:'C',className:'c'},
  cpp:{name:'C++',file:'main.cpp',mark:'C+',className:'cpp'},
  java:{name:'Java',file:'Main.java',mark:'Ja',className:'java'},
  javascript:{name:'JavaScript',file:'main.js',mark:'JS',className:'javascript'},
  typescript:{name:'TypeScript',file:'main.ts',mark:'TS',className:'typescript'},
};
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
function download(text:string,name:string,type='text/plain') {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function timeLabel(date:string){return new Date(date).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function MessageText({text}:{text:string}) {
  return <div className="message-text">{text.split(/(```[\s\S]*?```)/g).map((part,i)=>part.startsWith('```')?<pre key={i}><code>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/,'')}</code></pre>:<span key={i}>{part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((s,j)=>s.startsWith('**')?<strong key={j}>{s.slice(2,-2)}</strong>:s.startsWith('`')?<code key={j}>{s.slice(1,-1)}</code>:s)}</span>)}</div>;
}
export default function Workspace(){
  const [session,setSession]=useState<Session>(()=>createSession());
  const [ready,setReady]=useState(false),[saved,setSaved]=useState(true);
  const [toolTab,setToolTab]=useState<ToolTab>('output');
  const [toolsOpen,setToolsOpen]=useState(true),[toolsExpanded,setToolsExpanded]=useState(false);
  const [focusMode,setFocusMode]=useState(false),[editorWidth,setEditorWidth]=useState(65);
  const [resizeBounds,setResizeBounds]=useState({min:35,max:80});
  const [running,setRunning]=useState(false),[runStatus,setRunStatus]=useState('');
  const [result,setResult]=useState<RunResult|null>(null);
  const [aiBusy,setAiBusy]=useState(false),[aiStatus,setAiStatus]=useState('Thinking it through…');
  const [draft,setDraft]=useState(''),[apiKey,setApiKey]=useState(''),[serverAI,setServerAI]=useState(false);
  const [connectionOpen,setConnectionOpen]=useState(false),[keyDraft,setKeyDraft]=useState('');
  const [helpOpen,setHelpOpen]=useState(false),[newSessionOpen,setNewSessionOpen]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false),[toast,setToast]=useState('');
  const [cursor,setCursor]=useState({line:1,col:1}),[mobileTab,setMobileTab]=useState<'editor'|'tools'>('editor');
  const cancelRun=useRef<(()=>void)|null>(null), cancelAI=useRef<AbortController|null>(null);
  const sessionRef=useRef(session),keyRef=useRef(''),serverRef=useRef(false),runLock=useRef(false),aiLock=useRef(false);
  const scrollRef=useRef<HTMLDivElement>(null),importRef=useRef<HTMLInputElement>(null);
  const requestVersion=useRef(0),mounted=useRef(true);
  const gridRef=useRef<HTMLDivElement>(null);
  sessionRef.current=session;keyRef.current=apiKey;serverRef.current=serverAI;
  const language=session.language, file=session.files[language], info=languageInfo[language];
  const hasAI=serverAI||!!apiKey;

  useEffect(()=>{
    mounted.current=true;
    const restored=loadSession();setSession(restored);sessionRef.current=restored;
    try {
      const layout=JSON.parse(window.localStorage.getItem(LAYOUT_KEY)||'null');
      if(layout&&typeof layout.editorWidth==='number'&&Number.isFinite(layout.editorWidth))setEditorWidth(Math.min(80,Math.max(35,layout.editorWidth)));
      if(layout&&typeof layout.toolsOpen==='boolean')setToolsOpen(layout.toolsOpen);
    } catch { /* Layout preferences are optional. */ }
    setReady(true);
    fetch('/api/ai').then(r=>r.json()).then(data=>{if(mounted.current)setServerAI(!!data.configured);}).catch(()=>{});
    return()=>{mounted.current=false;cancelRun.current?.();cancelAI.current?.abort();};
  },[]);
  useEffect(()=>{
    if(!ready)return;
    try {window.localStorage.setItem(LAYOUT_KEY,JSON.stringify({editorWidth,toolsOpen}));}catch { /* Code/session saving reports its own storage errors. */ }
  },[editorWidth,toolsOpen,ready]);
  useEffect(()=>{
    const grid=gridRef.current;if(!grid)return;
    const observer=new ResizeObserver(()=>{
      if(window.innerWidth<=820)return;
      const width=grid.getBoundingClientRect().width;
      if(width<=0)return;
      const min=Math.max(35,320/width*100),max=Math.min(80,100-308/width*100);
      if(min>max)return;
      setResizeBounds({min,max});
      setEditorWidth(value=>Math.min(max,Math.max(min,value)));
    });
    observer.observe(grid);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!ready)return;
    const timer=setTimeout(()=>setSaved(saveSession(session)),450);return()=>clearTimeout(timer);
  },[session,ready]);
  useEffect(()=>{
    const flush=()=>{saveSession(sessionRef.current);};
    window.addEventListener('pagehide',flush);
    return()=>window.removeEventListener('pagehide',flush);
  },[]);
  useEffect(()=>{
    if(!connectionOpen&&!helpOpen&&!newSessionOpen)return;
    const prior=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]');
    const items=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,[tabindex="0"]')||[]);
    const focus=()=>{const first=dialog?.querySelector<HTMLElement>('[autofocus],input')||items()[0];first?.focus();};
    focus();
    const trap=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setConnectionOpen(false);setHelpOpen(false);setNewSessionOpen(false);}
      if(event.key!=='Tab')return;
      const list=items(),first=list[0],last=list[list.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);prior?.focus();};
  },[connectionOpen,helpOpen,newSessionOpen]);
  useEffect(()=>{if(toast){const timer=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(timer);}},[toast]);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[session.messages,aiBusy,toolTab]);
  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      if(document.querySelector('[role="dialog"]')&&e.key!=='Escape')return;
      if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void runCode();}
      if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();const success=saveSession(sessionRef.current);setSaved(success);setToast(success?'Session saved in this browser':'Browser storage is unavailable. Export your session to keep a copy.');}
      if(e.key==='Escape'){setConnectionOpen(false);setHelpOpen(false);setMenuOpen(false);setFocusMode(false);setToolsExpanded(false);}
    }
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  });
  function openTool(tab:ToolTab,focusPanel=false){
    setToolTab(tab);setToolsOpen(true);setMobileTab('tools');setFocusMode(false);
    if(focusPanel&&window.innerWidth<=820)requestAnimationFrame(()=>document.getElementById('tool-pane')?.focus({preventScroll:true}));
  }
  function focusEditor(){
    requestAnimationFrame(()=>document.querySelector<HTMLElement>('.editor-container .cm-content')?.focus({preventScroll:true}));
  }
  function closeTools(){
    setToolsOpen(false);setToolsExpanded(false);setMobileTab('editor');
    requestAnimationFrame(()=>{
      const target=window.innerWidth>820?document.querySelector<HTMLElement>('.tools-toggle'):document.querySelector<HTMLElement>('.editor-container .cm-content');
      target?.focus({preventScroll:true});
    });
  }
  function toggleEditorFocus(){
    setFocusMode(value=>!value);setToolsExpanded(false);setMobileTab('editor');
  }
  function navigateToolTabs(event:React.KeyboardEvent<HTMLDivElement>){
    const current=TOOL_TABS.findIndex(tab=>tab.id===toolTab);
    const next=event.key==='ArrowRight'?(current+1)%TOOL_TABS.length:event.key==='ArrowLeft'?(current+TOOL_TABS.length-1)%TOOL_TABS.length:event.key==='Home'?0:event.key==='End'?TOOL_TABS.length-1:-1;
    if(next<0)return;event.preventDefault();
    openTool(TOOL_TABS[next].id);
    event.currentTarget.querySelector<HTMLButtonElement>('#tool-tab-'+TOOL_TABS[next].id)?.focus();
  }
  function updateSession(fn:(s:Session)=>Session){setSession(s=>({...fn(s),updatedAt:now()}));}
  function updateCode(code:string){updateSession(s=>({...s,files:{...s.files,[s.language]:{...s.files[s.language],code}}}));}
  function addMessage(message:Omit<ChatMessage,'id'|'createdAt'>){
    updateSession(s=>({...s,messages:boundMessages([...s.messages,{...message,id:uid(),createdAt:now()}])}));
  }
  function checkpoint(s:Session,lang:Language,code:string,reason:string):Session{
    return {...s,checkpoints:[...s.checkpoints,{id:uid(),createdAt:now(),language:lang,code,reason}].slice(-30)};
  }
  async function getAI(action:'chat'|'fix',message:string,code:string,lang:Language,error=''){
    const snapshot=sessionRef.current;
    const controller=new AbortController();cancelAI.current=controller;
    const timer=setTimeout(()=>controller.abort(),55000);
    try{
      const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({
        action,language:lang,code,stdin:snapshot.files[lang].stdin,error,message,
        history:snapshot.messages.map(m=>({role:m.role,content:m.content,language:m.language,code:m.code})),
        runHistory:snapshot.runs.slice(-8).map(r=>({language:r.language,stdout:r.stdout.slice(0,2000),stderr:r.stderr.slice(0,2000),exitCode:r.exitCode})),
        ...(keyRef.current?{apiKey:keyRef.current}:{}),
      })});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'AI is unavailable. Please try again.');
      return data as {explanation:string;code:string|null;changes:string[]};
    }finally{clearTimeout(timer);cancelAI.current=null;}
  }
  async function performRun(code:string,lang:Language,stdin:string,version:number):Promise<RunResult>{
    setRunStatus('Starting runtime…');
    const task=executeCode({language:lang,code,stdin,onStatus:setRunStatus});cancelRun.current=task.cancel;
    const outcome=await task.promise;cancelRun.current=null;
    if(version!==requestVersion.current)return outcome;
    setResult(outcome);
    const entry:RunEntry={...outcome,id:uid(),language:lang,code,createdAt:now()};
    updateSession(s=>({...s,runs:[...s.runs,entry].slice(-40)}));
    return outcome;
  }
  async function runCode(){
    if(runLock.current||aiLock.current||!ready)return;
    runLock.current=true;setRunning(true);openTool('output',true);setResult(null);
    const s=sessionRef.current,lang=s.language,source=s.files[lang].code,stdin=s.files[lang].stdin;
    const version=requestVersion.current;
    try{
      const outcome=await performRun(source,lang,stdin,version);
      if(version!==requestVersion.current)return;
      if(outcome.exitCode!==0&&outcome.exitCode!==130&&outcome.exitCode!==124&&outcome.exitCode!==125&&sessionRef.current.autoFix){
        if(!(serverRef.current||keyRef.current)){
          setToast('Connect Groq to automatically repair this error.');return;
        }
        openTool('ai',true);setAiBusy(true);aiLock.current=true;setAiStatus('Finding the error and making a fix…');
        addMessage({role:'user',language:lang,content:`Fix the ${languageInfo[lang].name} error from my last run:\n${outcome.stderr.slice(0,8000)}`});
        const repair=await getAI('fix','Fix this failed run. Explain the cause and the exact changes, step by step.',source,lang,outcome.stderr.slice(0,12000));
        if(version!==requestVersion.current)return;
        const canApply=repair.code&&sessionRef.current.autoFix&&sessionRef.current.language===lang&&sessionRef.current.files[lang].code===source;
        addMessage({role:'assistant',language:lang,content:repair.explanation,code:repair.code??undefined,changes:repair.changes});
        if(canApply){
          const fixed=repair.code!;
          updateSession(current=>({...checkpoint(current,lang,source,'Before automatic AI fix'),files:{...current.files,[lang]:{...current.files[lang],code:fixed}}}));
          setAiStatus('Fix applied. Running it again…');
          const retry=await performRun(fixed,lang,stdin,version);
          if(version!==requestVersion.current)return;
          addMessage({role:'assistant',content:retry.exitCode===0?'The corrected code ran successfully. You can undo the fix from the editor toolbar.':`The corrected code still needs attention. Here is the new runtime result:\n${retry.stderr.slice(0,8000)}\nAsk me to investigate further.`});
          setToast(retry.exitCode===0?'Fixed, explained, and verified with a new run.':'A fix was applied. Check the new error.');
        }else if(repair.code){setToast('Your code changed while I worked. Review the suggested fix.');}
      }
    }catch(error){if(version===requestVersion.current)setToast(error instanceof Error?error.message:'Something went wrong. Please try again.');}
    finally{runLock.current=false;aiLock.current=false;setRunning(false);setAiBusy(false);setRunStatus('');}
  }
  async function askAI(prompt:string,action:'chat'|'fix'='chat'){
    if(aiLock.current||runLock.current||!prompt.trim())return;
    if(!hasAI){setConnectionOpen(true);setKeyDraft('');return;}
    const source=file.code,lang=language,version=requestVersion.current;
    aiLock.current=true;setAiBusy(true);setAiStatus(action==='fix'?'Looking for a careful fix…':'Thinking it through…');openTool('ai',true);setMobileTab('tools');setDraft('');
    addMessage({role:'user',language:lang,content:prompt});
    try{
      const answer=await getAI(action,prompt,source,lang,result?.stderr.slice(0,12000)||'');
      if(version===requestVersion.current)addMessage({role:'assistant',language:lang,content:answer.explanation,code:answer.code??undefined,changes:answer.changes});
    }catch(error){if(version===requestVersion.current)addMessage({role:'assistant',content:error instanceof Error&&error.name==='AbortError'?'The request stopped or timed out. Your code is saved; please try again.':error instanceof Error?error.message:'AI could not respond. Try again.'});}
    finally{aiLock.current=false;setAiBusy(false);}
  }
  function applyCode(code:string,lang:Language){
    updateSession(s=>({...checkpoint(s,lang,s.files[lang].code,'Before applying AI suggestion'),language:lang,files:{...s.files,[lang]:{...s.files[lang],code}}}));
    setToast('Suggestion applied. Press Run to test it.');setMobileTab('editor');setToolsExpanded(false);focusEditor();
  }
  function undoFix(){
    const last=[...session.checkpoints].reverse().find(c=>c.language===language);
    if(!last){setToast('No previous code checkpoint yet.');return;}
    updateSession(s=>({...s,files:{...s.files,[language]:{...s.files[language],code:last.code}},checkpoints:s.checkpoints.filter(c=>c.id!==last.id)}));setToast('Previous code restored.');
  }
  function newSession(){
    requestVersion.current++;cancelRun.current?.();cancelAI.current?.abort();
    const fresh=createSession();setSession(fresh);sessionRef.current=fresh;setResult(null);setDraft('');setToolTab('output');setToolsExpanded(false);setNewSessionOpen(false);setToast('A fresh start. Happy building.');
  }
  function stopRun(){
    requestVersion.current++;cancelRun.current?.();cancelAI.current?.abort();
    setToast('Stopped. Your current code is saved.');
  }
  async function importSession(event:React.ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0];if(!selected)return;
    if(selected.size>25000000){setToast('That session file is too large.');return;}
    const imported=parseSession(await selected.text());
    if(!imported){setToast('This file is not a valid Spark session.');return;}
    requestVersion.current++;cancelRun.current?.();cancelAI.current?.abort();setSession(imported);sessionRef.current=imported;setResult(null);setToast('Session imported, including code and conversation.');event.target.value='';
  }
  const previousCode=session.checkpoints.some(c=>c.language===language);
  const activeTool=TOOL_TABS.find(tab=>tab.id===toolTab)!;
  return <div className={`app-shell ${focusMode?'focus-mode':''}`}>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Spark home"><span className="brand-icon"><Zap size={22} fill="currentColor"/></span>spark<span className="brand-dot">.</span></a>
      <span className="header-separator"/><span className="playground-label">playground <span className="beta">BETA</span></span>
      <div className="header-actions">
        <span className={`save-status ${!saved?'warning':''}`}><span className="status-dot"/>{!ready?'Opening session':saved?'All changes saved':'Browser storage unavailable'}</span>
        <button className="ghost-button session-export" onClick={()=>{download(exportSession(session),'spark-session.json','application/json');setToast('Session exported.');}}><ArrowDownToLine size={15}/><span>Export session</span></button>
        <button className="new-session-button" onClick={()=>setNewSessionOpen(true)} disabled={running||aiBusy}><Plus size={15}/><span>New session</span></button>
        <span className="header-separator"/>
        <div className="workspace-view-controls"><button className="icon-button tools-toggle" aria-label={toolsOpen?'Hide tools panel':'Show tools panel'} aria-expanded={toolsOpen} title={toolsOpen?'Hide tools panel':'Show tools panel'} onClick={()=>{setToolsOpen(value=>!value);setToolsExpanded(false);setMobileTab('tools');}}>{toolsOpen?<PanelRightClose size={18}/>:<PanelRightOpen size={18}/>}</button></div>
        <button className={`connection-button ${hasAI?'connected':''}`} onClick={()=>{setKeyDraft('');setConnectionOpen(true);}}><span className="status-dot"/>{hasAI?'AI connected':'Connect AI'}<Settings2 size={14}/></button>
      </div>
    </header>
    <div className="app-body">
      <aside className="rail" aria-label="Workspace navigation"><div className="rail-top">
        <button className="rail-button selected" aria-label="Focus code editor" title="Code editor" onClick={()=>{setToolsExpanded(false);setMobileTab('editor');}}><FolderCode size={20}/></button>
        <button className={`rail-button ${toolsOpen&&toolTab==='output'?'selected':''}`} aria-label="Show output" title="Output" onClick={()=>openTool('output')}><Terminal size={20}/></button>
        <button className={`rail-button ${toolsOpen&&toolTab==='ai'?'selected':''}`} aria-label="Show Spark AI" title="Spark AI" onClick={()=>openTool('ai')}><Sparkles size={20}/></button>
        <button className={`rail-button ${toolsOpen&&toolTab==='history'?'selected':''}`} aria-label="Run history" title="Run history" onClick={()=>openTool('history')}><History size={20}/></button>
      </div><div className="rail-bottom"><button className="rail-button" title="Guide and keyboard shortcuts" aria-label="Help" onClick={()=>setHelpOpen(true)}><CircleHelp size={20}/></button><div className="local-avatar" title="Your private browser workspace">you</div></div></aside>
      <main className="main-workspace" aria-label="Compiler workspace">
        <nav className="mobile-tabs" aria-label="Workspace panels">
          <button className={mobileTab==='editor'?'active':''} aria-pressed={mobileTab==='editor'} onClick={()=>setMobileTab('editor')}><Code2 size={15}/>Code</button>
          {TOOL_TABS.map(({id,label,icon:Icon})=><button key={id} className={mobileTab==='tools'&&toolTab===id?'active':''} aria-pressed={mobileTab==='tools'&&toolTab===id} onClick={()=>openTool(id)}><Icon size={15}/>{id==='ai'?'AI':label}</button>)}
        </nav>
        <div ref={gridRef} className={`workspace-grid ${!toolsOpen||focusMode?'tools-hidden':''} ${toolsExpanded&&!focusMode?'tools-maximized':''}`} style={{'--editor-width':`${editorWidth}%`} as CSSProperties}>
          <section className={`code-column ${mobileTab!=='editor'?'mobile-hidden':''}`} aria-label="Source code">
            <div className="editor-card">
              <div className="editor-toolbar"><div className="file-tab"><span className={`language-mark ${info.className}`}>{info.mark}</span><span>{info.file}</span><span className="file-dot"/></div><div className="editor-tools"><button className="icon-button focus-mode-button" aria-label={focusMode?'Exit editor focus mode':'Focus editor'} title={focusMode?'Exit focus mode (Esc)':'Focus editor'} onClick={toggleEditorFocus}>{focusMode?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button><button className="icon-button undo-button" aria-label="Undo AI change" title="Undo last AI change" onClick={undoFix} disabled={!previousCode||running||aiBusy}><RotateCcw size={15}/></button><div className="language-select"><select aria-label="Programming language" value={language} disabled={running||aiBusy} onChange={e=>{const lang=e.target.value as Language;updateSession(s=>({...s,language:lang}));setResult(null);setCursor({line:1,col:1});}}>{Object.entries(languageInfo).map(([key,value])=><option key={key} value={key}>{value.name}</option>)}</select><ChevronDown size={13}/></div><div className="editor-menu"><button className="icon-button" aria-label="File options" onClick={()=>setMenuOpen(!menuOpen)}><MoreHorizontal size={19}/></button>{menuOpen?<div className="dropdown"><button onClick={()=>{download(file.code,info.file);setMenuOpen(false);}}><ArrowDownToLine size={14}/>Download code</button><button onClick={()=>{navigator.clipboard.writeText(file.code).then(()=>setToast('Code copied.')).catch(()=>setToast('Clipboard is unavailable. Download your code instead.'));setMenuOpen(false);}}><Copy size={14}/>Copy code</button><button onClick={()=>{importRef.current?.click();setMenuOpen(false);}}><Upload size={14}/>Import session</button></div>:null}</div></div></div>
              <div className="editor-container">{ready?<CodeEditor code={file.code} language={language} onChange={updateCode} onCursor={(line,col)=>setCursor({line,col})}/>:<div className="editor-loading"><LoaderCircle className="spin" size={20}/> Restoring your workspace…</div>}</div>
              <div className="editor-bottom"><div className="autofix-control"><button role="switch" aria-checked={session.autoFix} aria-label="Automatically fix errors" className={`toggle ${session.autoFix?'on':''}`} onClick={()=>updateSession(s=>({...s,autoFix:!s.autoFix}))}><span/></button><WandSparkles size={14}/><span>Auto-fix errors</span><span className="info-tooltip" title="When a run fails, AI applies one repair, explains it, and runs it again. You can undo the change."><CircleHelp size={12}/></span></div><span className="editor-session-label"><ShieldCheck size={12}/>Saved in this browser</span><span className="cursor-location">Ln {cursor.line}, Col {cursor.col}</span><button className={`run-button ${running?'running':''}`} disabled={aiBusy&&!running||!ready} onClick={()=>running?stopRun():void runCode()}>{running?<Square size={13} fill="currentColor"/>:<Play size={13} fill="currentColor"/>}{running?'Stop':'Run code'}{!running?<kbd>⌘ ↵</kbd>:null}</button></div>
            </div>
          </section>
          <ResizeHandle value={editorWidth} min={resizeBounds.min} max={resizeBounds.max} onChange={setEditorWidth} containerRef={gridRef} label="Resize editor and tools" onReset={()=>setEditorWidth(Math.min(resizeBounds.max,Math.max(resizeBounds.min,65)))}/>
          <aside className={`tool-panel ${mobileTab!=='tools'?'mobile-hidden':''}`} aria-label="Compiler tools">
            <header className="tool-panel-header">
              <span className="tool-panel-mobile-title">{activeTool.label}</span>
              <div className="tool-tabs" role="tablist" aria-label="Compiler tools" onKeyDown={navigateToolTabs}>
                {TOOL_TABS.map(({id,label,icon:Icon})=><button key={id} type="button" role="tab" id={`tool-tab-${id}`} aria-selected={toolTab===id} aria-controls="tool-pane" tabIndex={toolTab===id?0:-1} className={toolTab===id?'active':''} onClick={()=>openTool(id)}><Icon size={14}/><span>{label}</span>{id==='output'&&result?<span className={`tab-dot ${result.exitCode===0?'success':'error'}`}/>:null}{id==='ai'&&aiBusy?<span className="tab-dot ai-working"/>:null}</button>)}
              </div>
              <div className="tool-panel-actions">
                <button className="icon-button tool-expand" aria-label={toolsExpanded?'Restore split view':'Expand tools panel'} title={toolsExpanded?'Restore split view':'Expand tools panel'} onClick={()=>setToolsExpanded(value=>!value)}>{toolsExpanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>
                <button className="icon-button tool-panel-close" aria-label="Close tools panel" title="Close tools panel" onClick={closeTools}><X size={16}/></button>
              </div>
            </header>
            <div id="tool-pane" className="tool-pane" role="tabpanel" tabIndex={-1} aria-labelledby={`tool-tab-${toolTab}`}>
            {toolTab==='output'||toolTab==='input'?<>
            <section className="console-card" aria-label={toolTab==='input'?'Program input':'Program output'}><div className="console-toolbar"><span className="console-heading">{toolTab==='input'?'Standard input':'Program output'}</span><div className="console-actions">{result?<span className={`exit-badge ${result.exitCode===0?'success':'error'}`}>{result.exitCode===0?<Check size={12}/>:null}{result.exitCode===0?'Completed':result.exitCode===130?'Stopped':'Exit '+result.exitCode}<span>·</span>{result.durationMs<1000?Math.round(result.durationMs)+' ms':(result.durationMs/1000).toFixed(1)+' s'}</span>:null}<button className="icon-button" aria-label="Clear output" title="Clear output" onClick={()=>setResult(null)} disabled={running}><Trash2 size={14}/></button></div></div>
              {toolTab==='input'?<div className="stdin-panel"><p>Program input <span>— one value per line</span></p><textarea aria-label="Program input" placeholder="Type the input your program needs…" value={file.stdin} maxLength={12000} onChange={e=>updateSession(s=>({...s,files:{...s.files,[language]:{...s.files[language],stdin:e.target.value}}}))}/><small>Python input(), C/C++ standard input, Java Scanner, or JavaScript readline().</small></div>:<div className="output-area" aria-live="polite">{running?<div className="runtime-status"><LoaderCircle className="spin" size={13}/>{runStatus||'Running your code…'}</div>:null}{result?<><pre className="stdout">{result.stdout}</pre>{result.stderr?<pre className="stderr">{result.stderr}</pre>:null}{!result.stdout&&!result.stderr?<div className="no-output">Program finished without output.</div>:null}</>:!running?<div className="console-empty"><div className="terminal-illustration"><Terminal size={23}/><span>_</span></div><div>Your next “it works!” moment starts here.</div><p>Run your code to see the output. <kbd>⌘ Enter</kbd></p></div>:null}</div>}
            </section>            </>:<>
          <section className="assistant-card">
            <header className="assistant-header"><div><span className="assistant-logo">{toolTab==='history'?<History size={16}/>:<Sparkles size={16}/>}</span><strong>{toolTab==='history'?'Run history':'Spark AI'}</strong><span className="assistant-caption">{toolTab==='history'?'Your latest 40 runs':'Your coding sidekick'}</span></div></header>
            {toolTab==='history'?<div className="history-panel"><div className="history-intro"><h2>A little progress, saved.</h2><p>Your latest 40 runs stay in this browser.</p></div>{session.runs.length===0?<div className="history-empty"><History size={28}/><p>Your first run is the beginning.</p><span>Run some code and it will show up here.</span></div>:[...session.runs].reverse().map(run=><div className="history-item" key={run.id}><div className="history-item-heading"><span className={run.exitCode===0?'success-text':'error-text'}>{run.exitCode===0?<Check size={14}/>:<X size={14}/>} {languageInfo[run.language].name}</span><time>{timeLabel(run.createdAt)}</time><button onClick={()=>{updateSession(s=>({...checkpoint(s,run.language,s.files[run.language].code,'Before restoring a run'),language:run.language,files:{...s.files,[run.language]:{...s.files[run.language],code:run.code}}}));setResult(run);setMobileTab('editor');setToolsExpanded(false);focusEditor();setToast('Code from this run restored.');}} disabled={running||aiBusy} title="Restore code from this run"><RotateCcw size={13}/>Restore</button></div><pre>{run.stdout||run.stderr||'No output'}</pre><small>{run.exitCode===0?'Completed':'Exit '+run.exitCode} · {Math.round(run.durationMs)} ms</small></div>)}</div>:<>
              <div className="assistant-scroll" ref={scrollRef}>
                {session.messages.length===0?<div className="assistant-welcome"><div className="spark-orbit"><span>✦</span><span className="orbit-dot"/><span className="orbit-mini">✧</span></div><div className="hello-label">A GOOD IDEA DESERVES A LITTLE SPARK</div><h2>You bring the idea.<br/>I’ll help with the code.</h2><p>Stuck on an error? Curious about a line?<br/>Let’s figure it out, together.</p><div className="suggestions"><button onClick={()=>void askAI('Explain this code step by step. Use simple language, tell me what each important line does, and show the expected output.')}><span className="suggestion-icon purple"><BookOpen size={17}/></span><span><strong>Walk me through this code</strong><small>Understand the what and the why</small></span><ArrowUpRight size={15}/></button><button onClick={()=>void askAI('Check my current code for syntax errors and bugs. If there is an error, suggest the smallest correction and explain why.', 'fix')}><span className="suggestion-icon peach"><WandSparkles size={17}/></span><span><strong>Find & fix an error</strong><small>A fix that makes sense to you</small></span><ArrowUpRight size={15}/></button><button onClick={()=>{setDraft('Help me write a program that ');document.getElementById('ai-prompt')?.focus();}}><span className="suggestion-icon green"><Braces size={17}/></span><span><strong>Build something new</strong><small>Turn that “what if” into code</small></span><ArrowUpRight size={15}/></button></div><div className="welcome-note"><ShieldCheck size={13}/>No account. Just you and your ideas.</div></div>:<div className="messages">{session.messages.map(message=><article className={`chat-message ${message.role}`} key={message.id}><div className="message-avatar">{message.role==='assistant'?<Sparkles size={14}/>:<span>you</span>}</div><div className="message-body"><div className="message-meta"><strong>{message.role==='assistant'?'Spark':'You'}</strong><time>{timeLabel(message.createdAt)}</time></div><MessageText text={message.content}/>{message.changes?.length?<ul className="change-list">{message.changes.map((change,i)=><li key={i}><Check size={12}/>{change}</li>)}</ul>:null}{message.code?<div className="suggested-code"><div><FileCode2 size={13}/>Suggested code <button onClick={()=>applyCode(message.code!,message.language||language)} disabled={running||aiBusy||!message.language}><Check size={12}/>Apply to editor</button></div><pre><code>{message.code}</code></pre></div>:null}</div></article>)}</div>}
                {aiBusy?<div className="ai-thinking"><span className="assistant-logo"><Sparkles size={14}/></span><span>{aiStatus}</span><span className="thinking-dots"><i/><i/><i/></span></div>:null}
              </div>
              <div className="assistant-bottom"><div className="memory-row"><span><span className="status-dot"/>Session memory on</span><span>{session.messages.length?session.messages.length+' messages':'Your context, connected'}<button className="icon-button memory-help" aria-label="About session memory" onClick={()=>setHelpOpen(true)}><CircleHelp size={12}/></button></span></div><form className="prompt-box" onSubmit={e=>{e.preventDefault();void askAI(draft);}}><textarea id="ai-prompt" aria-label="Ask Spark AI" placeholder="Ask anything about your code…" value={draft} maxLength={8000} disabled={aiBusy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void askAI(draft);}}}/><div className="prompt-bottom"><span><Code2 size={12}/>{info.file} <span className="context-check"><Check size={10}/></span></span><button type="submit" aria-label="Send message" disabled={!draft.trim()||aiBusy||running}><Send size={15}/></button></div></form><p className="ai-footnote">Made for learning. Always review AI suggestions.</p></div>
            </>}
          </section>            </>}
            </div>
          </aside>
        </div>
      </main>
    </div>
    <input ref={importRef} hidden disabled={running||aiBusy} type="file" accept="application/json,.json" onChange={importSession}/>
    {toast?<div className="toast" role="status"><Sparkles size={15}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={14}/></button></div>:null}
    {connectionOpen?<div className="modal-backdrop" onClick={()=>setConnectionOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close connection settings" onClick={()=>setConnectionOpen(false)}><X size={19}/></button><span className="modal-icon"><KeyRound size={24}/></span><h2 id="connect-title">Give your code a little Spark.</h2><p>{serverAI?'Groq is connected and ready. You can also use a personal key for this visit.':'Connect a Groq API key to unlock explanations, code generation, and automatic error fixes.'}</p><label htmlFor="api-key">Groq API key</label><input autoFocus id="api-key" type="password" value={keyDraft} placeholder="gsk_…" autoComplete="off" spellCheck={false} onChange={e=>setKeyDraft(e.target.value)}/><div className="key-privacy"><ShieldCheck size={15}/><span>Your personal key stays in memory for this visit. It is never included in saved or exported sessions.</span></div><button className="primary-button" disabled={!keyDraft.trim().startsWith('gsk_')} onClick={()=>{setApiKey(keyDraft.trim());setKeyDraft('');setConnectionOpen(false);setToast('Groq connected for this visit.');}}><Sparkles size={15}/>Connect Groq</button>{apiKey?<button className="text-button" onClick={()=>{setApiKey('');setKeyDraft('');setToast('Personal key removed.');}}>Remove personal key</button>:null}<a className="get-key" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a key from Groq <ArrowUpRight size={13}/></a></section></div>:null}
    {helpOpen?<div className="modal-backdrop" onClick={()=>setHelpOpen(false)}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close help" onClick={()=>setHelpOpen(false)}><X size={19}/></button><span className="modal-icon"><BookOpen size={24}/></span><h2 id="help-title">A small guide to big ideas.</h2><div className="help-block"><strong>Write. Run. Understand.</strong><p>Pick a language, write your code, and press Run. Use the Input tab on the right for standard input. Drag the divider to resize, expand either pane, or hide the tools panel for a wider editor.</p></div><div className="help-block"><strong>Errors are part of the process.</strong><p>With Auto-fix on, a failed run sends the error and code to Groq. Spark makes one repair, explains it, and runs it again. The undo button restores your previous code.</p></div><div className="help-block"><strong>Your session stays with you.</strong><p>Code, chat, and recent runs save in this browser. AI receives your current code and the latest 200 messages, within a 160,000-character conversation limit. Export your session to keep a backup or move browsers. Clearing browser data removes local memory.</p></div><div className="help-block"><strong>Runtime details</strong><p>Python runs through Pyodide. JavaScript and TypeScript run in browser workers. C, C++, and Java use a remote compiler. Internet access is needed. Package and runtime availability depend on the selected language.</p></div><div className="shortcut-row"><span>Run code</span><kbd>⌘ / Ctrl + Enter</kbd></div><div className="shortcut-row"><span>Save session</span><kbd>⌘ / Ctrl + S</kbd></div></section></div>:null}
    {newSessionOpen?<div className="modal-backdrop" onClick={()=>setNewSessionOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e=>e.stopPropagation()}><span className="modal-icon"><Plus size={24}/></span><h2 id="new-title">Room for a new idea?</h2><p>A new session replaces this browser’s current workspace and conversation. Export it first if you want to keep a copy.</p><button className="secondary-button full" onClick={()=>download(exportSession(session),'spark-session.json','application/json')}><ArrowDownToLine size={15}/>Export current session</button><div className="modal-actions"><button className="secondary-button" onClick={()=>setNewSessionOpen(false)}>Keep working</button><button className="primary-button" onClick={newSession}>Start fresh<ArrowUpRight size={15}/></button></div></section></div>:null}
  </div>;
}
