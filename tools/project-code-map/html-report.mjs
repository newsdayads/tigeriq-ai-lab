// A portable single-file viewer. No CDN, network calls, or JavaScript evaluation of repo data.
// JSON data is an inert script tag escaped against HTML parser termination.
const TEMPLATE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TigerIQ Code Map — sơ đồ mã nguồn</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light;background:#f5f7fa;color:#1b2a3c}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1100px;margin:auto;padding:24px}
h1{font-size:1.45rem;margin:0 0 4px}p{color:#526175;margin:6px 0 16px;line-height:1.45}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:20px 0}
.stat,.panel{background:white;border:1px solid #e1e6ed;border-radius:12px;padding:16px}
.stat strong{display:block;font-size:1.5rem}.stat small{color:#526175}
.grid{display:grid;grid-template-columns:minmax(240px,1fr) minmax(320px,2fr);gap:16px}
label{display:block;font-weight:600;margin:0 0 8px}input[type=search]{width:100%;padding:12px;border:1px solid #adbac9;border-radius:8px;font:inherit}
.check{display:flex;gap:6px;align-items:center;margin:12px 0;font-size:.9rem;font-weight:400}
#module-list{list-style:none;padding:0;margin:10px 0 0;max-height:65vh;overflow:auto}
#module-list li{margin:4px 0}
#module-list button,.dep button{font:inherit;text-align:left;overflow-wrap:anywhere;background:transparent;border:0;color:#1954a4;padding:7px 5px;cursor:pointer}
#module-list button{display:block;width:100%;border-radius:6px}
#module-list button:hover,#module-list button[aria-current=true]{background:#ecf3ff}
h2{font-size:1.15rem;margin:4px 0 12px;overflow-wrap:anywhere}h3{font-size:.95rem;margin:18px 0 8px}
.dep{border-top:1px solid #e5e8ee;padding:7px 0;overflow-wrap:anywhere}
.dep span{color:#67788b;margin-left:8px;font-size:.82rem}
small,.muted{color:#617186;overflow-wrap:anywhere}
#count{margin-top:10px}footer{margin:20px 0;color:#67788b;font-size:.85rem}
@media(max-width:720px){.wrap{padding:12px}.grid{grid-template-columns:1fr}.stats{gap:5px}.stat{padding:10px}.stat strong{font-size:1.2rem}#module-list{max-height:220px}}
</style></head><body>
<main class="wrap"><h1>TigerIQ — Sơ đồ mã nguồn</h1><p>Tìm kiếm tệp, chọn để xem module được dùng và module phụ thuộc. Báo cáo mở offline; không gửi dữ liệu ra mạng.</p>
<div class="stats"><div class="stat"><strong id="file-stat"></strong><small>Tệp nguồn</small></div><div class="stat"><strong id="edge-stat"></strong><small>Quan hệ import</small></div><div class="stat"><strong id="used-stat"></strong><small>Tệp có import</small></div></div>
<div class="grid"><section class="panel"><label for="search">Tìm module</label><input type="search" id="search" placeholder="Ví dụ: project-code-map" autocomplete="off">
<label class="check"><input type="checkbox" id="only-importers"> Chỉ tệp có import</label>
<div id="count" class="muted" aria-live="polite"></div><ul id="module-list"></ul></section>
<section class="panel"><h2 id="focus-title">Chọn tệp để xem phụ thuộc</h2><div id="details" aria-live="polite"></div></section></div>
<footer id="revision"></footer></main>
<script type="application/json" id="code-map-data">__TIGERIQ_REPORT_PAYLOAD__</script>
<script>
(() => {
  "use strict";
  const report = JSON.parse(document.getElementById("code-map-data").textContent);
  const byId = id => document.getElementById(id);
  const nodes = report.nodes;
  const nodeSet = new Set(nodes);
  const outgoing = new Map(nodes.map(n => [n, []]));
  const incoming = new Map(nodes.map(n => [n, []]));
  const importers = new Set();
  for (const e of report.edges) {
    importers.add(e.from);
    if (outgoing.has(e.from)) outgoing.get(e.from).push(e.to);
  }
  function resolveModule(from, specifier) {
    if (!specifier.startsWith(".")) return null;
    const parts = from.split("/");
    parts.pop();
    for (const item of specifier.split("/")) {
      if (item === "..") { if (parts.length === 0) return null; parts.pop(); }
      else if (item && item !== ".") parts.push(item);
    }
    const base = parts.join("/");
    for (const suffix of ["", ".js", ".mjs", ".cjs", ".ts", "/index.js", "/index.ts"]) {
      if (nodeSet.has(base + suffix)) return base + suffix;
    }
    return null;
  }
  for (const e of report.edges) {
    const target = resolveModule(e.from, e.to);
    if (target && incoming.has(target)) incoming.get(target).push(e.from);
  }
  function text(tag, value, cls) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (cls) el.className = cls;
    return el;
  }
  byId("file-stat").textContent = report.summary.sourceFiles.toLocaleString("vi-VN");
  byId("edge-stat").textContent = report.summary.dependencyEdges.toLocaleString("vi-VN");
  byId("used-stat").textContent = report.summary.filesWithImports.toLocaleString("vi-VN");
  byId("revision").textContent = "Nguồn: " + (report.sourceRevision || "không ghi SHA") + " · Chỉ hiển thị tên và cạnh phụ thuộc, không chứa nội dung mã.";
  let selected = null;
  function renderDependencies(heading, values, from) {
    const area = byId("details");
    area.append(text("h3", heading + " (" + values.length + ")"));
    if (!values.length) { area.append(text("p", "Không có trong dữ liệu quét.", "muted")); return; }
    for (const item of values.slice(0, 250)) {
      const row = text("div", "", "dep");
      const target = from ? resolveModule(selected, item) : item;
      if (target && nodeSet.has(target)) {
        const button = text("button", item);
        button.type = "button";
        button.addEventListener("click", () => choose(target));
        row.append(button);
        row.append(text("span", from ? "tệp nội bộ" : "đang dùng tệp này"));
      } else {
        row.append(text("span", item));
        row.append(text("span", "module ngoài hoặc chưa phân giải"));
      }
      area.append(row);
    }
    if (values.length > 250) area.append(text("p", "Chỉ hiển thị 250 mục đầu.", "muted"));
  }
  function choose(value) {
    selected = value;
    byId("focus-title").textContent = value;
    byId("details").replaceChildren();
    renderDependencies("Import từ tệp", outgoing.get(value) || [], true);
    renderDependencies("Tệp đang phụ thuộc vào tệp này", [...new Set(incoming.get(value) || [])], false);
    renderList();
  }
  function renderList() {
    const needle = byId("search").value.trim().toLowerCase();
    const only = byId("only-importers").checked;
    const filtered = nodes.filter(n => (!only || importers.has(n)) && n.toLowerCase().includes(needle));
    byId("count").textContent = filtered.length + " / " + nodes.length + " tệp · hiển thị tối đa 150";
    const list = byId("module-list");
    list.replaceChildren();
    for (const n of filtered.slice(0, 150)) {
      const li = document.createElement("li");
      const button = text("button", n);
      button.type = "button";
      if (n === selected) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => choose(n));
      li.append(button);
      list.append(li);
    }
  }
  byId("search").addEventListener("input", renderList);
  byId("only-importers").addEventListener("change", renderList);
  renderList();
})();
</script></body></html>
`;
export function buildHtmlReport(report) {
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.nodes) ||
      !Array.isArray(report.edges) || !report.summary) {
    throw new Error("CODE_MAP_INVALID_REPORT");
  }
  const safeData = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return TEMPLATE.replace("__TIGERIQ_REPORT_PAYLOAD__", safeData);
}
