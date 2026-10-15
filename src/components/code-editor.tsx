'use client';
import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import type { Language } from '@/lib/session';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const theme = EditorView.theme({
  '&': {height:'100%',backgroundColor:'#15171e',color:'#dadce5',fontSize:'14px'},
  '.cm-scroller':{fontFamily:'"SFMono-Regular", Consolas, "Liberation Mono", monospace',lineHeight:'1.85'},
  '.cm-content':{padding:'22px 0',caretColor:'#c3a8ff'},
  '.cm-line':{padding:'0 24px 0 12px'},
  '.cm-gutters':{backgroundColor:'#15171e',color:'#565c70',border:'none',padding:'22px 12px 0 12px',minWidth:'54px'},
  '.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'#ffffff04'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'#b49ae52b'},
  '&.cm-focused':{outline:'none'},
  '.cm-cursor':{borderLeftColor:'#c3a8ff'},
  '.cm-foldPlaceholder':{backgroundColor:'#272a35',border:'none',color:'#bba3f3'},
  '.cm-tooltip':{backgroundColor:'#22252f',border:'1px solid #3b3e4b',color:'#ddd'}
},{dark:true});
const highlighting = HighlightStyle.define([
  {tag:tags.keyword,color:'#c6a5ed'}, {tag:tags.string,color:'#b6d49b'},
  {tag:tags.comment,color:'#6f788b',fontStyle:'italic'}, {tag:tags.number,color:'#e5bb88'},
  {tag:tags.function(tags.variableName),color:'#90bce8'}, {tag:tags.definition(tags.variableName),color:'#e2cc94'},
  {tag:tags.operator,color:'#bda6e8'}, {tag:tags.bool,color:'#e3aa86'}, {tag:tags.typeName,color:'#e3cc92'}
]);
export default function CodeEditor({code,language,onChange,onCursor}:{code:string;language:Language;onChange:(code:string)=>void;onCursor:(line:number,col:number)=>void}) {
  const extensions = useMemo(()=>[language==='python'?python():language==='java'?java():language==='c'||language==='cpp'?cpp():javascript({typescript:language==='typescript'}),syntaxHighlighting(highlighting),EditorView.lineWrapping],[language]);
  return <CodeMirror aria-label="Code editor" value={code} height="100%" extensions={extensions} theme={theme} basicSetup={{autocompletion:true,bracketMatching:true,foldGutter:true,highlightActiveLine:true,highlightSelectionMatches:true}} onChange={onChange} onUpdate={v=>{if(v.selectionSet){const p=v.state.selection.main.head,l=v.state.doc.lineAt(p);onCursor(l.number,p-l.from+1);}}}/>;
}
