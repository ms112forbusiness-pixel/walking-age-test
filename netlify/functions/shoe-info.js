// Netlify Function: shoe-info
// 商品URLから商品名・説明・画像(base64)・価格・構造化フィーチャーを取得してJSONで返す
// サーバーサイドで完結するためCORS・Mixed Content問題を完全回避

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

  // ── HTML エンティティをデコード ────────────────────────────────
  function decodeEntities(str) {
    return (str || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g,  (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .trim();
  }

  // ── メタタグを正規表現で抽出（属性順不同に対応）────────────────
  function getMeta(html, ...properties) {
    for (const prop of properties) {
      const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let m = html.match(new RegExp(
        `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"'<>]{1,500})["']`, 'i'));
      if (!m) m = html.match(new RegExp(
        `<meta[^>]+content=["']([^"'<>]{1,500})["'][^>]+(?:property|name)=["']${esc}["']`, 'i'));
      if (m && m[1]) return decodeEntities(m[1]);
    }
    return '';
  }

  // ── JSON-LD から Product スキーマを探す ────────────────────────
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
          result.name        = decodeEntities(String(item.name || ''));
          result.description = decodeEntities(String(item.description || '').replace(/<[^>]+>/g, ''));
          result.image       = Array.isArray(item.image) ? item.image[0] : (item.image || '');
          if (typeof result.image === 'object') result.image = result.image.url || '';
          const offer = Array.isArray(item.offers) ? item.offers[0] : (item.offers || {});
          if (offer.price) {
            const p = Number(offer.price);
            result.price = isNaN(p) ? String(offer.price) : `¥${p.toLocaleString('ja-JP')}`;
          }
          if (result.name) return result;
        }
      } catch (e) { /* JSON parse failed */ }
    }
    return result;
  }

  // ── 靴の構造化特徴キーワード抽出 ─────────────────────────────
  // テキスト全体から技術名・機能・フィット特性をラベル化して返す
  function extractFeatures(text) {
    const features = new Set();
    const rules = [
      // GEL 系クッション
      [/fuzeGEL|FUZEGEL/i,                   'fuzeGEL'],
      [/\bGEL[\-\s]?\w*/i,                   'GEL'],
      [/FlyteFoam|FLYTEFOAM/i,               'FlyteFoam'],
      [/\bBoost\b/i,                          'Boost'],
      [/\bReact\b/i,                          'React'],
      [/ZOOM|Air\s*Max|AirMax/i,             'Nike Air'],
      [/クッション|cushion/i,                 'クッション'],
      [/衝撃吸収|衝撃緩和|shock\s*absorb/i,  '衝撃吸収'],
      // 安定性・制御
      [/安定性|Stability|STABILITY/i,        '安定性'],
      [/GUIDE\s*RAILS|ガイドレール/i,         'ガイドレール'],
      [/モーションコントロール|Motion\s*Control/i, 'モーションコントロール'],
      [/グルーヴ|Groove|溝設計/i,            'グルーヴ設計'],
      [/TRUSSTIC|トラスティック/i,            'トラスティック'],
      // アーチ・インソール
      [/アーチサポート|アーチ\s*サポート|Arch\s*Support/i, 'アーチサポート'],
      [/インソール|中敷|Insole/i,             'インソール'],
      [/オーソライト|OrthoLite/i,             'OrthoLite'],
      // 幅・フィット
      [/4E幅|4E相当|\b4E\b/i,               '4E幅'],
      [/3E幅|3E相当|\b3E\b/i,               '3E幅'],
      [/2E幅|\b2E\b/i,                       '2E幅'],
      [/幅広|ワイド|Wide\s*Width|extra.wide/i, '幅広'],
      // 推進・屈曲
      [/ロッカー|Rocker\s*Bottom|rocker/i,   'ロッカー'],
      [/屈曲性|フレックス|Flex(?:ible)?/i,   '屈曲性'],
      [/推進|propulsion/i,                   '推進補助'],
      [/前傾|forefoot/i,                     '前傾設計'],
      // 軽量
      [/軽量|Light\s*Weight|Lightweight/i,   '軽量'],
      // 防水・通気
      [/GORE[\s\-]?TEX|ゴアテックス/i,       'GORE-TEX'],
      [/防水|Waterproof/i,                   '防水'],
      [/通気|Breathable|メッシュ|Mesh/i,     '通気'],
      // 反発
      [/反発|Energy\s*Return/i,              '反発'],
      // 着脱・機構
      [/サイドジッパー|側面ファスナー|Side\s*Zip/i, 'サイドジッパー'],
      [/マジックテープ|ベルクロ|Velcro/i,    'ベルクロ'],
      [/\bBOA\b|ダイヤルクロージャー|BOAフィット/i, 'BOAフィット'],
      // シニア
      [/シニア|高齢者|Senior/i,              'シニア向け'],
      // カテゴリ
      [/ウォーキング|Walking/i,              'ウォーキング'],
      [/トレイル|Trail/i,                    'トレイル'],
    ];
    rules.forEach(([re, label]) => { if (re.test(text)) features.add(label); });
    return Array.from(features);
  }

  // ── 相対URLを絶対URLに変換 ────────────────────────────────────
  function toAbsolute(src, base) {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith('//')) return 'https:' + src;
    try { return new URL(src, base).href; } catch (e) { return ''; }
  }

  try {
    // ── 1. 商品ページを取得 ──────────────────────────────────────
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
      redirect: 'follow',
    });
    const html = await pageRes.text();

    // ── 2. JSON-LD 最優先 ────────────────────────────────────────
    const ld = parseJsonLd(html);

    // ── 3. OGタグ / メタタグ フォールバック ─────────────────────
    const name = ld.name
      || getMeta(html, 'og:title', 'twitter:title')
      || decodeEntities((html.match(/<title[^>]*>([^<]{1,300})<\/title>/i) || [])[1] || '');

    const description = ld.description
      || getMeta(html, 'og:description', 'twitter:description', 'description');

    let imageUrl = ld.image
      || getMeta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
    imageUrl = toAbsolute(imageUrl, url);

    const price = ld.price;

    // ── 4. 特徴キーワード抽出（名前・説明文・HTML全体から） ───────
    // HTML全体のテキスト部分から特徴を抽出（最大100KB）
    const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100000);
    const features = extractFeatures(name + ' ' + description + ' ' + bodyText);

    // ── 5. 画像を取得して base64 データURLに変換 ─────────────────
    let image = '';
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WalkingAgeTestBot/1.0)',
            'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
            'Referer': url,
          },
          redirect: 'follow',
        });
        const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
        if (imgRes.ok && ct.startsWith('image/')) {
          const buf = await imgRes.arrayBuffer();
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
        name:        name.slice(0, 200),
        description: description.replace(/<[^>]+>/g, '').slice(0, 400),
        image,
        imageUrl,
        price,
        features,   // 構造化特徴キーワード配列
        url,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message, name: '', description: '', image: '', features: [], price: '', url }),
    };
  }
};
