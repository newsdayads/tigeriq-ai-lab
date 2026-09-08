import { describe, expect, it } from 'vitest';
import { MANAGEMENT_V5_CSS, overviewCheckpointScriptV5, renderOverviewSignalsV5, renderProjectsV5, renderReportsV5, renderSettingsV5 } from '../apps/dashboard/src/management-views-v5.js';
import type { ExecutiveDashboardV4, ExecutiveWorkV4 } from '../apps/dashboard/src/executive-data-v4.js';

const work:ExecutiveWorkV4={number:511,title:'Web Control V5',ownerCode:'NV01',owner:'Minh (NV01)',progressPercent:null,progressLabel:'—',status:'Đang làm',tone:'active',next:'Rollout',updated:'08/09/2026',workId:'GH-511',projectId:'project:tigeriq',project:'TigerIQ',priority:'P0',goal:'Phòng điều hành sống',currentStep:'Batch V5',updatedAt:'2026-09-08T08:00:00Z',lastActivityAt:'2026-09-08T08:00:00Z',timeline:[{timestamp:'2026-09-08T08:00:00Z',message:'work.step · Batch V5'}]};
const data:ExecutiveDashboardV4={generatedAt:'2026-09-08T08:00:00Z',works:[work],people:[],systems:[],activeCount:1,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:'Không'};

describe('Web V5 management views',()=>{
  it('renders project stable id and work deep link',()=>{const html=renderProjectsV5(data);expect(html).toContain('project:tigeriq');expect(html).toContain('/projects/project%3Atigeriq');const detail=renderProjectsV5(data,'project:tigeriq');expect(detail).toContain('/work/GH-511');});
  it('renders source-limited reports without fake metrics',()=>{const html=renderReportsV5(data);expect(html).toContain('Chưa đủ dữ liệu');expect(html).toContain('Sự kiện có thời gian');});
  it('keeps settings write controls fail-closed',()=>{const html=renderSettingsV5();expect(html).toContain('Điều khiển ghi');expect(html).toContain('Khóa');expect(html).not.toContain('<form');});
  it('renders overview recent/next/since checkpoint contract',()=>{const html=renderOverviewSignalsV5(data);expect(html).toContain('Vừa xảy ra');expect(html).toContain('Sắp làm gì');expect(html).toContain('Từ lần xem trước');const script=overviewCheckpointScriptV5();expect(script).toContain('localStorage');expect(script).toContain('tigeriq-v5-last-view');});
  it('keeps report/project content shrinkable on narrow viewports',()=>{expect(MANAGEMENT_V5_CSS).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');expect(MANAGEMENT_V5_CSS).toContain('.mv5-report-grid section,.mv5-callout{min-width:0');expect(MANAGEMENT_V5_CSS).toContain('.mv5-card p{color:#9fb2ca;font-size:11px;overflow-wrap:anywhere;word-break:break-word}');});
});
