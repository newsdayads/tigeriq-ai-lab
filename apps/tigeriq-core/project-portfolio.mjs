const PROJECTS = Object.freeze([
  { id: 'tigeriq-ai-lab', name: 'TigerIQ AI Lab', order: 10 },
  { id: 'tigeriq-mobile-worker', name: 'TigerIQ Mobile Worker', order: 20 },
  { id: 'tigeriq-news', name: 'TigerIQ News', order: 30 },
  { id: 'paperclip-vnext', name: 'Paperclip vNext', order: 40 },
  { id: 'revenue-lab', name: 'Revenue Lab', order: 50 },
]);

const PROJECT_BY_ID = new Map(PROJECTS.map((project) => [project.id, project]));

function bodyValue(body = '', key = '') {
  const escaped = String(key).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  return String(body || '').match(new RegExp('^' + escaped + '=(.+)$', 'mi'))?.[1]?.trim() || '';
}

function slug(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function canonicalProject(id = '', name = '') {
  const known = PROJECT_BY_ID.get(String(id || '').trim().toLowerCase());
  if (known) return known;
  const cleanName = String(name || '').trim();
  const cleanId = slug(id || cleanName);
  if (cleanId && cleanName) return { id: cleanId, name: cleanName, order: 900 };
  return PROJECT_BY_ID.get('tigeriq-ai-lab');
}

function rowText(row = {}, issue = null) {
  return [row?.title, issue?.title, issue?.body].filter(Boolean).join('\n');
}

export function classifyProject(row = {}, issue = null) {
  const body = String(issue?.body || '');
  const explicitId = bodyValue(body, 'PROJECT_ID') || String(row?.projectId || '').trim();
  const explicitName = bodyValue(body, 'PROJECT_NAME') || String(row?.projectName || '').trim();
  if (explicitId || explicitName) return canonicalProject(explicitId, explicitName || explicitId);

  const text = rowText(row, issue);
  if (/\bTIGERIQ[ _-](?:NEWS|MEDIA)\b/i.test(text)) return PROJECT_BY_ID.get('tigeriq-news');
  if (/\bPAPERCLIP\b/i.test(text)) return PROJECT_BY_ID.get('paperclip-vnext');
  if (/\bREVENUE[ _-]LAB\b|\bAPIFY\b/i.test(text)) return PROJECT_BY_ID.get('revenue-lab');
  if (/\bANDROID\b|MOBILE[_ -]?WORKER|\bZ[ _-]?FLIP\b|\bTIQ[ _-]?WORKER\b/i.test(text)) return PROJECT_BY_ID.get('tigeriq-mobile-worker');
  return PROJECT_BY_ID.get('tigeriq-ai-lab');
}

export function androidMinorVersion(row = {}, issue = null) {
  const text = rowText(row, issue);
  const matches = [
    ...text.matchAll(/(?:version(?:Name)?\s*[=:]\s*)?0\.(\d{1,3})(?:\.\d+)?/gi),
    ...text.matchAll(/\bV0?(\d{1,3})\b/gi),
    ...text.matchAll(/ANDROID[_ -]?V0?(\d{1,3})/gi),
  ].map((match) => Number(match[1])).filter(Number.isFinite);
  return matches.length ? Math.max(...matches) : null;
}

function legacyWorkPackage(project, row = {}, issue = null) {
  const body = String(issue?.body || '');
  const explicitId = bodyValue(body, 'WORK_PACKAGE_ID') || String(row?.workPackageId || '').trim();
  const explicitName = bodyValue(body, 'WORK_PACKAGE_NAME') || String(row?.workPackageName || '').trim();
  if (explicitId || explicitName) {
    return {
      id: slug(explicitId || explicitName),
      name: explicitName || explicitId,
      order: 100,
      explicit: true,
    };
  }

  const text = rowText(row, issue);
  if (project.id === 'tigeriq-mobile-worker') {
    const minor = androidMinorVersion(row, issue);
    if (minor != null) return { id: 'mobile-v0-' + minor, name: 'Live Worker v0.' + minor, order: 1000 - minor, androidMinor: minor };
    return { id: 'mobile-current', name: 'Mobile Worker hiện hành', order: 500 };
  }

  if (project.id === 'tigeriq-news') {
    return { id: 'news-current', name: 'TigerIQ News hiện hành', order: 100 };
  }

  if (project.id === 'paperclip-vnext') {
    return { id: 'paperclip-shadow', name: 'Shadow evaluation', order: 100 };
  }

  if (project.id === 'revenue-lab') {
    return { id: 'revenue-apify-audit', name: 'Apify Website Audit', order: 100 };
  }

  if (/TIGERIQ[ _-]LIVE|\[(?:UI|LIVE)\]|WORK[ _-]?PACKAGE|COMMAND[ _-]?CENTER/i.test(text)) {
    return { id: 'live-ui', name: 'TigerIQ LIVE', order: 20 };
  }
  if (/AUTO[ _-]?RCA|SELF[ _-]?AUDIT|OBSERVABILITY|RCA/i.test(text)) {
    return { id: 'auto-rca-observability', name: 'Auto-RCA & Observability', order: 30 };
  }
  return { id: 'core-router-workforce', name: 'Core / Router & Workforce', order: 10 };
}

function statusBucket(status = '') {
  const value = String(status || '').toUpperCase();
  if (value === 'WORKING' || value === 'ĐANG XỬ LÝ' || value === 'ĐANG LÀM') return 'working';
  if (value === 'REVIEW' || value === 'VERIFY' || value === 'RÀ SOÁT' || value === 'XÁC MINH') return 'review';
  if (value === 'BLOCKED' || value === 'BỊ CHẶN' || value === 'LỖI') return 'blocked';
  if (value === 'DONE' || value === 'COMPLETED' || value === 'HOÀN TẤT' || value === 'HOÀN THÀNH') return 'done';
  return 'waiting';
}

export function annotatePortfolioRows(rows = [], issues = []) {
  const issueMap = new Map((Array.isArray(issues) ? issues : []).map((issue) => [Number(issue?.number), issue]));
  const staged = (Array.isArray(rows) ? rows : []).map((row) => {
    const issue = issueMap.get(Number(row?.number)) || null;
    const project = classifyProject(row, issue);
    const workPackage = legacyWorkPackage(project, row, issue);
    return {
      ...row,
      projectId: project.id,
      projectName: project.name,
      projectOrder: project.order,
      workPackageId: workPackage.id,
      workPackageName: workPackage.name,
      workPackageOrder: workPackage.order,
      androidVersionMinor: workPackage.androidMinor ?? androidMinorVersion(row, issue),
      portfolioHidden: false,
      portfolioHiddenReason: null,
    };
  });

  const mobileVersions = staged
    .filter((row) => row.projectId === 'tigeriq-mobile-worker' && Number.isFinite(Number(row.androidVersionMinor)))
    .map((row) => Number(row.androidVersionMinor));
  const currentMobileMinor = mobileVersions.length ? Math.max(...mobileVersions) : null;

  return staged.map((row) => {
    if (row.projectId !== 'tigeriq-mobile-worker' || currentMobileMinor == null) return row;
    const minor = Number(row.androidVersionMinor);
    if (!Number.isFinite(minor) || minor >= currentMobileMinor) return row;
    return {
      ...row,
      portfolioHidden: true,
      portfolioHiddenReason: 'LEGACY_ANDROID_VERSION',
    };
  });
}

export function buildProjectPortfolio(rows = []) {
  const visible = (Array.isArray(rows) ? rows : []).filter((row) => row?.workKind === 'WORK' && row?.portfolioHidden !== true);
  const hidden = (Array.isArray(rows) ? rows : []).filter((row) => row?.workKind === 'WORK' && row?.portfolioHidden === true);
  const map = new Map();

  for (const row of visible) {
    const id = String(row.projectId || 'tigeriq-ai-lab');
    const current = map.get(id) || {
      id,
      name: row.projectName || id,
      order: Number(row.projectOrder) || 900,
      workPackages: new Map(),
      counts: { working: 0, review: 0, blocked: 0, waiting: 0, done: 0 },
      hiddenTechnicalItems: 0,
    };
    const packageId = String(row.workPackageId || 'unclassified');
    if (!current.workPackages.has(packageId)) {
      current.workPackages.set(packageId, {
        id: packageId,
        name: row.workPackageName || packageId,
        order: Number(row.workPackageOrder) || 900,
        counts: { working: 0, review: 0, blocked: 0, waiting: 0, done: 0 },
        itemCount: 0,
      });
    }
    const pack = current.workPackages.get(packageId);
    const bucket = statusBucket(row.status);
    pack.counts[bucket] += 1;
    pack.itemCount += 1;
    current.counts[bucket] += 1;
    map.set(id, current);
  }

  for (const row of hidden) {
    const id = String(row.projectId || 'tigeriq-ai-lab');
    const project = map.get(id);
    if (project) project.hiddenTechnicalItems += 1;
  }

  return [...map.values()].map((project) => ({
    id: project.id,
    name: project.name,
    order: project.order,
    counts: project.counts,
    workPackageCount: project.workPackages.size,
    hiddenTechnicalItems: project.hiddenTechnicalItems,
    workPackages: [...project.workPackages.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
  })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export const CANONICAL_PROJECTS = PROJECTS;
