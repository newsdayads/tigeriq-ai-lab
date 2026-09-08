import { describe, expect, it } from 'vitest';
import { renderSystemContentV5, renderWorkforceContentV5 } from '../apps/dashboard/src/entity-views-v5.js';
import { systemRows, type ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';

const telemetry: ServerTelemetry = {
  available:true, server:'PC01', generatedAt:'2026-09-08T08:00:00.000Z', cpu:{utilizationPercent:10},
  memory:{usedBytes:10,totalBytes:100,utilizationPercent:10}, uptimeSeconds:100, disk:{drive:'D:',freeBytes:50,totalBytes:100,utilizationPercent:50},
  worker:{online:true,pid:24700,instances:1}, controller:{online:true,ip:'100.97.23.87',port:8790,protocol:'controller-v1'},
  workforce:null, postgresql:{online:true,service:null,port:5432}, ollama:{online:true,models:['qwen3:4b']},
  tailscale:{online:true,ip:'100.97.23.87'}, gpu:null,
};

function data(): ExecutiveDashboardV4 {
  return { generatedAt:telemetry.generatedAt, works:[{number:509,title:'Work V5',ownerCode:'NV01',owner:'Minh (NV01)',progressPercent:null,progressLabel:'—',status:'Đang làm',tone:'active',next:'System',updated:'—',workId:'GH-509'}],
    people:[{key:'VY',initials:'VY',name:'Vy (Trợ lý)',role:'Điều phối',status:'Điều phối',tone:'active',current:'Điều phối',activeCount:0},{key:'NV01',initials:'MI',name:'Minh (NV01)',role:'Thực thi trực tiếp',status:'Đang làm',tone:'active',current:'Work V5',activeCount:1}],
    systems:systemRows(telemetry),activeCount:1,waitingCount:0,blockedCount:0,doneCount:0,pausedCount:0,progressAverage:null,ownerActionRequired:false,ownerActionText:'Không có việc cần anh Sơn' };
}
describe('Web Control V5 entity views', () => {
  it('keeps Workforce as Registry employees and stable people deep-links', () => {
    const html=renderWorkforceContentV5(data());
    expect(html).toContain('/people/NV01');
    expect(html).toContain('Minh (NV01)');
    expect(html).not.toContain('/people/VY');
    expect(html).not.toContain('Workforce Controller');
    const detail=renderWorkforceContentV5(data(),'NV01');
    expect(detail).toContain('/work/GH-509');
    expect(detail).toContain('Chưa có liên kết xác minh');
    expect(detail).toContain('Chưa có nguồn trực tiếp');
  });

  it('renders system truth and fails unknown components closed', () => {
    const d=data(); const html=renderSystemContentV5(d);
    for(const label of ['Máy chủ PC01','Bộ điều phối công việc','Tiến trình thực thi PC01','Bộ lập kế hoạch','Bộ điều phối nhiệm vụ','Giám sát tự vận hành','Web Control','PostgreSQL','Ollama','OpenClaw','Kênh trình duyệt','Điều khiển PC từ xa']) expect(html).toContain(label);
    expect(html).toContain('/system/worker');
    expect(html).toContain('PID 24700');
    expect(html).toContain('Disk D:');
    const planner=d.systems.find((row)=>row.key==='planner');
    expect(planner?.tone).toBe('unknown');
    expect(planner?.status).toBe('Chưa xác minh');
    const detail=renderSystemContentV5(d,'planner');
    expect(detail).toContain('Chưa có nguồn trạng thái trực tiếp');
  });
});