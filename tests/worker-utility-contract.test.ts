import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
const client=readFileSync('apps/worker-utility/ControllerClient.cs','utf8');
const context=readFileSync('apps/worker-utility/UtilityContext.cs','utf8');
const tray=readFileSync('apps/worker-utility/TrayPanelForm.cs','utf8');
const badge=readFileSync('apps/worker-utility/BadgeForm.cs','utf8');
const watchdog=readFileSync('apps/worker-utility/Watchdog.cs','utf8');
const store=readFileSync('apps/worker-utility/StateStore.cs','utf8');
const program=readFileSync('apps/worker-utility/Program.cs','utf8');
const installer=readFileSync('apps/worker-utility/Install-WorkerUtility.ps1','utf8');
const binder=readFileSync('apps/worker-utility/WindowBinder.cs','utf8');

describe('Worker Utility V1 contract',()=>{
  it('uses Controller 8798 and bridge 8799',()=>{
    expect(client).toContain('http://127.0.0.1:8798');
    expect(server).toContain("http://127.0.0.1:8799/health");
    expect(bridge).toContain("const CONTROLLER='http://127.0.0.1:8798'");
  });

  it('uses independent launch broker and no embedded worker credential',()=>{
    expect(server).not.toContain('spawn(config.chromePath');
    expect(server).toContain('CHROME_LAUNCH_REQUESTED_VIA_BROKER');
    expect(bridge).toContain('TIGERIQ_NV02_WORKER_TOKEN');
    expect(bridge).not.toMatch(/NV02_TOKEN='[0-9a-f]{24,}'/i);
  });

  it('keeps the full action contract behind the tray UI',()=>{
    for(const x of ['run','pause','focus','fix','lock','open','health','save','save-archive','close','recover','schedule-10','schedule-30','schedule-60','schedule-120','schedule-custom','schedule-cancel','advanced'])
      expect(context).toContain(`case "${x}"`);
    expect(context).toContain('ToggleDnd');
  });

  it('binds compact badges in logical coordinates and opens the tray flyout',()=>{
    expect(program).toContain('HighDpiMode.DpiUnaware');
    expect(binder).toContain('OrderBy(x => x.Distance)');
    expect(binder).toContain('best.Distance > 180');
    expect(badge).toContain('Size = new Size(48, 26)');
    expect(context).toContain('new BadgeForm(worker, ShowTrayForWorker');
    expect(context).toContain('ShowTrayForWorker');
  });

  it('uses one auto-hiding System Tray flyout instead of persistent worker control windows',()=>{
    expect(tray).toContain('System Tray Utility');
    expect(tray).toContain('Deactivate += (_, _) => Hide()');
    expect(tray).toContain('ClientSize = new Size(1330, 810)');
    expect(context).toContain('new TrayPanelForm(HandleActionAsync, FocusAllChromeAsync, () => store.RecentLogs(60), id => store.RecentLogs(id, 5)');
    expect(context).not.toContain('new PopupForm');
    expect(context).toContain('TRAY_FLYOUT_OPENED');
  });

  it('restores the Layout 2 global rail and worker color zoning',()=>{
    for(const label of ['TigerIQ Workers','Mở tất cả cửa sổ','Bảng điều khiển nhanh','Cài đặt','Xem log hệ thống','Không làm phiền','Thoát Utility'])
      expect(tray).toContain(label);
    expect(tray).toContain('Color.FromArgb(37, 99, 235)');
    expect(tray).toContain('Color.FromArgb(192, 64, 255)');
    expect(tray).toContain('Color.FromArgb(6, 182, 212)');
    expect(tray).toContain('ShowSystemLogs');
    expect(tray).toContain('ShowSettingsMenu');
  });

  it('preserves the approved worker controls, scheduler and recent logs on the main face',()=>{
    for(const label of ['Chạy / Tiếp tục','Tạm dừng','Về vị trí','Khóa vị trí','Mở trang','Kiểm tra nhanh','Lưu','Lưu & Lưu trữ','Đóng an toàn'])
      expect(tray).toContain(label);
    for(const label of ['ĐẶT LỊCH KIỂM TRA','10p','30p','1h','2h','Tùy chỉnh','Bật lịch','Chỉ báo khi có thay đổi / lỗi','Lần kiểm tra kế tiếp','LOG GẦN NHẤT'])
      expect(tray).toContain(label);
    expect(tray).toContain('readWorkerLogs(worker.Id)');
    expect(tray).toContain('ShowAdvancedMenu');
    for(const label of ['Focus','Khôi phục an toàn','Đóng NV an toàn','Đặt lại badge'])
      expect(tray).toContain(label);
  });

  it('keeps the flyout non-modal and controller timeouts inline',()=>{
    expect(tray).not.toContain('MessageBox.Show');
    expect(context).not.toContain('MessageBox.Show');
    expect(client).toContain('CONTROLLER_TIMEOUT');
    expect(tray).toContain('SetWorkerNotice');
  });

  it('persists schedules and autostart',()=>{
    expect(store).toContain('state.json');
    expect(store).toContain('CurrentVersion');
    expect(store).toContain('Run');
    expect(context).toContain('NextCheckAt');
  });

  it('fails closed on Session 0 and installer uses an interactive desktop session',()=>{
    expect(program).toContain('SessionId == 0');
    expect(program).toContain('Environment.Exit(42)');
    expect(installer).toContain('-LogonType Interactive');
    expect(installer).toContain('SessionId -ne 0');
  });

  it('decommissions the legacy green overlay so WorkerUtility is the only badge owner',()=>{
    expect(installer).toContain('TigerIQ Worker Status Compact');
    expect(installer).toContain('Worker-Status-Title.ps1');
    expect(installer).toContain('Disable-ScheduledTask');
    expect(installer).toContain('Stop-Process');
  });

  it('implements watchdog bands and fail-closed save/close',()=>{
    for(const x of ['Healthy','Slow','Stalled','Recovering','Blocked']) expect(watchdog).toContain(x);
    expect(watchdog).toContain('FromSeconds(30)');
    expect(watchdog).toContain('FromMinutes(2)');
    expect(watchdog).toContain('FromMinutes(5)');
    expect(client).toContain('SAVE_ACTIVE_MUTATION_FORBIDDEN');
    expect(client).toContain('SAFE_CLOSE_ACTIVE_JOB_FORBIDDEN');
    expect(client).toContain('SAVE_NOT_DURABLE');
  });
});
