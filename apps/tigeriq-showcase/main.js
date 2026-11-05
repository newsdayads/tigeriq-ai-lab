"use strict";
(() => {
  const menu = document.getElementById("menu-toggle");
  const nav = document.getElementById("site-nav");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const closeMenu = () => {
    if (!menu || !nav) return;
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Mở menu");
  };
  if (menu && nav) {
    menu.addEventListener("click", () => {
      const open = menu.getAttribute("aria-expanded") !== "true";
      nav.classList.toggle("open", open);
      menu.setAttribute("aria-expanded", String(open));
      menu.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
    document.addEventListener("click", (event) => {
      if (nav.classList.contains("open") && !nav.contains(event.target) && !menu.contains(event.target)) closeMenu();
    });
  }

  const sections = document.querySelectorAll(".reveal");
  if (!reduceMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.07, rootMargin: "0px 0px -5px 0px" });
    sections.forEach((section) => observer.observe(section));
  } else {
    sections.forEach((section) => section.classList.add("visible"));
  }

  // Metadata is obtained solely from public repositories under the approved account.
  // Source activity is NOT proof that an app or service is in production.
  const status = document.getElementById("feed-status");
  const sourceURL = "https://api.github.com/repos/newsdayads/tigeriq-media-content";
  const curatedTopic = "tigeriq-public-showcase";
  const trustedOwner = "newsdayads";
  async function publicGitHubFetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
        cache: "no-store"
      });
      if (!response.ok) throw new Error("PUBLIC_SOURCE_UNAVAILABLE");
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  function formatDate(raw) {
    if (!raw) return null;
    const date = new Date(raw);
    if (!Number.isFinite(date.valueOf())) return null;
    return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  async function refreshPublicStatus() {
    if (!status) return;
    let verified = false;
    try {
      const repo = await publicGitHubFetch(sourceURL);
      if (repo && repo.private === false && repo.archived === false && repo.owner && repo.owner.login === trustedOwner) {
        verified = true;
        const date = formatDate(repo.pushed_at);
        status.textContent = date
          ? "Kho nguồn công khai TigerIQ News có cập nhật ngày " + date + ". Đây không phải xác nhận bản phát hành sản phẩm."
          : "Kho nguồn TigerIQ News đã được xác minh là công khai.";
      }
    } catch (_err) {
      status.textContent = "Chưa kết nối được nguồn GitHub. Nội dung hiển thị theo danh mục đã được rà soát.";
    }
    try {
      const results = await publicGitHubFetch("https://api.github.com/search/repositories?q=user%3Anewsdayads%20topic%3Atigeriq-public-showcase&per_page=10");
      const list = Array.isArray(results.items) ? results.items.filter((repo) => {
        return repo && repo.private === false && repo.archived === false &&
          repo.owner && repo.owner.login === trustedOwner &&
          Array.isArray(repo.topics) && repo.topics.includes(curatedTopic) &&
          /^https:\/\/github\.com\/newsdayads\/[a-zA-Z0-9_.-]+$/.test(repo.html_url || "");
      }).slice(0, 4) : [];
      if (list.length > 0) {
        const intro = document.createElement("span");
        intro.textContent = " Các kho công khai được duyệt:";
        status.appendChild(intro);
        const ul = document.createElement("ul");
        ul.className = "approved-project-list";
        list.forEach((repo) => {
          const li = document.createElement("li");
          const link = document.createElement("a");
          link.href = repo.html_url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = repo.name + " ↗";
          li.appendChild(link);
          ul.appendChild(li);
        });
        status.appendChild(ul);
      }
    } catch (_err) {
      if (!verified) status.appendChild(document.createTextNode(" Dữ liệu dự án mới chưa thể xác minh."));
    }
  }
  refreshPublicStatus();
})();
