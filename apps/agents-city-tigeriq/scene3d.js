// Real WebGL low-poly Animal office. No network or unverified worker activity.
// Work/employee lights use ONLY the independently verified Core live projection.
(() => {
  'use strict';
  const host=document.querySelector('.city');
  const tabs=[...document.querySelectorAll('.room[data-room]')];
  if(!host||tabs.length!==3)return;
  const stage=document.createElement('div');
  stage.className='animal-scene';
  const canvas=document.createElement('canvas');
  canvas.id='animal3d';
  canvas.setAttribute('aria-label','Mô hình 3D: kéo xoay, cuộn phóng to, nhấn vào phòng');
  const label=document.createElement('div');label.className='scene-info';
  label.textContent='ANIMAL CITY · VĂN PHÒNG 3D · Kéo để xoay';
  const note=document.createElement('div');note.className='scene-footer';
  note.textContent='Nhân vật minh họa · Đèn xanh = worker đã được Core xác minh';
  const reset=document.createElement('button');reset.type='button';
  reset.className='scene-reset';reset.textContent='Góc chuẩn';
  stage.append(canvas,label,note,reset);
  host.insertBefore(stage,host.querySelector('.plaza'));
  const gl=canvas.getContext('webgl',{alpha:false,antialias:true});
  if(!gl){
    stage.replaceChildren();
    stage.textContent='WebGL không khả dụng; dữ liệu Core vẫn có thể xem bằng các phòng bên dưới.';
    return;
  }
  const vertSrc=[
    'attribute vec3 aPos,aNormal,aColor;',
    'attribute float aActive;',
    'uniform mat4 uVP;',
    'uniform float uTime;',
    'varying vec3 vColor;',
    'void main(){',
    'vec3 p=aPos; p.y+=aActive*.035*sin(uTime*3.2);',
    'gl_Position=uVP*vec4(p,1.0);',
    'vec3 light=normalize(vec3(-.55,.95,.8));',
    'float shade=.67+.33*max(dot(normalize(aNormal),light),0.);',
    'vColor=aColor*shade;',
    '}'
  ].join('\n');
  const fragSrc=[
    'precision mediump float;',
    'varying vec3 vColor;',
    'void main(){gl_FragColor=vec4(vColor,1.0);}'
  ].join('\n');
  function compile(type,src){
    const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('WEBGL_SHADER');
    return s;
  }
  let program;
  try{
    program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,vertSrc));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragSrc));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('WEBGL_LINK');
  }catch{
    stage.replaceChildren();stage.textContent='Trình duyệt không dựng được văn phòng WebGL.';return;
  }
  gl.useProgram(program);
  const colors=new Map();
  const names=['coordination','engineering','quality'],centers=[-4.2,0,4.2];
  const palette=[
    ['#9ab9ad','#c1ddcb','#468d8e','#b48760'],
    ['#afb9d1','#d7dbec','#7288c8','#ac805c'],
    ['#d9c4b3','#eedccd','#b78a79','#ba8c60']
  ];
  let vertex=[],active=0,count=0;
  function rgb(c){
    if(!colors.has(c)){
      const n=parseInt(c.slice(1),16);
      colors.set(c,[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]);
    }return colors.get(c);
  }
  function tri(a,b,c,n,col){
    const cc=rgb(col);
    for(const p of [a,b,c])vertex.push(...p,...n,...cc,active);
  }
  function quad(a,b,c,d,n,col){tri(a,b,c,n,col);tri(a,c,d,n,col)}
  function cube(x,y,z,w,h,d,col){
    const X=w/2,Y=h/2,Z=d/2;
    const p=[[x-X,y-Y,z-Z],[x+X,y-Y,z-Z],[x+X,y+Y,z-Z],[x-X,y+Y,z-Z],
      [x-X,y-Y,z+Z],[x+X,y-Y,z+Z],[x+X,y+Y,z+Z],[x-X,y+Y,z+Z]];
    quad(p[4],p[5],p[6],p[7],[0,0,1],col);
    quad(p[1],p[0],p[3],p[2],[0,0,-1],col);
    quad(p[5],p[1],p[2],p[6],[1,0,0],col);
    quad(p[0],p[4],p[7],p[3],[-1,0,0],col);
    quad(p[7],p[6],p[2],p[3],[0,1,0],col);
    quad(p[0],p[1],p[5],p[4],[0,-1,0],col);
  }
  function ball(x,y,z,rx,ry,rz,col){
    const nlat=8,nlon=12;
    const pt=(t,p)=>{
      const a=Math.sin(t)*Math.cos(p),b=Math.cos(t),c=Math.sin(t)*Math.sin(p);
      return [x+rx*a,y+ry*b,z+rz*c];
    };
    for(let i=0;i<nlat;i++)for(let j=0;j<nlon;j++){
      const t=Math.PI*i/nlat,T=Math.PI*(i+1)/nlat;
      const p=2*Math.PI*j/nlon,P=2*Math.PI*(j+1)/nlon;
      const a=pt(t,p),b=pt(T,p),c=pt(T,P),d=pt(t,P);
      const radial=q=>{
        const v=[(q[0]-x)/rx,(q[1]-y)/ry,(q[2]-z)/rz];
        const length=Math.hypot(...v)||1;return v.map(w=>w/length);
      };
      tri(a,b,c,radial(a),col);tri(a,c,d,radial(d),col);
    }
  }
  function ear(x,y,z,col){
    const a=[x-.14,y,z-.10],b=[x+.14,y,z-.10],
      c=[x+.14,y,z+.10],d=[x-.14,y,z+.10],t=[x,y+.42,z];
    quad(a,d,c,b,[0,-1,0],col);
    tri(a,b,t,[0,0,-1],col);tri(b,c,t,[1,0,0],col);
    tri(c,d,t,[0,0,1],col);tri(d,a,t,[-1,0,0],col);
  }
  function foliage(x,z){
    cube(x,.33,z,.33,.42,.32,'#cf986c');
    cube(x,.56,z,.08,.28,.08,'#447d5c');
    for(const [a,b,c] of [[-.15,.70,.04],[.13,.85,.08],[0,.99,-.13]])
      ball(x+a,b,z+c,.19,.10,.19,'#559d7b');
  }
  function mascot(x,z,kind,isWorking){
    const main=['#e99845','#ef9856','#f4f1ec'][kind];
    const white=['#fff0d6','#fdf0d5','#f9f7f0'][kind];
    active=0;
    ball(x,.12,z,.43,.035,.38,'#6a7b79');
    cube(x,.43,z-.23,.64,.13,.60,'#4c6a84');
    cube(x,.81,z-.48,.71,.78,.11,'#567b90');
    active=isWorking?1:0;
    ball(x,.75,z,.32,.40,.28,main);
    ball(x,.81,z+.20,.23,.25,.12,white);
    ball(x,1.27,z+.05,.39,.40,.36,main);
    if(kind===1){
      ear(x-.27,1.50,z,main);ear(x+.27,1.50,z,main);
    }else{
      ball(x-.28,1.57,z,.14,.17,.13,kind===2?'#303239':main);
      ball(x+.28,1.57,z,.14,.17,.13,kind===2?'#303239':main);
    }
    if(kind===2){
      ball(x-.18,1.33,z+.34,.17,.18,.059,'#30353e');
      ball(x+.18,1.33,z+.34,.17,.18,.059,'#30353e');
    }
    if(kind===0){
      cube(x,1.57,z+.33,.07,.17,.04,'#70492f');
      cube(x-.32,1.39,z+.25,.06,.16,.04,'#70492f');
      cube(x+.32,1.39,z+.25,.06,.16,.04,'#70492f');
    }
    ball(x,1.14,z+.36,.24,.16,.14,white);
    for(const off of [-.17,.17]){
      ball(x+off,1.32,z+.38,.056,.069,.043,'#25313b');
      ball(x+off-.015,1.35,z+.419,.02,.022,.017,'#fffefa');
    }
    ball(x,1.14,z+.48,.07,.045,.04,'#30313a');
    ball(x-.26,.71,z+.32,.14,.15,.15,main);
    ball(x+.26,.71,z+.32,.14,.15,.15,main);
    active=0;
  }
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [attrib,size,offset] of [['aPos',3,0],['aNormal',3,12],['aColor',3,24],['aActive',1,36]]){
    const p=gl.getAttribLocation(program,attrib);gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p,size,gl.FLOAT,false,40,offset);
  }
  const proj=gl.getUniformLocation(program,'uVP'),time=gl.getUniformLocation(program,'uTime');
  gl.enable(gl.DEPTH_TEST);gl.clearColor(.074,.14,.22,1);
  function build(busyRooms){
    vertex=[];
    cube(0,-.29,0,13.3,.23,5.25,'#57736d');
    cube(0,-.4,2.48,13,.2,.40,'#d7c09d');
    centers.forEach((x,i)=>{
      const [floor,wall,trim,wood]=palette[i],busy=busyRooms.has(names[i]);
      cube(x,-.08,0,3.9,.18,4.18,floor);
      for(let tile=0;tile<5;tile++)
        cube(x-1.43+tile*.72,.024,1.44,.64,.025,.72,tile%2?'#b0c6bc':'#c2d8ca');
      cube(x,.86,-2.0,3.8,1.83,.12,wall);
      cube(x-1.84,.58,-.69,.12,1.25,2.55,wall);
      cube(x+1.84,.58,-.69,.12,1.25,2.55,wall);
      cube(x,1.8,-2.0,3.92,.16,.22,trim);
      cube(x,.1,-2.0,3.92,.19,.2,trim);
      cube(x+1.0,1.11,-1.93,1.0,.86,.07,'#f6efdb');
      cube(x+1.0,1.11,-1.88,.86,.73,.04,'#94c6da');
      cube(x+1.0,1.1,-1.849,.04,.73,.03,'#ffefda');
      cube(x-.98,1.2,-1.9,.67,.54,.04,'#fff0d5');
      cube(x-.98,1.2,-1.85,.51,.38,.035,trim);
      foliage(x+1.43,-.87);
      cube(x-.1,.58,.65,1.72,.13,.88,wood);
      for(const dx of [-.68,.68])cube(x-.1+dx,.29,.65,.12,.48,.10,'#947150');
      cube(x+.38,.72,.34,.65,.07,.34,'#38475a');
      cube(x+.38,.97,.18,.67,.48,.065,'#2f475c');
      cube(x+.38,.97,.222,.52,.33,.024,busy?'#6feaaf':'#91bfde');
      cube(x-.14,.67,1.18,.39,.06,.20,'#f2e0c6');
      cube(x+.73,.72,1.17,.17,.19,.15,'#d4edf0');
      mascot(x-.5,-.30,i,busy);
      ball(x+1.41,1.63,-1.87,.09,.09,.09,busy?'#45e1a2':'#aab7bc');
      cube(x,-.12,2.10,3.91,.12,.13,trim);
    });
    const arr=new Float32Array(vertex);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);
    count=arr.length/10;
  }
  let busy=new Set();
  build(busy);
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=v=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d)};
  const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
  const mult=(a,b)=>{
    const m=new Float32Array(16);
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)
      for(let k=0;k<4;k++)m[col*4+row]+=a[k*4+row]*b[col*4+k];
    return m;
  };
  let theta=.33,elev=.62,zoom=17,pointer=null;
  function cam(distance){
    const eye=[distance*Math.sin(theta)*Math.cos(elev),
      .55+distance*Math.sin(elev),distance*Math.cos(theta)*Math.cos(elev)];
    const forward=norm(sub([0,.6,0],eye));
    const right=norm(cross(forward,[0,1,0]));
    const up=cross(right,forward);
    return {eye,forward,right,up};
  }
  function cameraMatrix(aspect,c){
    const {eye,forward:f,right:s,up:u}=c;
    const view=new Float32Array([s[0],u[0],-f[0],0,
      s[1],u[1],-f[1],0,s[2],u[2],-f[2],0,
      -dot(s,eye),-dot(u,eye),dot(f,eye),1]);
    const near=.1,far=100,S=1/Math.tan(Math.PI*.1);
    const perspective=new Float32Array([S/aspect,0,0,0,0,S,0,0,0,0,
      (far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
    return mult(perspective,view);
  }
  const effectiveDistance=asp=>zoom+(asp<1.2?10:0);
  function frame(t){
    if(document.visibilityState==='visible'){
      const size=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,2);
      const w=Math.max(1,Math.round(size.width*scale)),h=Math.max(1,Math.round(size.height*scale));
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(proj,false,cameraMatrix(w/h,cam(effectiveDistance(w/h))));
      gl.uniform1f(time,t/1000);
      gl.drawArrays(gl.TRIANGLES,0,count);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  function selectRoom(x,y){
    const b=canvas.getBoundingClientRect(),asp=b.width/b.height;
    const c=cam(effectiveDistance(asp)),tan=Math.tan(Math.PI*.1);
    const sx=((x-b.left)/b.width*2-1)*asp*tan,sy=(1-(y-b.top)/b.height*2)*tan;
    const ray=norm(c.forward.map((v,i)=>v+c.right[i]*sx+c.up[i]*sy));
    if(ray[1]>=-.0001)return;
    const dist=(0-c.eye[1])/ray[1];
    const xx=c.eye[0]+dist*ray[0],zz=c.eye[2]+dist*ray[2];
    if(zz < -2.3||zz>2.3)return;
    for(let i=0;i<3;i++)if(Math.abs(xx-centers[i])<1.9){
      tabs.find(x=>x.dataset.room===names[i])?.click();return;
    }
  }
  canvas.addEventListener('pointerdown',e=>{
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!pointer||e.pointerId!==pointer.id)return;
    theta=Math.max(-1.1,Math.min(1.1,theta-(e.clientX-pointer.x)*.006));
    elev=Math.max(.24,Math.min(1.2,elev+(e.clientY-pointer.y)*.005));
    pointer.x=e.clientX;pointer.y=e.clientY;
  });
  canvas.addEventListener('pointerup',e=>{
    if(pointer&&Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)<7)
      selectRoom(e.clientX,e.clientY);
    pointer=null;
  });
  canvas.addEventListener('pointercancel',()=>{pointer=null});
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();zoom=Math.max(12,Math.min(27,zoom+Math.sign(e.deltaY)*.7));
  },{passive:false});
  reset.addEventListener('click',()=>{theta=.33;elev=.62;zoom=17});
  window.addEventListener('tigeriq:live',e=>{
    const live=e.detail,next=new Set();
    if(live?.ok===true && live.liveWorkerBindingsVerified===true)
      for(const worker of live.workers||[])
        if(worker.activeWorkerVerified===true && names.includes(worker.room))next.add(worker.room);
    if(names.some(name=>next.has(name)!==busy.has(name))){busy=next;build(busy)}
  });
  stage.dataset.renderer='webgl';
})();