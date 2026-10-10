const PROJECTS = Object.freeze([
  // Legacy project IDs remain stable; groupId is presentation metadata, never a queue/lease authority.
  { id: 'tigeriq-platform', name: 'Nền tảng TigerIQ', order: 10, kind: 'platform', groupId: 'tigeriq-ai' },
  { id: 'tigeriq-mobile-worker', name: 'TigerIQ Mobile Worker', order: 20, kind: 'project', groupId: 'tigeriq-ai' },
  { id: 'tigeriq-live', name: 'TigerIQ Live', order: 30, kind: 'project', groupId: 'tigeriq-ai' },
  { id: 'tigeriq-workflow-lab', name: 'Workflow Lab', order: 40, kind: 'project', groupId: 'tigeriq-ai' },
  { id: 'tigeriq-app-chrome', name: 'App Chrome', order: 50, kind: 'project', groupId: 'tigeriq-ai' },
  { id: 'tigeriq-news', name: 'TigerIQ News', order: 60, kind: 'project', groupId: 'tigeriq-news' },
  { id: 'paperclip-vnext', name: 'Paperclip vNext', order: 70, kind: 'project', groupId: 'paperclip-vnext' },
  { id: 'revenue-lab', name: 'Revenue Lab', order: 80, kind: 'project', groupId: 'revenue-lab' },
  { id: 'tigeriq-driver', name: 'TigerIQ Driver', order: 90, kind: 'project', groupId: 'tigeriq-driver' },
  { id: 'dexcam-personal', name: 'DeXCam Personal', order: 100, kind: 'project', groupId: 'dexcam-personal' },
  { id: 'tigeriq-coin', name: 'TigerIQ Coin', order: 110, kind: 'project', groupId: 'tigeriq-coin' },
]);

const PROJECT_BY_ID = new Map(PROJECTS.map((project) => [project.id, project]));
const PROJECT_ALIASES = new Map([
  ['tigeriq-ai-lab', 'tigeriq-platform'],
  ['core', 'tigeriq-platform'],
  ['platform', 'tigeriq-platform'],
  ['tigeriq-media', 'tigeriq-news'],
  ['tigeriq-news-media', 'tigeriq-news'],
  ['workflow-lab', 'tigeriq-workflow-lab'],
  ['app-chrome', 'tigeriq-app-chrome'],
  ['appchrome', 'tigeriq-app-chrome'],
  ['chrome-controller', 'tigeriq-app-chrome'],
  ['driver', 'tigeriq-driver'],
  ['drivetrack', 'tigeriq-driver'],
  ['ultracarvn', 'dexcam-personal'],
  ['dexcam', 'dexcam-personal'],
  ['tigeriq_dexcam_personal', 'dexcam-personal'],
  ['tigeriq-dexcam-personal', 'dexcam-personal'],
  ['coin', 'tigeriq-coin'],
  ['derophone', 'tigeriq-coin'],
  ['derophone_bk', 'tigeriq-coin'],
  ['derobizfly', 'tigeriq-coin'],
  ['zephyr', 'tigeriq-coin'],
]);

// Owner-approved P0 portfolio, 2026-10-10. A parent group is not a runnable project.
export const CANONICAL_PORTFOLIO_GROUPS = Object.freeze([
  { id: 'tigeriq-ai', name: 'TigerIQ AI', order: 10, childIds: ['tigeriq-platform','tigeriq-mobile-worker','tigeriq-live','tigeriq-workflow-lab','tigeriq-app-chrome'] },
  { id: 'tigeriq-news', name: 'TigerIQ News / Media', order: 20, childIds: ['tigeriq-news'] },
  { id: 'paperclip-vnext', name: 'Paperclip vNext', order: 30, childIds: ['paperclip-vnext'] },
  { id: 'revenue-lab', name: 'Revenue Lab', order: 40, childIds: ['revenue-lab'] },
  { id: 'tigeriq-driver', name: 'TigerIQ Driver', order: 50, childIds: ['tigeriq-driver'] },
  { id: 'dexcam-personal', name: 'DeXCam Personal', order: 60, childIds: ['dexcam-personal'] },
  { id: 'tigeriq-coin', name: 'TigerIQ Coin', order: 70, childIds: ['tigeriq-coin'] },
]);
const PORTFOLIO_GROUP_BY_ID = new Map(CANONICAL_PORTFOLIO_GROUPS.map(group => [group.id,group]));

// Presentation-only grouping; empty projects still appear, never manufacture running work.
export function buildPortfolioGroups(portfolioProjects = []) {
  const actual = new Map((Array.isArray(portfolioProjects) ? portfolioProjects : []).map(p => [p.id,p]));
  return CANONICAL_PORTFOLIO_GROUPS.map(group => ({
    id: group.id,
    name: group.name,
    order: group.order,
    projects: group.childIds.map(id => {
      const definition = PROJECT_BY_ID.get(id);
      const snapshot = actual.get(id);
      return {
        id, name: definition.name, kind: definition.kind,
        presentInWorkSnapshot: Boolean(snapshot),
        counts: snapshot?.counts ?? { working: 0, review: 0, blocked: 0, waiting: 0, done: 0 },
        workstreams: snapshot?.workstreams ?? [],
        hiddenTechnicalItems: snapshot?.hiddenTechnicalItems ?? 0,
      };
    }),
  }));
}

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
  const rawId = String(id || '').trim().toLowerCase();
  const aliasId = PROJECT_ALIASES.get(rawId) || rawId;
  const known = PROJECT_BY_ID.get(aliasId);
  if (known) return known;
  const cleanName = String(name || '').trim();
  const cleanId = slug(id || cleanName);
  if (cleanId && cleanName) return { id: cleanId, name: cleanName, order: 900, kind: 'project' };
  return PROJECT_BY_ID.get('tigeriq-platform');
}

function rowText(row = {}, issue = null) {
  return [row?.title, issue?.title, issue?.body].filter(Boolean).join('\n');
}

export function classifyProject(row = {}, issue = null) {
  const body = String(issue?.body || '');
  const explicitId = bodyValue(body, 'PROJECT_ID') || String(row?.projectId || '').trim();
  const explicitName = bodyValue(body, 'PROJECT_NAME') || String(row?.projectName || '').trim();
  if (explicitId || explicitName) return canonicalProject(explicitId, explicitName || explicitId);

  // Fallback is restricted to issue title; prose mentioning another project does not reassign ownership.
  const title = String(issue?.title || row?.title || '');
  if (/\bDEX[_ -]?CAM\b|ULTRACARVN/i.test(title)) return PROJECT_BY_ID.get('dexcam-personal');
  if (/\bTIGERIQ[ _-]?DRIVER\b|\[DRIVER\]|\bDEX[ _-]?SHOT\b/i.test(title)) return PROJECT_BY_ID.get('tigeriq-driver');
  if (/\bWORKFLOW[ _-]?LAB\b/i.test(title)) return PROJECT_BY_ID.get('tigeriq-workflow-lab');
  if (/\bAPP[ _-]?CHROME\b/i.test(title)) return PROJECT_BY_ID.get('tigeriq-app-chrome');
  if (/\bTIGERIQ[ _-]?COIN\b|\bDEROPHONE\b|\bDEROBIZFLY\b|\bZEPHYR\b/i.test(title)) return PROJECT_BY_ID.get('tigeriq-coin');
  const text = rowText(row, issue);
  if (/\bTIGERIQ[ _-](?:NEWS|MEDIA)\b/i.test(text)) return PROJECT_BY_ID.get('tigeriq-news');
  if (/\bPAPERCLIP\b/i.test(text)) return PROJECT_BY_ID.get('paperclip-vnext');
  if (/\bREVENUE[ _-]LAB\b|\bAPIFY\b/i.test(text)) return PROJECT_BY_ID.get('revenue-lab');
  if (/\bANDROID\b|MOBILE[_ -]?WORKER|\bZ[ _-]?FLIP\b|\bTIQ[ _-]?WORKER\b/i.test(text)) return PROJECT_BY_ID.get('tigeriq-mobile-worker');
  if (/\bTIGERIQ[ _-]LIVE\b|\[(?:LIVE)\]|COMMAND[ _-]?CENTER/i.test(text)) return PROJECT_BY_ID.get('tigeriq-live');
  return PROJECT_BY_ID.get('tigeriq-platform');
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
  const explicitId = bodyValue(body, 'WORKSTREAM_ID') || bodyValue(body, 'WORK_PACKAGE_ID') || String(row?.workstreamId || row?.workPackageId || '').trim();
  const explicitName = bodyValue(body, 'WORKSTREAM_NAME') || bodyValue(body, 'WORK_PACKAGE_NAME') || String(row?.workstreamName || row?.workPackageName || '').trim();
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

  if (project.id === 'tigeriq-workflow-lab') return { id: 'product-ui', name: 'Giao diện & thực nghiệm', order: 100 };
  if (project.id === 'tigeriq-app-chrome') return { id: 'local-only', name: 'Vận hành cục bộ PC01', order: 100 };
  if (project.id === 'tigeriq-driver') return { id: 'driver-and-dexshot', name: 'Ứng dụng Driver & DeX Shot', order: 100 };
  if (project.id === 'dexcam-personal') return { id: 'personal-android', name: 'DeXCam / UltraCarVN', order: 100 };
  if (project.id === 'tigeriq-coin') return { id: 'source-inventory', name: 'Kiểm kê mã nguồn, không khai thác', order: 100 };

  if (project.id === 'tigeriq-news') {
    return { id: 'news-current', name: 'TigerIQ News hiện hành', order: 100 };
  }

  if (project.id === 'paperclip-vnext') {
    return { id: 'paperclip-shadow', name: 'Shadow evaluation', order: 100 };
  }

  if (project.id === 'revenue-lab') {
    return { id: 'revenue-apify-audit', name: 'Apify Website Audit', order: 100 };
  }

  if (project.id === 'tigeriq-live') {
    if (/RELEASE|DEPLOY|PRODUCTION|PUBLISH/i.test(text)) return { id: 'release', name: 'Phát hành', order: 30 };
    if (/API|HEALTH|STATUS/i.test(text)) return { id: 'health-api', name: 'Health & API', order: 20 };
    return { id: 'owner-ui', name: 'Giao diện Owner', order: 10 };
  }
  if (/AUTO[ _-]?RCA|SELF[ _-]?AUDIT|OBSERVABILITY|RCA/i.test(text)) {
    return { id: 'auto-rca-observability', name: 'Auto-RCA & Quan sát', order: 30 };
  }
  return { id: 'core-router-workforce', name: 'Core / Điều phối & Nhân sự', order: 10 };
}

function parseDependencies(value = '') {
  return [...String(value || '').matchAll(/#?(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

function statusBucket(status = '') {
  const value = String(status || '').toUpperCase();
  if (value === 'WORKING' || value === 'ĐANG XỬ LÝ' || value === 'ĐANG LÀM') return 'working';
  if (value === 'REVIEW' || value === 'VERIFY' || value === 'RÀ SOÁT' || value === 'XÁC MINH') return 'review';
  if (value === 'OWNER_GATE' || value === 'BLOCKED' || value === 'BỊ CHẶN' || value === 'LỖI') return 'blocked';
  if (value === 'DONE' || value === 'COMPLETED' || value === 'HOÀN TẤT' || value === 'HOÀN THÀNH') return 'done';
  return 'waiting';
}

export function annotatePortfolioRows(rows = [], issues = []) {
  const issueMap = new Map((Array.isArray(issues) ? issues : []).map((issue) => [Number(issue?.number), issue]));
  const staged = (Array.isArray(rows) ? rows : []).map((row) => {
    const issue = issueMap.get(Number(row?.number)) || null;
    const project = classifyProject(row, issue);
    const workPackage = legacyWorkPackage(project, row, issue);
    const body = String(issue?.body || '');
    const explicitDependencies = parseDependencies(bodyValue(body, 'DEPENDENCIES') || bodyValue(body, 'DEPENDS_ON'));
    return {
      ...row,
      projectId: project.id,
      projectName: project.name,
      projectOrder: project.order,
      projectKind: project.kind || 'project',
      projectGroupId: project.groupId || project.id,
      workstreamId: workPackage.id,
      workstreamName: workPackage.name,
      workstreamOrder: workPackage.order,
      workPackageId: workPackage.id,
      workPackageName: workPackage.name,
      workPackageOrder: workPackage.order,
      jobId: bodyValue(body, 'JOB_ID') || (row?.number ? 'GH-' + row.number : null),
      assignee: bodyValue(body, 'ASSIGNEE') || bodyValue(body, 'TARGET_EMPLOYEE') || row?.employeeId || null,
      dependencies: explicitDependencies.length ? explicitDependencies : (Array.isArray(row?.dependencies) ? row.dependencies : []),
      nextAction: bodyValue(body, 'NEXT_ACTION') || bodyValue(body, 'NEXT') || row?.nextStep || row?.currentStep || null,
      androidVersionMinor: workPackage.androidMinor ?? androidMinorVersion(row, issue),
      portfolioHidden: false,
      portfolioHiddenReason: null,
      _portfolioProjectExplicit: Boolean(bodyValue(issue?.body || '', 'PROJECT_ID') || bodyValue(issue?.body || '', 'PROJECT_NAME')),
      _portfolioPackageExplicit: Boolean(bodyValue(issue?.body || '', 'WORKSTREAM_ID') || bodyValue(issue?.body || '', 'WORKSTREAM_NAME') || bodyValue(issue?.body || '', 'WORK_PACKAGE_ID') || bodyValue(issue?.body || '', 'WORK_PACKAGE_NAME')),
    };
  });

  const stagedByNumber = new Map(staged.map((row) => [Number(row?.number), row]));
  for (let pass = 0; pass < 4; pass += 1) {
    for (const row of staged) {
      const parent = stagedByNumber.get(Number(row?.parentNumber));
      if (!parent) continue;
      const reviewEvidence = row?.reviewOnly === true || /\[REVIEW\]/i.test(String(row?.title || ''));
      if (!reviewEvidence) continue;
      if (!row._portfolioProjectExplicit) {
        row.projectId = parent.projectId;
        row.projectName = parent.projectName;
        row.projectOrder = parent.projectOrder;
        row.projectKind = parent.projectKind;
        row.projectGroupId = parent.projectGroupId;
      }
      if (!row._portfolioPackageExplicit) {
        row.workstreamId = parent.workstreamId;
        row.workstreamName = parent.workstreamName;
        row.workstreamOrder = parent.workstreamOrder;
        row.workPackageId = parent.workPackageId;
        row.workPackageName = parent.workPackageName;
        row.workPackageOrder = parent.workPackageOrder;
      }
    }
  }

  const mobileVersions = staged
    .filter((row) => row.projectId === 'tigeriq-mobile-worker' && Number.isFinite(Number(row.androidVersionMinor)))
    .map((row) => Number(row.androidVersionMinor));
  const currentMobileMinor = mobileVersions.length ? Math.max(...mobileVersions) : null;

  return staged.map((row) => {
    let next = row;
    if (row.projectId === 'tigeriq-mobile-worker' && currentMobileMinor != null) {
      const minor = Number(row.androidVersionMinor);
      if (Number.isFinite(minor) && minor < currentMobileMinor) {
        next = { ...row, portfolioHidden: true, portfolioHiddenReason: 'LEGACY_ANDROID_VERSION' };
      }
    }
    const { _portfolioProjectExplicit, _portfolioPackageExplicit, ...clean } = next;
    return clean;
  });
}


// Presentation snapshot only. Prefer current open-work state over active/recent duplicates.
export function mergePortfolioWorkRows(openWork = [], activeWork = [], recentWork = []) {
  const rows = new Map();
  for (const source of [openWork, activeWork, recentWork]) {
    for (const row of Array.isArray(source) ? source : []) {
      const key = row?.number ? String(row.number) : row?.jobId || row?.url;
      if (!key) continue;
      const current = rows.get(key);
      rows.set(key, current ? { ...row, ...current } : { ...row });
    }
  }
  return [...rows.values()];
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
      groupId: row.projectGroupId || row.projectId,
      groupName: PORTFOLIO_GROUP_BY_ID.get(row.projectGroupId || row.projectId)?.name || row.projectName,
      groupOrder: PORTFOLIO_GROUP_BY_ID.get(row.projectGroupId || row.projectId)?.order || 900,
      workPackages: new Map(),
      workstreams: new Map(),
      counts: { working: 0, review: 0, blocked: 0, waiting: 0, done: 0 },
      hiddenTechnicalItems: 0,
    };
    const packageId = String(row.workstreamId || row.workPackageId || 'unclassified');
    if (!current.workPackages.has(packageId)) {
      current.workPackages.set(packageId, {
        id: packageId,
        name: row.workstreamName || row.workPackageName || packageId,
        order: Number(row.workstreamOrder || row.workPackageOrder) || 900,
        counts: { working: 0, review: 0, blocked: 0, waiting: 0, done: 0 },
        itemCount: 0,
      });
    }
    const pack = current.workPackages.get(packageId);
    current.workstreams.set(packageId, pack);
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
    kind: PROJECT_BY_ID.get(project.id)?.kind || 'project',
    workPackageCount: project.workPackages.size,
    workstreamCount: project.workstreams.size,
    hiddenTechnicalItems: project.hiddenTechnicalItems,
    workstreams: [...project.workstreams.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    workPackages: [...project.workPackages.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
  })) .sort((a, b) => a.groupOrder - b.groupOrder || a.order - b.order || a.name.localeCompare(b.name));
}

export const CANONICAL_PROJECTS = PROJECTS;
