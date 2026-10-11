import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
const start=dashboard.indexOf('function isTechnicalJobText(');
const end=dashboard.indexOf('function stateBadge(',start);
if(start<0||end<=start)throw new Error('CORE_VI_ACTIVITY_FUNCTION_NOT_FOUND');
const source=dashboard.slice(start,end);
type Resource={status?:string;current_job_id?:string;live_job?:string;live_detail?:string;last_error?:string};
const simpleState=(r:Resource)=>{
  const status=String(r.status||'UNKNOWN').toUpperCase();
  const group=status==='BUSY'?'working':['READY','IDLE','ONLINE'].includes(status)?'ready':status==='ON_DEMAND'?'ondemand':['RATE_LIMITED','WAITING'].includes(status)?'waiting':['BLOCKED','ERROR','OFFLINE','WAIT_KEY'].includes(status)?'attention':status==='UNKNOWN'?'unknown':'paused';
  return {group};
};
const ui=new Function('simpleState',source+';return {employeeTask,employeeBlocker,employeeNextStep};')(simpleState) as {
  employeeTask:(r:Resource)=>string; employeeBlocker:(r:Resource)=>string;employeeNextStep:(r:Resource)=>string
};
describe('Core API Health Vietnamese employee activity (real dashboard source)',()=>{
  it('explains ongoing CORE-PROBE without exposing opaque technical IDs',()=>{
    const x={status:'BUSY',current_job_id:'CORE-PROBE:res:ollama:qwen3-8b:nv08-manager'};
    expect(ui.employeeTask(x)).toBe('🔍 Đang kiểm tra khả năng phản hồi của AI');
    expect(ui.employeeNextStep(x)).toContain('Chờ kết quả kiểm tra');
    expect(ui.employeeTask(x)).not.toContain('res:');
  });
  it('shows verified human job title without prefixing Job ID',()=>{
    expect(ui.employeeTask({status:'BUSY',current_job_id:'JOB-GH-4456',live_job:'Kiểm tra dữ liệu GitHub'})).toBe('Kiểm tra dữ liệu GitHub');
  });
  it('does not invent projects or completion when only technical ID exists',()=>{
    const x={status:'BUSY',current_job_id:'JOB-123'};
    expect(ui.employeeTask(x)).toContain('Chưa có mô tả');
    expect(ui.employeeTask(x)).not.toContain('JOB-123');
    expect(ui.employeeNextStep(x)).toContain('Chưa có bước');
  });
  it('translates rate limits, offline, review waiting, and unknown truthfully',()=>{
    expect(ui.employeeTask({status:'RATE_LIMITED'})).toContain('giới hạn lượt gọi API');
    expect(ui.employeeTask({status:'OFFLINE'})).toContain('Không kết nối');
    expect(ui.employeeTask({status:'BLOCKED',last_error:'API_ERROR_401'})).toContain('Đang bị chặn');
    expect(ui.employeeBlocker({status:'BLOCKED',last_error:'API_ERROR_401'})).toContain('Có lỗi kỹ thuật');
    expect(ui.employeeTask({status:'UNKNOWN'})).toContain('Chưa đủ tín hiệu');
    expect(ui.employeeTask({status:'ON_DEMAND'})).toContain('được giao việc');
  });
  it('keeps detailed technical evidence for inspection',()=>{
    expect(dashboard).toContain("['Job ID',x.current_job_id||'—']");
    expect(dashboard).toContain("['Lỗi',x.last_error||'—']");
    expect(dashboard).toContain("['Đang làm gì?',employeeTask(x)]");
    expect(dashboard).toContain("['Bước tiếp theo',employeeNextStep(x)]");
  });
});