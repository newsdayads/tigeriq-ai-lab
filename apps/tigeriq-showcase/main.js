"use strict";
(() => {
  const find = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const menu = find("#menu-toggle"), nav = find("#site-nav");
  function closeMenu() { nav?.classList.remove("open"); menu?.setAttribute("aria-expanded","false"); }
  menu?.addEventListener("click", () => { const open=menu.getAttribute("aria-expanded")!=="true";nav.classList.toggle("open",open);menu.setAttribute("aria-expanded",String(open)); });
  nav?.querySelectorAll("a").forEach(a=>a.addEventListener("click",closeMenu));
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
  const labels={website:"Thiết kế Website",software:"Phần mềm",ultracar:"UltraCarHCM",driver:"Driver",printing:"In 3D",marketing:"Marketing",phonefarm:"PhoneFarm"};
  let chosen="website";
  function showService(id,scroll=true) {
    if(!labels[id])return;
    chosen=id;
    all(".service-detail-item").forEach(el=>el.hidden=el.dataset.detail!==id);
    all(".service-open").forEach(el=>{let on=el.dataset.service===id;el.setAttribute("aria-pressed",String(on));el.closest(".service-card")?.classList.toggle("service-selected",on)});
    if(scroll)find("#explore")?.scrollIntoView({behavior:document.body.classList.contains("motion-off")?"auto":"smooth",block:"start"});
  }
  all(".service-open,.project-explore").forEach(el=>el.addEventListener("click",()=>showService(el.dataset.service)));
  all(".filter-chip").forEach(button=>button.addEventListener("click",()=>{
    const filter=button.dataset.filter;let first=null,containsChosen=false;
    all(".filter-chip").forEach(el=>{const on=el===button;el.classList.toggle("active",on);el.setAttribute("aria-pressed",String(on))});
    all(".service-card").forEach(card=>{const visible=filter==="all"||card.dataset.group===filter;card.hidden=!visible;if(visible){const id=card.querySelector(".service-open")?.dataset.service;first ||= id;if(id===chosen)containsChosen=true;}});
    if(!containsChosen&&first)showService(first,false);
  }));
  showService("website",false);
  const form=find("#brief-form"),service=find("#brief-service"),goal=find("#brief-goal"),notes=find("#brief-description"),output=find("#brief-output"),feedback=find("#brief-feedback");
  const build=()=> "Xin chào TigerIQ! Tôi muốn tìm hiểu dịch vụ "+(labels[service?.value]||labels.website)+".\nMục tiêu: "+(goal?.value||"Cần tư vấn")+".\n"+(notes?.value?.trim()?"Yêu cầu: "+notes.value.trim()+"\n":"")+"Nhờ TigerIQ tư vấn phương án phù hợp. Cảm ơn!";
  const preview=()=>{if(output)output.textContent=build()};
  form?.addEventListener("submit",e=>{e.preventDefault();preview();if(feedback)feedback.textContent="Nội dung đã sẵn sàng. Sao chép rồi dán vào Zalo."});
  [service,goal,notes].forEach(el=>el?.addEventListener(el===notes?"input":"change",preview));
  all("[data-brief-service]").forEach(link=>link.addEventListener("click",()=>{service.value=link.dataset.briefService;preview()}));
  find("#copy-brief")?.addEventListener("click",async()=>{
    preview();
    try{await navigator.clipboard.writeText(output.textContent);feedback.textContent="Đã sao chép. Mở Zalo và dán để gửi."}
    catch(_e){feedback.textContent="Vui lòng chọn và sao chép nội dung từ bản nháp.";output.focus();const range=document.createRange();range.selectNodeContents(output);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
  });
  preview();
})();