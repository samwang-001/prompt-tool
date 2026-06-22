/**
 * Cloudflare Pages Function: 代理 Pollinations API 请求
 * 
 * 背景：Pollinations API 检测到浏览器 Origin 头就返回 403，
 * 所以必须通过服务端代理，去掉 Origin 头后再请求。
 * 
 * 本地开发：server.js 中的 /api/pollinations 端点
 * 生产环境：本 Cloudflare Pages Function
 */

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const params = url.searchParams;

  const prompt = params.get('prompt');
  const width = params.get('width') || '1024';
  const height = params.get('height') || '1024';
  const seed = params.get('seed') || '42';
  const model = params.get('model') || 'flux';

  if (!prompt) {
    return new Response(JSON.stringify({ error: '缺少 prompt 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const upstreamUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=${model}`;

  try {
    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        // 关键：不转发 Origin 头，让 Pollinations API 正常响应
        'Accept': 'image/*',
      }
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Pollinations 返回 ${response.status}` }),
        { 
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // 透传图片响应
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Pollinations 服务不可达' }),
      { 
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
