// Netlify Function: proxy
// URLプロキシ — CORS・Mixed Contentを回避してHTMLまたは画像(base64)を取得する
// Usage:
//   HTML取得: /.netlify/functions/proxy?url=https://example.com/product
//   画像取得: /.netlify/functions/proxy?url=https://cdn.example.com/img.jpg&type=image

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const url = params.url;
  const type = params.type; // 'image' でbase64データURL返却

  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'url parameter required' }) };
  }

  // 安全チェック: http(s):// のみ許可
  if (!/^https?:\/\//i.test(url)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid url scheme' }) };
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (compatible; WalkingAgeTestBot/1.0)',
      'Accept': type === 'image'
        ? 'image/webp,image/avif,image/*,*/*;q=0.8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en;q=0.9',
    };

    const res = await fetch(url, { headers: fetchHeaders, redirect: 'follow' });
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();

    // 画像モード: ArrayBuffer → base64 データURL
    if (type === 'image' || contentType.startsWith('image/')) {
      const mimeType = contentType.startsWith('image/') ? contentType : 'image/jpeg';
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
        body: dataUrl,
      };
    }

    // HTMLモード: テキストそのまま返却
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Original-Content-Type': contentType,
        'X-Original-Status': String(res.status),
      },
      body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'fetch failed', detail: err.message }),
    };
  }
};
