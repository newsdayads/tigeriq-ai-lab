/* UltraCarHCM: independent self-hosted 3D GLB viewer.
 * Runtime dependencies are bundled locally: Three.js 0.180.0 (MIT), GLTFLoader, OrbitControls.
 * The model is loaded ONLY from /assets/models/ultracar-13-3.glb on this website.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(()=>{
  'use strict';
  const root=document.querySelector('#ultracar-3d-goc');
  if(!root)return;
  const $=(s)=>root.querySelector(s);
  const view=$('#ucSelf3dView'),canvas=$('#ucSelf3dCanvas'),status=$('#ucSelf3dStatus');
  const btnAuto=$('#ucSelf3dAuto'),btnFront=$('#ucSelf3dFront'),btnBack=$('#ucSelf3dBack');
  const btnReset=$('#ucSelf3dReset'),btnFull=$('#ucSelf3dFullscreen');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const modelUrl='/assets/models/ultracar-13-3.glb';
  let renderer=null,scene=null,camera=null,controls=null,model=null,boxSize=null;
  let loading=false,ready=false,visible=false,raf=0,last=0,fitDistance=10,intersect=null,resizeObserver=null;
  let disposed=false,auto=!reduced;

  function report(message){status.textContent=message;}
  function setMode(mode){
    root.dataset.modelStatus=mode;
    if(mode==='loading')report('Đang tải mô hình GLB trên UltraCarHCM…');
    if(mode==='ready')report('Mô hình 3D đã sẵn sàng · chạm và kéo để xoay');
    if(mode==='error')report('Không thể tải mô hình 3D. Vui lòng kiểm tra trình duyệt hoặc mạng.');
  }
  function updateAuto(){
    btnAuto.setAttribute('aria-pressed',String(auto));
    btnAuto.textContent=auto?'Tự xoay: BẬT':'Tự xoay: TẮT';
  }
  function pauseAuto(){auto=false;if(controls)controls.autoRotate=false;updateAuto();}
  function applyAuto(){if(controls)controls.autoRotate=auto;updateAuto();}
  function ensureRenderer(){
    if(renderer)return;
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.35;
    renderer.setClearColor(0x0a152a,0);
    scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe6f3ff,0x314768,2.15));
    const key=new THREE.DirectionalLight(0xffffff,3.4);key.position.set(4,7,11);scene.add(key);
    const fill=new THREE.DirectionalLight(0x6cafff,2);fill.position.set(-9,-3,3);scene.add(fill);
    const rim=new THREE.DirectionalLight(0x98dbff,2.2);rim.position.set(0,4,-8);scene.add(rim);
    camera=new THREE.PerspectiveCamera(38,1,.04,500);
    camera.position.set(0,1,12);
    controls=new OrbitControls(camera,canvas);
    controls.enableDamping=true;controls.dampingFactor=.065;
    controls.enablePan=false;controls.enableZoom=true;
    controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI-.12;
    controls.rotateSpeed=.75;controls.zoomSpeed=.82;
    controls.autoRotateSpeed=1.05;
    controls.autoRotate=auto;
    controls.addEventListener('start',pauseAuto);
    window.addEventListener('resize',scheduleResize,{passive:true});
    if('ResizeObserver'in window){resizeObserver=new ResizeObserver(scheduleResize);resizeObserver.observe(view);}
  }
  function fit(){
    if(!renderer||!camera||!boxSize)return;
    const rect=view.getBoundingClientRect();
    const width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    const vertical=Math.max(boxSize.y,boxSize.x/camera.aspect);
    const distance=(vertical*.60)/Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const next=Math.max(distance,boxSize.z*3);
    const ratio=fitDistance>0?next/fitDistance:1;
    camera.position.multiplyScalar(ratio);
    fitDistance=next;
    controls.minDistance=next*.62;controls.maxDistance=next*2.8;
    camera.near=Math.max(.015,next/150);
    camera.far=Math.max(100,next*15);
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene,camera);
  }
  let resizePending=false;
  function scheduleResize(){
    if(!ready||resizePending)return;
    resizePending=true;requestAnimationFrame(()=>{resizePending=false;if(ready)fit();});
  }
  async function load(){
    if(loading||ready||disposed)return;
    loading=true;setMode('loading');
    try{
      ensureRenderer();
      const gltf=await new GLTFLoader().loadAsync(modelUrl);
      if(disposed)return;
      model=gltf.scene;
      const b=new THREE.Box3().setFromObject(model);
      if(b.isEmpty())throw Error('Empty GLB model');
      boxSize=b.getSize(new THREE.Vector3());
      const center=b.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.traverse(node=>{
        if(node.isMesh){
          node.frustumCulled=true;
          if(node.material){
            const mats=Array.isArray(node.material)?node.material:[node.material];
            for(const m of mats){if(m.map)m.map.colorSpace=THREE.SRGBColorSpace;}
          }
        }
      });
      scene.add(model);
      fitDistance=0;
      const r=view.getBoundingClientRect();
      const vertical=Math.max(boxSize.y,boxSize.x/(Math.max(1,r.width)/Math.max(1,r.height)));
      const dist=(vertical*.6)/Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
      fitDistance=Math.max(dist,boxSize.z*3);
      camera.position.set(fitDistance*.18,fitDistance*.10,fitDistance);
      fit(); // Uses the current size and corrects the camera zoom.
      ready=true;loading=false;
      setMode('ready');
      root.dataset.meshes=String(model.getObjectByProperty('isMesh',true)?1:0);
      root.dataset.asset=modelUrl;
      applyAuto();
      wake();
    }catch(error){
      loading=false;ready=false;setMode('error');
      console.error('[UltraCarHCM] Local GLB load failed',error);
    }
  }
  function draw(now){
    raf=0;
    if(!ready||!visible||document.hidden||disposed)return;
    const dt=last?Math.min(70,now-last)/1000:1/60;
    last=now;
    if(controls){controls.autoRotate=auto;controls.update(dt);}
    renderer.render(scene,camera);
    raf=requestAnimationFrame(draw);
  }
  function wake(){
    if(raf)cancelAnimationFrame(raf);
    raf=0;last=0;
    if(visible&&ready&&!document.hidden&&!disposed)raf=requestAnimationFrame(draw);
  }
  function face(back){
    if(!ready)return;
    pauseAuto();
    const d=Math.max(controls.minDistance*1.45,camera.position.distanceTo(controls.target));
    camera.position.set(back?0.01:d*.12,d*.06,back?-d:d);
    controls.update();renderer.render(scene,camera);wake();
  }
  btnFront.addEventListener('click',()=>face(false));
  btnBack.addEventListener('click',()=>face(true));
  btnReset.addEventListener('click',()=>{
    if(!ready)return;
    const d=fitDistance;
    camera.position.set(d*.18,d*.1,d);
    controls.target.set(0,0,0);
    auto=!reduced;applyAuto();controls.update();wake();
  });
  btnAuto.addEventListener('click',()=>{auto=!auto;applyAuto();wake();});
  btnFull.addEventListener('click',async()=>{
    if(!view.requestFullscreen){report('Safari có thể không hỗ trợ toàn màn hình trong trang; hãy xoay ngang iPhone để xem lớn hơn.');return;}
    try{if(document.fullscreenElement)await document.exitFullscreen();else await view.requestFullscreen();scheduleResize();}
    catch{report('Trình duyệt không cho phép toàn màn hình; hãy xoay ngang điện thoại.');}
  });
  document.addEventListener('fullscreenchange',scheduleResize);
  document.addEventListener('visibilitychange',wake);
  if('IntersectionObserver'in window){
    intersect=new IntersectionObserver(entries=>{
      visible=!!entries[0]?.isIntersecting;
      if(visible&&!loading&&!ready)load();
      wake();
    },{threshold:.03,rootMargin:'240px 0px 240px 0px'});
    intersect.observe(root);
  }else{visible=true;load();}
  root.dataset.modelStatus='idle';
  updateAuto();
})();
