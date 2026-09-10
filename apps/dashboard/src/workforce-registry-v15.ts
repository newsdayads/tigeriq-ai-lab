export type EmployeeCode = 'NV01' | 'NV02' | 'NV03' | 'NV04' | 'NV05' | 'NV06' | 'NV07' | 'NV08';

export type RegistryEmployeeV15 = {
  code: EmployeeCode;
  displayName: string;
  role: string;
  defaultStatus: string;
};

const EMPLOYEE_CODES: EmployeeCode[] = ['NV01','NV02','NV03','NV04','NV05','NV06','NV07','NV08'];

const FALLBACK_EMPLOYEES: Record<EmployeeCode, RegistryEmployeeV15> = {
  NV01: { code: 'NV01', displayName: 'Minh (NV01 - Kỹ sư chính / P0 & kỹ thuật)', role: 'Xử lý P0, code, môi trường chạy, kiến trúc, Web/hệ thống', defaultStatus: 'ENABLED' },
  NV02: { code: 'NV02', displayName: 'Khoa (NV02 - Nhân viên nền 24/24 / xử lý hàng đợi)', role: 'Tự nhận JOB nền, thực thi, ghi bằng chứng, tự nhận việc kế tiếp', defaultStatus: 'IDLE' },
  NV03: { code: 'NV03', displayName: 'Huy (NV03 - Kỹ sư hệ thống dự phòng / hạ tầng)', role: 'Hạ tầng/hệ thống dự phòng', defaultStatus: 'PAUSED' },
  NV04: { code: 'NV04', displayName: 'Khải (NV04 - Chuyên gia AI/API / điều phối mô hình)', role: 'AI/API, nhà cung cấp mô hình, hạn mức, chọn mô hình, chuyển dự phòng miễn phí', defaultStatus: 'READY' },
  NV05: { code: 'NV05', displayName: 'An (NV05 - Kỹ sư Sản phẩm/Ứng dụng)', role: 'Sản phẩm, ứng dụng, trải nghiệm và luồng nghiệp vụ', defaultStatus: 'PENDING' },
  NV06: { code: 'NV06', displayName: 'OpenClaw (NV06 - Nhân viên tự động hóa trình duyệt/công cụ)', role: 'Thực thi tác vụ trình duyệt/công cụ/native theo JOB', defaultStatus: 'READY' },
  NV07: { code: 'NV07', displayName: 'ChatGPT GO (NV07 - Kiểm toán & giám sát định kỳ)', role: 'Kiểm toán, kiểm tra chất lượng, giám sát công ty theo lịch', defaultStatus: 'READY' },
  NV08: { code: 'NV08', displayName: 'Gemini Plus (NV08 - Chuyên gia nghiên cứu & phân tích độc lập)', role: 'Nghiên cứu sâu, phân tích, ý kiến độc lập thứ hai', defaultStatus: 'AVAILABLE_MANUAL' },
};

function stripMarkdown(value: string): string {
  return value.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

export function normalizeEmployeeCode(value: string): EmployeeCode | null {
  const match = String(value || '').match(/\b(NV0[1-8])\b/i)?.[1]?.toUpperCase() as EmployeeCode | undefined;
  return match && EMPLOYEE_CODES.includes(match) ? match : null;
}

export function registryEmployeeFallback(code: EmployeeCode): RegistryEmployeeV15 {
  return FALLBACK_EMPLOYEES[code];
}

export function parseRegistryEmployeesV15(body: string): RegistryEmployeeV15[] {
  const rows = String(body || '').split(/\r?\n/);
  const parsed = new Map<EmployeeCode, RegistryEmployeeV15>();
  for (const row of rows) {
    if (!/^\s*\|/.test(row)) continue;
    const cells = row.split('|').slice(1, -1).map(stripMarkdown);
    if (cells.length < 4) continue;
    const code = normalizeEmployeeCode(cells[0]);
    if (!code) continue;
    const displayName = cells[1] || FALLBACK_EMPLOYEES[code].displayName;
    const role = cells[2] || FALLBACK_EMPLOYEES[code].role;
    const defaultStatus = cells[3] || FALLBACK_EMPLOYEES[code].defaultStatus;
    parsed.set(code, { code, displayName, role, defaultStatus });
  }
  return EMPLOYEE_CODES.map((code) => parsed.get(code) ?? FALLBACK_EMPLOYEES[code]);
}

export function resolveRegistryEmployeeV15(body: string, code: EmployeeCode): RegistryEmployeeV15 {
  return parseRegistryEmployeesV15(body).find((row) => row.code === code) ?? FALLBACK_EMPLOYEES[code];
}

export function webAliasIsCanonical(body: string): boolean {
  const text = String(body || '');
  return /511[^\n]*(?:ngừng dùng|retired|không dùng)/i.test(text) && /Web Control[^\n]*`?web`?/i.test(text);
}

export function activeRegistryCommandIssueNumbers(body: string): number[] {
  const text = String(body || '');
  const numbers: number[] = [];
  const apiScope = text.match(/- `4`:[^\n]*scope hiện hành #(\d+)/i);
  if (apiScope) numbers.push(Number(apiScope[1]));
  return [...new Set(numbers.filter((value) => Number.isInteger(value) && value > 0 && value !== 511))];
}
