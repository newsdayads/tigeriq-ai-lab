const PATCH_BEGIN='-----BEGIN TIGERIQ_PATCH_V1-----';
const PATCH_OLD='-----OLD-----';
const PATCH_NEW='-----NEW-----';
const PATCH_END='-----END TIGERIQ_PATCH_V1-----';
const CREATE_BEGIN='-----BEGIN TIGERIQ_CREATE_V1-----';
const CREATE_CONTENT='-----CONTENT-----';
const CREATE_END='-----END TIGERIQ_CREATE_V1-----';

function skipWhitespace(text,pos){while(pos<text.length&&/\s/.test(text[pos]))pos++;return pos}
function readLine(text,pos){
  const end=text.indexOf('\n',pos);
  if(end<0)return {line:text.slice(pos).replace(/\r$/,''),next:text.length};
  return {line:text.slice(pos,end).replace(/\r$/,''),next:end+1};
}
function pathLine(text,pos){
  const row=readLine(text,pos);
  const m=row.line.match(/^PATH:(.+)$/);
  if(!m||!m[1].trim())throw new Error('MUTATION_ENVELOPE_PATH_MISSING');
  return {path:m[1].trim(),next:row.next};
}
function expectLine(text,pos,expected){
  const row=readLine(text,pos);
  if(row.line!==expected)throw new Error('MUTATION_ENVELOPE_MALFORMED');
  return row.next;
}
function findBoundary(text,pos,marker){
  const needle='\n'+marker;
  const idx=text.indexOf(needle,pos);
  if(idx<0)throw new Error('MUTATION_ENVELOPE_MALFORMED');
  return idx;
}
function afterMarkerLine(text,markerStart,marker){
  let pos=markerStart+1+marker.length;
  if(text[pos]==='\r')pos++;
  if(text[pos]==='\n')pos++;
  return pos;
}

export function parseMutationEnvelope(raw,{maxMutations=12,maxBytes=240000}={}){
  const text=String(raw||'');
  const edits=[],creates=[];
  const createPaths=new Set();
  let pos=skipWhitespace(text,0),bytes=0,count=0;
  while(pos<text.length){
    if(text.startsWith(PATCH_BEGIN,pos)){
      pos+=PATCH_BEGIN.length;
      if(text[pos]==='\r')pos++;
      if(text[pos]==='\n')pos++; else throw new Error('MUTATION_ENVELOPE_MALFORMED');
      const pathRow=pathLine(text,pos); pos=pathRow.next;
      pos=expectLine(text,pos,PATCH_OLD);
      const oldEnd=findBoundary(text,pos,PATCH_NEW);
      const old=text.slice(pos,oldEnd);
      pos=afterMarkerLine(text,oldEnd,PATCH_NEW);
      const newEnd=findBoundary(text,pos,PATCH_END);
      const next=text.slice(pos,newEnd);
      pos=afterMarkerLine(text,newEnd,PATCH_END);
      if(!old||old===next)throw new Error('MUTATION_ENVELOPE_PATCH_INVALID');
      edits.push({path:pathRow.path,old,new:next});
      bytes+=Buffer.byteLength(old,'utf8')+Buffer.byteLength(next,'utf8');
    }else if(text.startsWith(CREATE_BEGIN,pos)){
      pos+=CREATE_BEGIN.length;
      if(text[pos]==='\r')pos++;
      if(text[pos]==='\n')pos++; else throw new Error('MUTATION_ENVELOPE_MALFORMED');
      const pathRow=pathLine(text,pos); pos=pathRow.next;
      pos=expectLine(text,pos,CREATE_CONTENT);
      const contentEnd=findBoundary(text,pos,CREATE_END);
      const content=text.slice(pos,contentEnd);
      pos=afterMarkerLine(text,contentEnd,CREATE_END);
      if(createPaths.has(pathRow.path))throw new Error('MUTATION_ENVELOPE_DUPLICATE_CREATE');
      createPaths.add(pathRow.path);
      creates.push({path:pathRow.path,content});
      bytes+=Buffer.byteLength(content,'utf8');
    }else{
      throw new Error('MUTATION_ENVELOPE_MALFORMED');
    }
    count++;
    if(count>maxMutations)throw new Error('MUTATION_ENVELOPE_TOO_MANY');
    if(bytes>maxBytes)throw new Error('MUTATION_ENVELOPE_TOO_LARGE');
    pos=skipWhitespace(text,pos);
  }
  if(!count)throw new Error('MUTATION_ENVELOPE_MISSING');
  for(const edit of edits)if(createPaths.has(edit.path))throw new Error('MUTATION_ENVELOPE_CREATE_EDIT_COLLISION');
  return {edits,creates};
}

export function wrapPatch(path,old,next){
  return [PATCH_BEGIN,`PATH:${path}`,PATCH_OLD,String(old??''),PATCH_NEW,String(next??''),PATCH_END].join('\n');
}
export function wrapCreate(path,content){
  return [CREATE_BEGIN,`PATH:${path}`,CREATE_CONTENT,String(content??''),CREATE_END].join('\n');
}
