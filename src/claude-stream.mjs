import { must,Fault } from './core.mjs';
// Complete raw SSE is persisted by the single-call ledger before this parser runs.
// Unlike the reference parser, explicit error events are never swallowed.
export function parseClaudeSse(raw) {
  let message=null,ended=false;const open=new Set(),blocks=new Map();
  for(const block of raw.replaceAll('\r\n','\n').split('\n\n')) {
    const lines=block.split('\n'),event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim(),text=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!text)continue;
    let d;try{d=JSON.parse(text);}catch{throw new Fault('CLAUDE_STREAM_JSON','Evento SSE inválido; resposta preservada, geração não será repetida.');}
    const type=d.type||event;
    if(type==='error')throw new Fault('CLAUDE_STREAM_ERROR','Claude informou erro explícito no stream; nenhuma continuação será feita.');
    if(type==='message_start'){must(!message,'CLAUDE_STREAM_ORDER','Mensagem repetida no stream.');message={...d.message,content:[]};}
    else if(type==='content_block_start'){must(message&&!ended&&!blocks.has(d.index),'CLAUDE_STREAM_ORDER','Bloco fora de ordem.');blocks.set(d.index,{...d.content_block});open.add(d.index);}
    else if(type==='content_block_delta'){must(open.has(d.index),'CLAUDE_STREAM_ORDER','Delta sem bloco aberto.');if(d.delta.type==='text_delta')blocks.get(d.index).text=(blocks.get(d.index).text||'')+d.delta.text;}
    else if(type==='content_block_stop'){must(open.delete(d.index),'CLAUDE_STREAM_ORDER','Fim de bloco sem início.');}
    else if(type==='message_delta'){must(message&&!ended,'CLAUDE_STREAM_ORDER','Delta de mensagem fora de ordem.');Object.assign(message,d.delta);message.usage={...message.usage,...d.usage};}
    else if(type==='message_stop'){must(message&&!open.size&&!ended,'CLAUDE_STREAM_ORDER','Mensagem encerrada com bloco incompleto.');ended=true;}
  }
  must(ended&&message?.stop_reason,'CLAUDE_INCOMPLETE','Stream sem message_stop/stop_reason; chamada consumida.');
  message.content=[...blocks.entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b);return message;
}
