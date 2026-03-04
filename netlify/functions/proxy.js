// Netlify Function: proxy
// URLプロキシ — CORS・Mixed Contentを回避してHTMLまたはJSONを取得する
// Usage: /.netlify/functions/proxy?url=https://example.com/product

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'url parameter required' }) };
  }

  // 安全チェック: http(s):// のみ許可
  if (!/^https?:\/\//i.test(url)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid url scheme' }) };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WalkingAgeTestBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9',
      },
      redirect: 'follow',
    });

    const contentType = res.headers.get('content-type') || 'text/plain';
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
