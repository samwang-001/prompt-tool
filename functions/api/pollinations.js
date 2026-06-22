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
  console.log(`[Pollinations] 发起请求: ${width}×${height} model=${model} seed=${seed}`);

  try {
    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Accept': 'image/*',
      }
    });

    // 读取响应，记录实际尺寸用于调试
    const arrayBuffer = await response.arrayBuffer();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Pollinations 返回 ${response.status}` }),
        { 
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (arrayBuffer.byteLength < 100) {
      return new Response(
        JSON.stringify({ error: 'Pollinations 返回了空图片' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pollinations] 成功: ${arrayBuffer.byteLength} bytes, 请求尺寸 ${width}×${height}`);

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return new Response(arrayBuffer, {
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
