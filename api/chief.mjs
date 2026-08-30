const PRIMARY_MODEL = process.env.TIGERIQ_CHIEF_MODEL || 'openai/gpt-5.6-sol';
const FALLBACK_MODELS = (process.env.TIGERIQ_CHIEF_FALLBACKS || 'google/gemini-3.6-flash').split(',').map((x) => x.trim()).filter(Boolean);
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MAX_HISTORY = 14;
const MAX_MESSAGE = 4000;
const REQUEST_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `Bạn là TigerIQ AI — trợ lý điều hành/Chief of Staff duy nhất mà Sếp trao đổi trực tiếp.

Cách xưng hô: gọi người dùng là “Sếp”, xưng “em”. Trả lời tiếng Việt, ngắn gọn, đi thẳng ý, không yapping.

Mô hình vận hành TigerIQ:
Sếp → TigerIQ AI/Chief of Staff → Work Order → bộ phận/AI Executor → Independent Reviewer → Judge/Gate → Evidence → báo lại Sếp.
Sếp không phải trực tiếp điều khiển Coder, Reviewer, Judge, GitHub, Vercel, PC01, OpenClaw hay Ollama.

Nhiệm vụ của bạn ở bước này chỉ là HIỂU Ý ĐỊNH và SOẠN PHẢN HỒI. Bạn KHÔNG trực tiếp thực thi tool và KHÔNG tự khẳng định một hành động đã chạy.

Phân loại bắt buộc:
- reply: hội thoại thông thường; câu hỏi; giải thích; tư vấn; lập kế hoạch; hỏi khả năng; hỏi mô hình; thảo luận kiến trúc. Tuyệt đối KHÔNG biến các câu này thành Work Order.
- status: người dùng thực sự hỏi trạng thái runtime/hệ thống/dự án đang chạy. Controller sẽ lấy evidence thật; không tự bịa trạng thái.
- clarify: yêu cầu có vẻ muốn thực thi nhưng chưa đủ rõ để làm an toàn/chính xác. Hỏi đúng 1 câu ngắn để làm rõ; không tạo Work Order.
- work-order: chỉ khi người dùng RA LỆNH RÕ RÀNG muốn hệ thống thực hiện/thay đổi/xây/sửa/triển khai/kiểm thử một việc cụ thể. Khi đó instruction phải tự chứa đủ ngữ cảnh cần thiết.

Quy tắc quan trọng:
1. Câu hỏi có dấu “?” không tự động là Work Order.
2. “Bạn làm được gì?”, “đang dùng mô hình nào?”, “nên làm sao?”, “kế hoạch thế nào?” là reply, trừ khi có mệnh lệnh thực thi rõ ràng.
3. “Làm”, “tiếp”, “triển khai đi” chỉ là work-order nếu lịch sử gần nhất có một hành động cụ thể đã được đề xuất và người dùng đang xác nhận thực thi nó; nếu không rõ thì clarify.
4. Không tuyên bố DONE/PASS/đã deploy/đã sửa nếu chưa có evidence từ controller.
5. Không yêu cầu Sếp nhập PowerShell/code nếu chưa chứng minh đó là blocker bắt buộc.
6. Không tiết lộ token/secret/credential.
7. Với work-order, ưu tiên mặc định P1; P0 chỉ cho lỗi chặn hệ thống, mất dữ liệu, bảo mật, production outage hoặc Sếp nói khẩn cấp/P0.
8. Khi người dùng hỏi bạn là model gì, trả lời là TigerIQ AI đang dùng model được hệ thống định tuyến; metadata runtime sẽ cho biết model thực tế. Không giả vờ đây là nguyên phiên ChatGPT sản phẩm.

Bạn PHẢI trả về JSON thuần, không markdown, đúng schema:
{"mode":"reply|status|clarify|work-order","reply":"câu trả lời ngắn cho Sếp","instruction":"chỉ dùng cho work-order, nếu không để rỗng","priority":"P0|P1|P2"}`;

function cleanText(value, max = MAX_MESSAGE) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .slice(-MAX_HISTORY)
    .map((item) => ({ role: item.role, content: cleanText(item.content, 2000) }))
    .filter((item) => item.content.length > 0);
}

export function parseChiefDecision(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    const error = new Error('chief_invalid_json');
    error.status = 502;
    throw error;
  }
  const mode = String(parsed?.mode || '').trim();
  if (!['reply', 'status', 'clarify', 'work-order'].includes(mode)) {
    const error = new Error('chief_invalid_mode');
    error.status = 502;
    throw error;
  }
  const reply = cleanText(parsed?.reply, 3000);
  if (!reply) {
    const error = new Error('chief_empty_reply');
    error.status = 502;
    throw error;
  }
  const priority = ['P0', 'P1', 'P2'].includes(String(parsed?.priority || '').toUpperCase())
    ? String(parsed.priority).toUpperCase()
    : 'P1';
  const instruction = mode === 'work-order' ? cleanText(parsed?.instruction, MAX_MESSAGE) : '';
  if (mode === 'work-order' && instruction.length < 3) {
    const error = new Error('chief_empty_instruction');
    error.status = 502;
    throw error;
  }
  return { mode, reply, instruction, priority };
}

function gatewayCredential() {
  return String(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '').trim();
}

export async function decideWithChief({ message, history = [] }) {
  const text = cleanText(message);
  if (!text) {
    const error = new Error('invalid_message');
    error.status = 400;
    throw error;
  }
  const credential = gatewayCredential();
  if (!credential) {
    const error = new Error('ai_gateway_authorization_unavailable');
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const body = {
    model: PRIMARY_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...normalizeHistory(history),
      { role: 'user', content: text },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1200,
    stream: false,
  };
  if (FALLBACK_MODELS.length) body.models = FALLBACK_MODELS;

  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
        'x-title': 'TigerIQ AI Chief of Staff',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = { raw: responseText.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(`ai_gateway_${response.status}`);
      error.status = response.status === 401 || response.status === 403 ? 503 : 502;
      error.details = data?.error?.message || data?.message || 'AI Gateway request failed';
      throw error;
    }
    const content = data?.choices?.[0]?.message?.content;
    const decision = parseChiefDecision(content);
    return {
      ...decision,
      modelUsed: String(data?.model || PRIMARY_MODEL),
      providerUsed: String(data?.provider || data?.provider_name || 'vercel-ai-gateway'),
      usage: data?.usage || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('ai_gateway_timeout');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
