// Netlify Function: shoe-info
// 商品URLから商品名・説明・画像(base64)・価格を取得してJSONで返す
// サーバーサイドで完結するためCORS・Mixed Content問題を完全回避
//
// Usage: /.netlify/functions/shoe-info?url=https://example.com/product

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const url = (event.queryStringParameters || {}).url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'invalid url', url: url || '' }),
    };
  }

  // HTML エンティティをデコード
  function decodeEntities(str) {
    return (str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .trim();
  }

  // メタタグを正規表現で抽出（属性順不同に対応）
  function getMeta(html, ...properties) {
    for (const prop of properties) {
      const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // <meta property="og:title" content="..."> 順
      let m = html.match(
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"'<>]{1,500})["']`, 'i')
      );
      // <meta content="..." property="og:title"> 逆順
      if (!m) m = html.match(
        new RegExp(`<meta[^>]+content=["']([^"'<>]{1,500})["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
      );
      if (m && m[1]) return decodeEntities(m[1]);
    }
    return '';
  }

  // JSON-LD から Product スキーマを探す
  function parseJsonLd(html) {
    const result = { name: '', description: '', image: '', price: '' };
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const raw = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!/product/i.test(item['@type'] || '')) continue;
          result.name = decodeEntities(String(item.name || ''));
          result.description = decodeEntities(String(item.description || '').replace(/<[^>]+>/g, ''));
          result.image = Array.isArray(item.image) ? item.image[0] : (item.image || '');
          if (typeof result.image === 'object') result.image = result.image.url || '';
          const offer = Array.isArray(item.offers) ? item.offers[0] : (item.offers || {});
          if (offer.price) {
            const p = Number(offer.price);
            result.price = isNaN(p) ? String(offer.price) : `¥${p.toLocaleString('ja-JP')}`;
          }
          if (result.name) return result;
        }
      } catch (e) { /* JSON parse failed, skip */ }
    }
    return result;
  }

  // 相対URLを絶対URLに変換
  function toAbsolute(src, base) {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith('//')) return 'https:' + src;
    try {
      return new URL(src, base).href;
    } catch (e) { return ''; }
  }

  try {
    // --- 1. 商品ページを取得 ---
    const pageRes = await fetch(url, {
      headers: {
        // Googlebot UA でアクセス拒否を減らす
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
      redirect: 'follow',
    });

    const html = await pageRes.text();

    // --- 2. JSON-LD を最優先で解析 ---
    const ld = parseJsonLd(html);

    // --- 3. OGタグ / メタタグ でフォールバック ---
    const name = ld.name
      || getMeta(html, 'og:title', 'twitter:title')
      || decodeEntities((html.match(/<title[^>]*>([^<]{1,300})<\/title>/i) || [])[1] || '');

    const description = ld.description
      || getMeta(html, 'og:description', 'twitter:description', 'description');

    let imageUrl = ld.image
      || getMeta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');

    imageUrl = toAbsolute(imageUrl, url);

    const price = ld.price;

    // --- 4. 画像を取得して base64 データURLに変換 ---
    let image = '';
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WalkingAgeTestBot/1.0)',
            'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
            'Referer': url, // Referer を設定してホットリンク対策を回避
          },
          redirect: 'follow',
        });
        const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
        if (imgRes.ok && ct.startsWith('image/')) {
          const buf = await imgRes.arrayBuffer();
          // サイズ制限（3MB超は省略）
          if (buf.byteLength < 3 * 1024 * 1024) {
            image = `data:${ct};base64,${Buffer.from(buf).toString('base64')}`;
          }
        }
      } catch (e) { /* 画像取得失敗は許容 */ }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        name: name.slice(0, 200),
        description: description.replace(/<[^>]+>/g, '').slice(0, 400),
        image,          // base64 data URL または空文字
        imageUrl,       // 元の画像URL（デバッグ用）
        price,
        url,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message, name: '', description: '', image: '', price: '', url }),
    };
  }
};
