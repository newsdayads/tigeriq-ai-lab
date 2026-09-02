export const CONTROL_TOWER_VIEW_MODEL_VERSION = 'tigeriq.company-control-tower.view.v2-preview';

const asArray = value => Array.isArray(value) ? value : [];
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = value => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);

function emptyBusiness(reason = 'BUSINESS_CONTRACT_PENDING') {
  return {
    available: false,
    reason,
    goals: [],
    kpis: [],
    performance: {
      availability: 'unavailable',
      metrics: [],
      note: 'Chưa có nguồn business authoritative được map từ contract #146.',
    },
    missions: [],
    ownerActions: [],
    outcomes: [],
    processes: [],
  };
}

function optionalBusinessProjection(snapshot) {
  const raw = asObject(snapshot.businessState || snapshot.business || snapshot.companyBusiness);
  if (!Object.keys(raw).length) return emptyBusiness();
  return {
    available: true,
    reason: null,
    goals: asArray(raw.goals),
    kpis: asArray(raw.kpis),
    performance: {
      availability: raw.performance?.availability || 'available',
      metrics: asArray(raw.performance?.metrics),
      note: raw.performance?.note || null,
    },
    missions: asArray(raw.missions),
    ownerActions: asArray(raw.ownerActions || raw.exceptions),
    outcomes: asArray(raw.outcomes),
    processes: asArray(raw.processes),
  };
}

function technicalProjection(snapshot) {
  return {
    controller: asObject(snapshot.controller),
    jobs: asArray(snapshot.jobs),
    devices: asArray(snapshot.devices),
    providers: asArray(snapshot.providers),
    prompts: asArray(snapshot.prompts),
    results: asArray(snapshot.results),
    checks: asArray(snapshot.checks),
    activity: asArray(snapshot.activity),
    build: asObject(snapshot.build),
    leases: asArray(snapshot.leases),
  };
}

function runtimeSummary(snapshot) {
  const controller = asObject(snapshot.controller);
  const devices = asArray(snapshot.devices);
  const providers = asArray(snapshot.providers);
  const onlineDevices = devices.filter(row => String(row.status || '').toLowerCase() === 'online').length;
  const healthyProviders = providers.filter(row => String(row.health || '').toLowerCase() === 'healthy').length;
  return [
    { key: 'controller', label: 'Controller', value: controller.state || 'unknown' },
    { key: 'devices', label: 'Thiết bị', value: devices.length ? `${onlineDevices}/${devices.length} online` : 'unknown' },
    { key: 'providers', label: 'AI', value: providers.length ? `${healthyProviders}/${providers.length} healthy` : 'unknown' },
  ];
}

export function buildCompanyControlTowerViewModel(snapshot, options = {}) {
  const source = asObject(snapshot?.source);
  const liveAuthoritative = source.mode === 'controller' && source.authoritative === true;
  const previewBusiness = options.previewBusiness && typeof options.previewBusiness === 'object' ? options.previewBusiness : null;

  // Preview data is intentionally accepted only when the source is NOT authoritative.
  // This prevents a live Controller connection from silently inheriting mock business facts.
  const business = liveAuthoritative
    ? optionalBusinessProjection(snapshot)
    : previewBusiness
      ? { ...emptyBusiness('PREVIEW_ONLY'), ...previewBusiness, available: true }
      : emptyBusiness(source.mode === 'mock' ? 'MOCK_WITHOUT_PREVIEW' : 'NON_AUTHORITATIVE_SOURCE');

  const company = asObject(snapshot?.company);
  const departments = asArray(snapshot?.departments);
  const employees = asArray(snapshot?.employees);

  return {
    version: CONTROL_TOWER_VIEW_MODEL_VERSION,
    generatedAt: snapshot?.generatedAt || null,
    source: {
      mode: source.mode || 'unknown',
      authoritative: liveAuthoritative,
      label: source.label || 'Nguồn chưa xác định',
      businessAvailable: Boolean(business.available),
      businessReason: business.reason || null,
    },
    company: {
      name: company.name || 'TigerIQ AI Lab',
      version: company.version || 'V2',
      phase: company.phase || null,
      operatingMode: company.operatingMode || null,
      currentObjective: company.currentObjective || null,
      truthPolicy: company.truthPolicy || null,
    },
    goals: asArray(business.goals),
    kpis: asArray(business.kpis),
    performance: asObject(business.performance),
    missions: asArray(business.missions),
    departments,
    employees,
    ownerActions: asArray(business.ownerActions),
    outcomes: asArray(business.outcomes),
    processes: asArray(business.processes),
    runtimeSummary: runtimeSummary(snapshot || {}),
    technical: technicalProjection(snapshot || {}),
  };
}

export function controlTowerTruthCheck(viewModel) {
  const vm = asObject(viewModel);
  if (vm.source?.authoritative === true && vm.source?.mode !== 'controller') {
    throw new Error('CONTROL_TOWER_AUTHORITATIVE_SOURCE_INVALID');
  }
  if (vm.source?.authoritative === true && vm.source?.businessReason === 'PREVIEW_ONLY') {
    throw new Error('CONTROL_TOWER_PREVIEW_CANNOT_BE_AUTHORITATIVE');
  }
  return vm;
}

export function kpiHealthScore(kpis = []) {
  const rows = asArray(kpis).filter(row => finite(row.healthPct) !== null);
  if (!rows.length) return null;
  return Math.round(rows.reduce((sum, row) => sum + Math.max(0, Math.min(100, finite(row.healthPct))), 0) / rows.length);
}
