/** Synthetic APK/DEX fixtures only. No original APK, vendor class or device data. */
import { deflateRawSync } from 'node:zlib';
const le16=(b,o,v)=>b.writeUInt16LE(v,o);
const le32=(b,o,v)=>b.writeUInt32LE(v,o);
const bytes=s=>Buffer.from(s,'utf8');
export function makeDex({ badMagic=false } = {}) {
  const strings=[
    'Landroid/hardware/usb/UsbManager;', 'Landroid/app/ActivityOptions;',
    'Lsynthetic/private/NeverPublish;', 'requestPermission', 'setLaunchBounds', 'secretMethod',
  ];
  const ns=strings.length,nt=3,nproto=1,nm=3;
  const stringOff=112,typeOff=stringOff+4*ns,protoOff=typeOff+4*nt,methodOff=protoOff+12*nproto;
  const dataStart=methodOff+8*nm;
  const data=[];
  for(const s of strings){const buf=bytes(s);data.push(Buffer.concat([Buffer.from([buf.length]),buf,Buffer.from([0])]));}
  const b=Buffer.alloc(dataStart+data.reduce((n,x)=>n+x.length,0));
  b.write(badMagic?'bad!':'dex\n035\0',0,'ascii');
  le32(b,32,b.length);le32(b,36,112);le32(b,40,0x12345678);
  le32(b,56,ns);le32(b,60,stringOff);le32(b,64,nt);le32(b,68,typeOff);
  le32(b,72,nproto);le32(b,76,protoOff);le32(b,88,nm);le32(b,92,methodOff);
  let p=dataStart;
  for(let i=0;i<data.length;i++){le32(b,stringOff+i*4,p);data[i].copy(b,p);p+=data[i].length;}
  for(let i=0;i<nt;i++)le32(b,typeOff+i*4,i);
  const items=[[0,3],[1,4],[2,5]];
  for(let i=0;i<items.length;i++){le16(b,methodOff+i*8,items[i][0]);le16(b,methodOff+i*8+2,0);le32(b,methodOff+i*8+4,items[i][1]);}
  return b;
}
let tbl;
function crc32(b) {
  if(!tbl)tbl=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
  let c=0xffffffff;for(const v of b)c=(c>>>8)^tbl[(c^v)&255];return (c^0xffffffff)>>>0;
}

/**
 * Synthetic malformed ZIP: a second central-directory record aliases the same
 * local classes.dex entry. Parsers must not count one DEX twice.
 */
export function makeDuplicateDexCentralEntry() {
  const original = makeZip();
  const end = original.length - 22;
  const start = original.readUInt32LE(end + 16);
  const size = original.readUInt32LE(end + 12);
  const centralEntry = original.subarray(start, start + size);
  const out = Buffer.concat([
    original.subarray(0, end),
    centralEntry,
    original.subarray(end),
  ]);
  const newEnd = out.length - 22;
  out.writeUInt16LE(2, newEnd + 8);
  out.writeUInt16LE(2, newEnd + 10);
  out.writeUInt32LE(size * 2, newEnd + 12);
  return out;
}

export function makeZip(entryName='classes.dex',content=makeDex(),{compressed=false, corruptCRC=false, encrypted=false}={}){
  const name=bytes(entryName),zipBytes=compressed?deflateRawSync(content):content;
  const crc=crc32(content)^(corruptCRC?0x1234:0),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  le32(local,0,0x04034b50);le16(local,6,encrypted?1:0);le16(local,8,compressed?8:0);le32(local,14,crc);
  le32(local,18,zipBytes.length);le32(local,22,content.length);le16(local,26,name.length);
  const localSize=local.length+name.length+zipBytes.length;
  le32(central,0,0x02014b50);le16(central,8,encrypted?1:0);le16(central,10,compressed?8:0);
  le32(central,16,crc);le32(central,20,zipBytes.length);le32(central,24,content.length);
  le16(central,28,name.length);le32(central,42,0);
  le32(end,0,0x06054b50);le16(end,8,1);le16(end,10,1);le32(end,12,central.length+name.length);le32(end,16,localSize);
  return Buffer.concat([local,name,zipBytes,central,name,end]);
}
