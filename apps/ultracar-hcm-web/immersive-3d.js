/* UltraCarHCM CSS-3D interaction controller — original geometry, no external dependencies. */
(()=>{
'use strict';
const root=document.querySelector('#mo-phong-3d');if(!root)return;
const $=s=>root.querySelector(s);
const model=$('#ucx3dModel'),stage=$('#ucx3dStage'),angle=$('#ucx3dAngle'),display=$('#ucx3dAngleValue'),status=$('#ucx3dAngleStatus');
if(!model||!stage||!angle)return;
const reduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let rx=-9,ry=-20,spinning=!reduced,visible=false,dragging=false,raf=0,lastTime=0,slide=false,step=0,assemblyVisible=false,stepTimer=0,manualStep=false;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const wrap=v=>((v+180)%360+360)%360-180;
const btnAuto=$('#ucx3dAuto');
function render(){
 model.style.setProperty('--ucx3d-rx',rx.toFixed(1)+'deg');
 model.style.setProperty('--ucx3d-ry',ry.toFixed(1)+'deg');
 const value=Math.round(wrap(ry));
 angle.value=String(value);
 display.textContent=(value>0?'+':'')+value+'°';
 status.textContent=Math.abs(value)>95?'Mặt sau':'Mặt trước';
}
function setAngles(y,x=rx){ry=wrap(y);rx=clamp(x,-38,38);render()}
function animate(time){
 raf=0;
 if(!spinning||reduced||!visible||document.hidden||dragging)return;
 const dt=lastTime?Math.min(55,time-lastTime):16;lastTime=time;
 ry=wrap(ry+dt*.024);render();raf=requestAnimationFrame(animate);
}
function startAnimation(){
 if(raf)cancelAnimationFrame(raf);
 raf=0;lastTime=0;
 if(spinning&&!reduced&&visible&&!document.hidden)raf=requestAnimationFrame(animate);
}
function updateAuto(){btnAuto.setAttribute('aria-pressed',String(spinning));btnAuto.textContent=spinning?'⟳ Đang tự xoay':'▶ Bật tự xoay'}
function stopAuto(){spinning=false;updateAuto();startAnimation()}
$('#ucx3dFront').addEventListener('click',()=>{stopAuto();setAngles(-15,-9)});
$('#ucx3dBack').addEventListener('click',()=>{stopAuto();setAngles(165,-8)});
$('#ucx3dReset').addEventListener('click',()=>{
 slide=false;stage.classList.remove('is-slid');
 $('#ucx3dSlide').setAttribute('aria-pressed','false');
 $('#ucx3dSlide').textContent='Thử trượt màn hình ↔';
 setAngles(-20,-9);
 spinning=!reduced;updateAuto();startAnimation();
});
btnAuto.addEventListener('click',()=>{
 spinning=!spinning&&!reduced;updateAuto();startAnimation();
});
$('#ucx3dSlide').addEventListener('click',()=>{
 slide=!slide;stage.classList.toggle('is-slid',slide);
 const button=$('#ucx3dSlide');button.setAttribute('aria-pressed',String(slide));
 button.textContent=slide?'Đưa màn hình về giữa ←':'Thử trượt màn hình ↔';
 stopAuto();if(Math.abs(wrap(ry))>70)setAngles(-18,-9);
});
angle.addEventListener('input',()=>{stopAuto();setAngles(Number(angle.value))});
for(const button of root.querySelectorAll('[data-ucx3d-mode]')){
 button.addEventListener('click',()=>{
  const mode=button.dataset.ucx3dMode;
  for(const b of root.querySelectorAll('[data-ucx3d-mode]')){const current=b.dataset.ucx3dMode===mode;b.classList.toggle('is-active',current);b.setAttribute('aria-pressed',String(current))}
  for(const app of root.querySelectorAll('[data-ucx3d-app]'))app.hidden=app.dataset.ucx3dApp!==mode;
  stopAuto();setAngles(-16,-9);
 });
}
let startX=0,startY=0,startRx=rx,startRy=ry;
model.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse'&&e.button!==0)return;
 dragging=true;startX=e.clientX;startY=e.clientY;startRx=rx;startRy=ry;
 model.classList.add('is-dragging');
 try{model.setPointerCapture(e.pointerId)}catch{}
 stopAuto();
});
model.addEventListener('pointermove',e=>{
 if(!dragging)return;
 const dx=e.clientX-startX,dy=e.clientY-startY;
 setAngles(startRy+dx*.7,startRx-dy*.32);
});
function endDrag(){dragging=false;model.classList.remove('is-dragging')}
model.addEventListener('pointerup',endDrag);
model.addEventListener('pointercancel',endDrag);
model.addEventListener('lostpointercapture',endDrag);
model.addEventListener('keydown',e=>{
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
 e.preventDefault();stopAuto();
 const dx=e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0;
 const dy=e.key==='ArrowUp'?8:e.key==='ArrowDown'?-8:0;
 setAngles(ry+dx,rx+dy);
});
const descriptions=[
 'Kết nối bộ nguồn 12V phù hợp với bộ gá tương thích.',
 'Căn màn hình đúng chốt định vị, đưa sát bộ gá theo hướng dẫn từng xe.',
 'Các tiếp điểm Pogo PIN chỉ truyền điện khi màn hình và bộ gá tương thích, lắp khớp.',
 'Minh họa trạng thái màn hình sau khi nhận nguồn; thời gian bật thực tế tùy cấu hình.'
];
function setStep(next){
 step=clamp(next,0,3);$('#ucx3dAssembly').dataset.step=String(step);
 $('#ucx3dStepText').textContent=descriptions[step];
 for(const b of root.querySelectorAll('[data-ucx3d-step]')){const on=Number(b.dataset.ucx3dStep)===step;b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',String(on))}
}
function stopSteps(){if(stepTimer)clearInterval(stepTimer);stepTimer=0}
function startSteps(){
 stopSteps();
 if(reduced||manualStep||!assemblyVisible||document.hidden)return;
 stepTimer=window.setInterval(()=>setStep((step+1)%4),3000);
}
for(const b of root.querySelectorAll('[data-ucx3d-step]'))b.addEventListener('click',()=>{
 manualStep=true;stopSteps();setStep(Number(b.dataset.ucx3dStep));
});
if('IntersectionObserver'in window){
 const show=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;startAnimation()},{threshold:.13});show.observe(stage);
 const assembly=new IntersectionObserver(entries=>{assemblyVisible=entries[0]?.isIntersecting??false;if(assemblyVisible)startSteps();else stopSteps()},{threshold:.15});assembly.observe($('#ucx3dAssembly'));
}else{visible=true;assemblyVisible=true;startAnimation();startSteps()}
document.addEventListener('visibilitychange',()=>{startAnimation();if(document.hidden)stopSteps();else startSteps()});
render();updateAuto();setStep(0);
})();
