import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRegistryWorkforceV5, type ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';
import { stabilizeExecutiveDataV5 } from '../apps/dashboard/src/runtime-state-v5.js';

const registry = `
| mã | tên hiển thị bắt buộc | chức năng chính | trạng thái mặc định |
|---|---|---|---|
| \`NV01\` | **Minh (NV01 - Kỹ sư chính / P0 & kỹ thuật)** | P0 | ENABLED (đã kích hoạt) |
| \`NV02\` | **Khoa (NV02 - Nhân viên nền 24/24 / xử lý hàng đợi)** | Queue | ENABLED (đã kích hoạt); IDLE (rảnh) nếu không có việc |
| \`NV03\` | **Huy (NV03 - Kỹ sư hệ thống dự phòng / hạ tầng)** | Hạ tầng | PAUSED (tạm dừng) |
| \`NV04\` | **Khải (NV04 - Chuyên gia AI/API / điều phối mô hình)** | AI/API | ENABLED (đã kích hoạt) |
| \`NV05\` | **An (NV05 - Kỹ sư Sản phẩm/Ứng dụng)** | Sản phẩm | PENDING (chưa kích hoạt) |
| \`NV06\` | **OpenClaw (NV06 - Nhân viên tự động hóa trình duyệt/công cụ)** | Tự động hóa | ENABLED (đã kích hoạt) |
| \`NV07\` | **ChatGPT GO (NV07 - Kiểm toán & giám sát định kỳ)** | Kiểm toán | ENABLED (đã kích hoạt); VERIFY_PENDING (chờ xác minh lịch chạy thật) |
| \`NV08\` | **Gemini Plus (NV08 - Chuyên gia nghiên cứu & phân tích độc lập)** | Nghiên cứu | AVAILABLE_MANUAL (dùng thủ công) |
`;

describe('Web V5 Registry v15 workforce contract', () => {
  it('parses all eight canonical employee identities', () => {
    const people = parseRegistryWorkforceV5(registry);
    expect(people.map((row) => row.code)).toEqual(['NV01','NV02','NV03','NV04','NV05','NV06','NV07','NV08']);
    expect(people.find((row) => row.code === 'NV02')?.name).toBe('Khoa (NV02 - Nhân viên nền 24/24 / xử lý hàng đợi)');
    expect(people.find((row) => row.code === 'NV06')?.name).toBe('OpenClaw (NV06 - Nhân viên tự động hóa trình duyệt/công cụ)');
    expect(people.find((row) => row.code === 'NV03')?.defaultStatus).toBe('PAUSED (tạm dừng)');
    expect(people.find((row) => row.code === 'NV08')?.defaultStatus).toBe('AVAILABLE_MANUAL (dùng thủ công)');
  });

  it('preserves dynamic roster and canonicalizes stale pulse owner', async () => {
    const parsed = parseRegistryWorkforceV5(registry);
    const data: ExecutiveDashboardV4 = {
      generatedAt: new Date().toISOString(), works: [],
      people: [
        { key:'VY', initials:'VY', name:'Vy (Trợ lý)', role:'Trợ lý', status:'READY (sẵn sàng)', tone:'waiting', current:'Điều phối', activeCount:0 },
        ...parsed.map((row) => ({ key:row.code, initials:row.initials, name:row.name, role:row.role, status:row.defaultStatus, tone:row.defaultTone, current:'Chưa có JOB', activeCount:0 })),
      ],
      systems: [], activeCount:0, waitingCount:0, blockedCount:0, doneCount:0, pausedCount:0,
      progressAverage:null, ownerActionRequired:false, ownerActionText:'Không có việc cần anh Sơn',
    };
    const root = await mkdtemp(join(tmpdir(), 'tigeriq-registry-v15-'));
    const pulse = join(root, 'pulse.json'); const cache = join(root, 'cache.json');
    await writeFile(pulse, JSON.stringify({
      workId:'GH-478', issueNumber:478, title:'Zero-touch self-update', ownerCode:'NV02',
      owner:'Khoa (NV02)', priority:'P0', status:'waiting', currentStep:'Chờ JOB', heartbeatAt:new Date().toISOString(),
    }), 'utf8');
    const stable = await stabilizeExecutiveDataV5(data, { pulsePath:pulse, snapshotPath:cache });
    expect(stable.people.filter((person) => person.key !== 'VY')).toHaveLength(8);
    expect(stable.works[0]?.owner).toBe('Khoa (NV02 - Nhân viên nền 24/24 / xử lý hàng đợi)');
    expect(stable.people.find((person) => person.key === 'NV02')?.status).toBe('QUEUED (đang chờ nhận)');
    await rm(root, { recursive:true, force:true });
  });
});