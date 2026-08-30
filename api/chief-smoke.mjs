import { decideWithChief } from './chief.mjs';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV === 'production') return json(res, 404, { error: 'not_found' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const decision = await decideWithChief({
      message: 'Bạn đang sử dụng mô hình nào để trao đổi với tôi?',
      history: [
        { role: 'assistant', content: 'Sếp cứ trao đổi với em như chat bình thường; khi Sếp giao việc rõ ràng em mới tạo Work Order.' },
      ],
    });
    return json(res, 200, {
      ok: true,
      expectedMode: 'reply',
      pass: decision.mode === 'reply',
      mode: decision.mode,
      reply: decision.reply,
      modelUsed: decision.modelUsed,
      providerUsed: decision.providerUsed,
    });
  } catch (error) {
    return json(res, Number(error?.status) || 502, {
      error: error instanceof Error ? error.message : String(error),
      details: error?.details || undefined,
    });
  }
}
