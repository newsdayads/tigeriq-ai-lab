"use strict";
(function () {
  const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer:fine)").matches;
  const serviceData = [
    {name:"Thiết kế Website",symbol:"WWW",tag:"DESIGN / DIGITAL",description:"Website có nhận diện độc bản, hiệu ứng tinh tế, bố cục dễ sử dụng và mục tiêu chuyển đổi rõ ràng."},
    {name:"Phần mềm",symbol:"</>",tag:"SOFTWARE / SYSTEMS",description:"Ứng dụng, công cụ tự động hóa và hệ thống quản lý được thiết kế theo quy trình thực tế."},
    {name:"UltraCar",symbol:"CAR",tag:"MOBILITY / TECHNOLOGY",description:"Hệ sinh thái giải pháp dành cho ô tô, đang phát triển và kiểm thử theo từng tính năng và thiết bị."},
    {name:"Driver",symbol:"DRIVE",tag:"DRIVER / OPERATIONS",description:"Ý tưởng và công cụ hỗ trợ tài xế, công việc di chuyển và quy trình vận hành dịch vụ."},
    {name:"In 3D",symbol:"3D",tag:"MAKE / PROTOTYPE",description:"Thiết kế, tạo mẫu và hiện thực hóa sản phẩm vật lý bằng quy trình in 3D theo yêu cầu."},
    {name:"Marketing",symbol:"GROW",tag:"BRAND / CONTENT",description:"Xây dựng nhận diện, nội dung và trải nghiệm truyền thông gắn với mục tiêu kinh doanh."},
    {name:"PhoneFarm",symbol:"PF",tag:"DEVICE / TEST LAB",description:"Hạ tầng thiết bị, kiểm thử và tự động hóa công việc trên thiết bị trong phạm vi tuân thủ nền tảng."}
  ];
  const choices = Array.from(document.querySelectorAll(".service-option"));
  const title = document.getElementById("service-name");
  const description = document.getElementById("service-description");
  const symbol = document.getElementById("service-symbol");
  const category = document.getElementById("service-category");
  const count = document.getElementById("service-number");
  const showcase = document.getElementById("showcase-object");
  let selected = 0;
  function setService(index) {
    if (!Number.isInteger(index) || index < 0 || index >= serviceData.length || !title) return;
    selected = index;
    const data = serviceData[index];
    choices.forEach(function (b, i) {
      b.classList.toggle("selected", i === index);
      b.setAttribute("aria-pressed", String(i === index));
    });
    title.textContent = data.name;
    description.textContent = data.description;
    symbol.textContent = data.symbol;
    category.textContent = data.tag;
    count.textContent = String(index + 1).padStart(2, "0") + " / 07";
    if (showcase) {
      showcase.style.borderRadius = ["38% 44% 37% 44%","18% 42% 16% 47%","46% 26% 46% 24%","32% 32% 32% 32%","10% 48% 13% 48%","50% 10% 50% 10%","8% 8% 42% 42%"][index];
      showcase.style.transform = "rotate(" + (index * 12 - 22) + "deg)";
    }
  }
  choices.forEach(function (button) {
    const i = Number(button.dataset.service);
    button.addEventListener("click", function () { setService(i); });
    if (finePointer) button.addEventListener("mouseenter", function () { setService(i); });
    button.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        choices[(i + 1) % choices.length].focus();
        setService((i + 1) % choices.length);
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        choices[(i + choices.length - 1) % choices.length].focus();
        setService((i + choices.length - 1) % choices.length);
      }
    });
  });
  const toggle = document.getElementById("menu-toggle");
  const nav = document.getElementById("main-nav");
  function closeMenu() {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Mở menu");
    nav.classList.remove("open");
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
      nav.classList.toggle("open", open);
    });
    nav.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeMenu(); });
  }
  const reveals = document.querySelectorAll(".reveal");
  if (!motionOK || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("in"); });
  } else {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.11, rootMargin: "0px 0px -10px 0px" });
    reveals.forEach(function (el) { observer.observe(el); });
  }
  if (motionOK && finePointer) {
    const art = document.querySelector(".hero-art");
    const light = document.getElementById("pointer-light");
    window.addEventListener("pointermove", function (event) {
      if (light) light.style.transform = "translate3d(" + (event.clientX - 220) + "px," + (event.clientY - 220) + "px,0)";
      if (art && window.innerWidth > 1100) {
        const x = (event.clientX / window.innerWidth - 0.5) * 13;
        const y = (event.clientY / window.innerHeight - 0.5) * -11;
        art.style.transform = "rotateY(" + x.toFixed(2) + "deg) rotateX(" + y.toFixed(2) + "deg)";
      }
    }, { passive: true });
  }
  function formatTime(iso) {
    const time = new Date(iso);
    if (Number.isNaN(time.valueOf())) return null;
    return time.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  const feed = document.getElementById("feed-status");
  // Public-only metadata. Never expose issues, commit messages, test APK URLs, private repos or credentials.
  async function getGitHub(url) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 7000);
    try {
      const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("GitHub HTTP " + response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function refreshPublicFeed() {
    if (!feed) return;
    const base = "https://api.github.com";
    let hasVerified = false;
    try {
      const source = await getGitHub(base + "/repos/newsdayads/tigeriq-media-content");
      if (source && source.private === false && source.archived === false && source.owner && source.owner.login === "newsdayads") {
        const date = formatTime(source.pushed_at);
        feed.textContent = date
          ? "TigerIQ News: kho mã nguồn công khai cập nhật " + date + " (không phải xác nhận bản phát hành)."
          : "TigerIQ News: đã đối chiếu được kho nguồn công khai.";
        hasVerified = true;
      }
    } catch (_error) {
      feed.textContent = "Chưa thể đồng bộ GitHub. Thông tin dự án hiển thị theo danh mục đã đối chiếu trước đó.";
    }
    try {
      // A repo appears automatically only after the Owner sets the explicit public-showcase topic.
      const search = await getGitHub(base + "/search/repositories?q=user%3Anewsdayads%20topic%3Atigeriq-public-showcase&per_page=10");
      const approved = Array.isArray(search.items) ? search.items.filter(function (repo) {
        return repo && repo.private === false && repo.archived === false &&
          repo.owner && repo.owner.login === "newsdayads" &&
          Array.isArray(repo.topics) && repo.topics.includes("tigeriq-public-showcase") &&
          /^https:\/\/github\.com\/newsdayads\/[A-Za-z0-9_.-]+$/.test(repo.html_url || "");
      }) : [];
      if (approved.length) {
        const list = document.createElement("ul");
        list.className = "approved-project-list";
        approved.slice(0, 5).forEach(function (repo) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = repo.html_url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = repo.name + " ↗";
          li.appendChild(a);
          list.appendChild(li);
        });
        feed.appendChild(document.createTextNode(" Dự án công khai được duyệt:"));
        feed.appendChild(list);
        hasVerified = true;
      }
    } catch (_error) {
      // Never invent extra projects on rate-limit, network or permission failures.
      if (!hasVerified) feed.textContent += " Mục dự án mới chưa được kiểm chứng.";
    }
  }
  refreshPublicFeed();
})();
