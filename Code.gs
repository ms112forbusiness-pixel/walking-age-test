// ============================================================
// 歩行年齢テスト診断システム v6 — Google Apps Script サーバー側コード
// ============================================================
// 【デプロイ手順】
//   1. このファイル(Code.gs)をApps Scriptプロジェクトに貼付
//   2. index.html ファイルを作成し、walking_age_test_index.html の内容を貼付
//   3. デプロイ → 新しいデプロイ → 種類:ウェブアプリ
//      実行するユーザー: 自分　アクセスできるユーザー: 全員
//   4. 発行されたURLを共有するだけ
// ============================================================

// HTMLページを配信
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('歩行年齢テスト診断システム v6')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- GoogleスプレッドシートCSVを取得 ----
// クライアント側から google.script.run.fetchCsvData(url) で呼び出す
function fetchCsvData(url) {
  if (!url || !/^https:\/\/docs\.google\.com\//.test(url)) {
    throw new Error('Google SpreadsheetのURLのみ使用できます');
  }
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('HTTP ' + res.getResponseCode() + ' — スプレッドシートを「ウェブに公開」してください');
    }
    return res.getContentText('UTF-8');
  } catch (e) {
    throw new Error(e.message || 'スプレッドシートの読み込みに失敗しました');
  }
}

// ---- 画像URLをbase64データURLに変換 ----
// クライアント側から google.script.run.fetchImageAsBase64(url) で呼び出す
const ALLOWED_IMAGE_DOMAINS = [
  'walking.asics.com',
  'images.asics.com',
  'www.asics.com',
  'shop.asics.com',
  'api.qrserver.com',
];

function fetchImageAsBase64(url) {
  if (!url) return '';
  let host;
  try { host = new URL(url).hostname; } catch (e) { throw new Error('無効なURL: ' + url); }

  if (!ALLOWED_IMAGE_DOMAINS.some(d => host === d || host.endsWith('.' + d))) {
    throw new Error('許可されていないドメイン: ' + host);
  }
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const blob = res.getBlob();
    const mimeType = blob.getContentType() || 'image/jpeg';
    return 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    throw new Error('画像の取得に失敗しました: ' + e.message);
  }
}
