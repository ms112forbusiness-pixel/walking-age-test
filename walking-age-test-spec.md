# 歩行年齢テスト計測システム v7 — 仕様書兼設計書

**バージョン:** v7.0
**最終更新:** 2026-03-22
**対象ファイル:** `index.html` / `netlify/functions/proxy.js` / `netlify/functions/shoe-info.js`

---

## 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [データ入力](#3-データ入力)
   - 3.5 [直接計測（DeviceMotion API）](#35-直接計測devicemotion-api)
   - 3.6 [バッチ処理](#36-バッチ処理)
4. [信号処理パイプライン](#4-信号処理パイプライン)
   - 4.4 [倒立振子モデル（Mode A: IP）](#44-倒立振子モデルmode-a-ip)
5. [スコアリング・歩行年齢推定](#5-スコアリング歩行年齢推定)
6. [PDFレポート仕様（最大5ページ構成）](#6-pdfレポート仕様最大5ページ構成)
   - 6.5 [地域在住者向け評価レポート（Page 2）](#65-地域在住者向け評価レポートpage-2)
7. [シューズレコメンド（Page 4）](#7-シューズレコメンドpage-4)
8. [Netlify Functions API](#8-netlify-functions-api)
9. [UI / UX 設計](#9-ui--ux-設計)
10. [デプロイメント環境](#10-デプロイメント環境)
    - 10.4 [計測履歴（IndexedDB）](#104-計測履歴indexeddb)
    - 10.5 [音声フィードバック](#105-音声フィードバック)
11. [規準値テーブル（NORM）](#11-規準値テーブルnorm)
12. [詳細アドバイス機能（ADVICE_DB）](#12-詳細アドバイス機能advice_db)
13. [エビデンス・引用文献](#13-エビデンス引用文献)

---

## 1. システム概要

スマートフォン加速度センサー（phyphox アプリ）で計測した歩行データから、以下を自動生成する Web アプリケーション。

| 出力 | 内容 |
|------|------|
| 歩行年齢 | 加重 Z スコア法による推定年齢 |
| 総合スコア | 0–100 点（加重 Z スコア換算） |
| 臨床リスク評価 | 歩行速度に基づく 4 段階スクリーニング |
| バイオメカニクス指標 | CV / SI / Walk Ratio / 体幹 RMS |
| シューズレコメンド | 歩行プロファイル・性別・個人特性に基づく上位 3 件（任意） |
| PDF レポート | 3 ページ A4（患者向け・専門家向け・靴推薦） |

---

## 2. アーキテクチャ

```
[スマートフォン]
  phyphox アプリ
  （加速度センサー CSV）
       │
       ├─ ファイル選択 / ドラッグ&ドロップ / クリップボード貼付
       └─ WiFi リモート取得（HTTP→Netlify Proxy→HTTPS）
                 │
         [index.html]  ← 単一HTMLファイル
         ┌──────────────────────────────┐
         │  信号処理（PCA + BPF + Peak検出）│
         │  スコアリング（Z スコア）       │
         │  PDF生成（jsPDF + html-to-image）│
         │  シューズレコメンド（14ルール）  │
         └──────────────────────────────┘
               │                  │
     [Netlify Functions]    [Google Sheets CSV]
     ┌───────────────────┐   シューズデータベース
     │ proxy.js          │   （管理者が管理）
     │  ・画像 base64化   │
     │  ・QR コード取得   │
     │  ・phyphox WiFi中継│
     ├───────────────────┤
     │ shoe-info.js      │
     │  ・商品URL→情報抽出│
     │  ・JSON-LD解析     │
     └───────────────────┘
```

### 技術スタック

| カテゴリ | 採用技術 | バージョン |
|----------|----------|------------|
| HTML/CSS/JS | バニラ JS（フレームワークなし） | — |
| スタイリング | TailwindCSS CDN | 3.4.16 |
| アイコン | Lucide | 0.344.0 |
| PDF 生成 | jsPDF | 2.5.1 |
| HTML→画像 | html-to-image | 1.11.11 |
| フォント | Google Fonts（Noto Sans/Serif JP, Inter） | — |
| サーバー | Netlify Functions（Node.js） | — |

---

## 3. データ入力

### 3.1 患者情報フィールド

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `userName` | string | — | 氏名 |
| `gender` | `male` / `female` | ✓ | 性別（計算・シューズマッチングに使用） |
| `age` | number | ✓ | 実年齢（歳、計算に使用） |
| `height` | number | — | 身長（cm、レポート表示のみ） |
| `reportDate` | string | — | 実施日（初期値: 当日） |
| `userId` | string | — | 管理番号（初期値: 自動生成 `2026-W-XXXX`） |
| `evaluator` | string | — | 担当者名 |
| `comment` | string | — | 総評コメント（自動生成・編集可） |

### 3.2 計測値フィールド（手動補正対応）

| フィールド | 単位 | 説明 |
|-----------|------|------|
| `speedVal` | m/s | 歩くスピード（活動量レベル算出にも使用） |
| `strideVal` | m | 歩幅（ステップ長） |
| `cadenceVal` | 歩/分 | ケイデンス |

CSV 読込時は自動計算値で上書きされるが、手動入力で精度補正が可能。

### 3.3 CSV データ入力方法

phyphox「Linear Acceleration（重力除去）」形式を受け付ける。

**必須列:**
```
Time (s), Linear Acceleration x (m/s^2), Linear Acceleration y (m/s^2), Linear Acceleration z (m/s^2)
```

**入力方法（4 種類）:**

| 方法 | 詳細 |
|------|------|
| ファイル選択 | `.csv` ファイルをブラウザで選択 |
| ドラッグ&ドロップ | ブラウザ画面全体にドロップ |
| クリップボード貼付 | `Cmd/Ctrl+V`（入力フィールド外でのみ有効） |
| phyphox WiFi リモート | IP アドレス入力 → `http://<IP>/get?acc_time&accX&accY&accZ` |

Netlify 環境（HTTPS）では WiFi リモート取得を `proxy.js` 経由で中継。

### 3.4 サンプルデータ

18 秒間・100 Hz・歩行周波数 1.8 Hz（108 歩/分）の合成信号を生成。
加速・定常・減速フェーズ付き。デフォルト値: speed=1.18 m/s, stride=0.65 m, cadence=108 歩/分。

### 3.5 直接計測（DeviceMotion API）

スマートフォンブラウザのDeviceMotionEvent APIを使用して加速度を直接計測する。

- HTTPS環境必須（ローカルは除く）
- iOS: `DeviceMotionEvent.requestPermission()` でユーザー許可が必要
- 計測中: リアルタイム波形表示（Canvas）
- 最低15秒で停止可能、停止後に既存パイプライン（`processRawArrays()`）で処理
- 取得データ: t[] / x[] / y[] / z[] 配列

### 3.6 バッチ処理

複数CSVファイル（最大50件）の一括解析機能。

- 対象者情報CSVで個別の氏名・性別・年齢を紐付け可能
- 結果テーブル表示（速度・歩幅・ケイデンス・歩行年齢・総合スコア）
- CSVエクスポート・履歴DB一括保存
- アーキテクチャ: STATE(S)をバックアップ → 各ファイル処理 → S復元

---

## 4. 信号処理パイプライン

```
3 軸加速度 (x, y, z)
      │
      ▼
  PCA（主成分分析）
  → 3 軸を最大分散方向の 1 軸に射影
  → 300 回べき乗法で第 1 主成分ベクトル算出
      │
      ▼
  符号統一
  → 最大絶対値点が正になるよう ±1 反転
      │
      ▼
  バンドパスフィルタ 0.5–6.0 Hz（zero-phase Butterworth 2次）
  ┌── ローパス 6.0 Hz（filtfilt）
  └── ハイパス 0.5 Hz（filtfilt）
      │
      ▼
  ピーク検出
  → 最小間隔: ≥ 300 ms（fs×0.3 サンプル）
  → 動的閾値: 絶対値の 40 パーセンタイル以上
  → 最小距離内は高い方のみ残す
      │
      ▼
  定常区間抽出（Steady-state）
  → 前後 20%（最低 2 ピーク）をトリミング
  → 残りをステップ時間計算に使用
      │
      ▼
  バイオメカニクス指標計算
  → CV, SI, cadence, RMS, mean step time
      │
      ▼
  速度・歩幅の自動推定
  → 速度: 10 m ÷ 全ピーク時間差
  → 歩幅: speed ÷ (cadence / 60)
```

### 4.1 サンプリング周波数推定

連続時刻の中央値差分: `fs = round(1 / median(Δt))`
クランプ範囲: 10–1000 Hz

### 4.2 バンドパスフィルタ設計

2次 Butterworth IIR（bilinear transform）を `filtfilt` で zero-phase 適用。

```
ローパス係数（fc = hi = 6.0 Hz）:
  K = tan(π×fc/fs)
  b = [K²/d, 2K²/d, K²/d]
  a = [1, 2(K²−1)/d, (1−√2K+K²)/d]
  where d = 1 + √2K + K²

ハイパス係数（fc = lo = 0.5 Hz）:
  b = [1/d, −2/d, 1/d]
  a = [1, 2(K²−1)/d, (1−√2K+K²)/d]
```

### 4.3 バイオメカニクス指標

| 指標 | 計算式 | 基準値 | 根拠 |
|------|--------|--------|------|
| Step Time CV | `σ(intervals) / μ(intervals) × 100` | < 4.0 % | Hausdorff 2001 |
| Symmetry Index (SI) | `|μ_odd − μ_even| / μ_all × 100` | < 5.0 % | Robinson 1987 |
| Cadence (from CSV) | `60 / μ(step_time)` | — | — |
| RMS 加速度 | `√(Σy² / n)` 定常区間 | 0.50–2.50 m/s² | Moe-Nilssen 2004 |
| Walk Ratio | `stride / (cadence / 60)` | 0.35–0.45 m/Hz（参考値） | Sekiya 1998 |

### 4.4 倒立振子モデル（Mode A: IP）

身長が入力されている場合、加速度データからステップ長を直接推定する（Zijlstra & Hof 2003）。

```
脚長推定: L = height_cm × 0.53 / 100  [m]

各ステップの鉛直変位算出:
  1. 隣接ピーク間の加速度を抽出
  2. 台形積分 → 速度（線形トレンド除去）
  3. 台形積分 → 変位（線形トレンド除去）
  4. h = max(displacement) − min(displacement)

倒立振子モデル:
  SL = K × 2 × √(2Lh − h²)   K = 1.25（Zijlstra 2003 補正係数）

収束チェック: hCV < 30% かつ 有効ステップ率 > 70%

距離校正（IP+CAL）:
  α = walkDist / Σ(SL)
  |α − 1| ≤ 0.3 → 校正適用 / > 0.3 → 警告フラグ・未適用
```

**モード分岐:**

| 条件 | モード | 速度算出 |
|------|--------|---------|
| 身長あり＋IP収束 | `IP` | mean(SL) × cadence/60 |
| 身長あり＋IP収束＋距離校正 | `IP+CAL` | mean(SL) × α × cadence/60 |
| 身長なし or IP失敗 | `DIST` | 距離 ÷ 定常区間時間 |
| サンプルデータ | `DEMO` | 固定値 |

---

## 5. スコアリング・歩行年齢推定

### 5.1 規準値参照（複数文献による合成規範値テーブル）

性別・実年齢（5 歳刻み 20–90 歳）で `NORM` テーブルを検索し、最近傍年齢の `[μ, σ]` を取得。
出典: Bohannon & Andrews Physiotherapy 2011; Hollman et al. Gait Posture 2011; Mobbs et al. Sensors 2025; Schwesig et al. Gait Posture 2011。
5歳刻みは10歳区間からの線形補間。85・90歳は外挿推定。

### 5.2 Z スコア計算

```
Z = (測定値 − μ) / σ
```

### 5.3 Z スコア → 0–100 点換算

```
score = clamp(round(50 + 20 × Z), 0, 100)
```

（Z = 0 → 50点、Z = +2 → 90点、Z = −2 → 10点）

### 5.4 判定ラベル

| Z スコア | ラベル |
|----------|--------|
| ≥ +1.5 | 優秀 |
| +0.5 ～ +1.5 | 良好 |
| −0.5 ～ +0.5 | 標準 |
| −1.5 ～ −0.5 | やや低下 |
| < −1.5 | 低下 |

### 5.5 総合スコア

```
weightedZ = 0.45 × Z_speed + 0.40 × Z_stride + 0.15 × Z_cadence
totalScore = clamp(round(50 + 20 × weightedZ), 0, 100)
```

重み根拠（Studenski JAMA 2011; Verghese JNNP 2007 ほか）:
速度 45%（最強の予後指標）、歩幅 40%、ケイデンス 15%

### 5.6 歩行年齢推定

NORM テーブルの全年齢（20–90 歳 × 5 歳刻み、85・90歳は外挿推定）に対して加重二乗誤差を計算し、最小年齢を歩行年齢とする。

```
W(age) = 0.45 × Z_speed(age)² + 0.40 × Z_stride(age)² + 0.15 × Z_cadence(age)²
walkingAge = argmin W(age)
```

---

## 6. PDFレポート仕様（最大5ページ構成）

### 6.1 ページ共通

- サイズ: A4 794 × 1123 px（CSS pixels）
- 出力: `jsPDF` + `html-to-image.toJpeg`（quality=0.95, pixelRatio=2）
- ファイル名: `歩行年齢テスト_<氏名>_<実施日>.pdf`

**ページ構成:**

| ページ | 表示条件 | 内容 |
|--------|---------|------|
| Page 1 | 常時 | 受診者向けレポート |
| Page 1.5 | 詳細アドバイス ON | 推奨介入・運動アドバイス（ADVICE_DB 28件から自動選択、最大5件表示） |
| Page 2 | 地域在住向け ON | 地域在住者向け評価レポート（信号機カード・フレイルスクリーニング・歩行の質・介入アドバイス） |
| Page 3 | 臨床向け ON | 臨床向け詳細データ |
| Page 4 | シューズレコメンド ON＋データ読込済 | シューズレコメンド |

### 6.2 Page 1 — 患者向けレポート

| セクション | 内容 |
|-----------|------|
| ヘッダー | ブルーグラデーション背景・タイトル・実施日・ID |
| 患者情報カード | 氏名・性別・実年齢・身長 |
| 歩行年齢（大表示） | 推定歩行年齢（フォントサイズ 100px）・実年齢との差 |
| 総合スコア | 0–100 点・スコアバー・判定バッジ |
| レーダーチャート | スピード・歩幅・テンポ・リズム安定・左右対称（5軸 SVG） |
| 指標リスト | 速度・歩幅・テンポの測定値・スコア・判定 |
| 担当者コメント | 自動生成または手動入力テキスト |
| フッター | バージョン・ページ番号・担当者サイン欄 |

### 6.3 Page 3 — 臨床向け詳細データ

**表示制御:** ヘッダーの「臨床向け」ボタンで ON/OFF 切替。デフォルト非表示。

| セクション | 内容 |
|-----------|------|
| Section 1: 臨床リスク | 4 閾値スクリーニング（0.8 / 1.0 / 1.0 / 1.2 m/s） |
| Section 2: Biomechanics | CV / SI / Walk Ratio / 体幹 RMS（4 列コンパクト） |
| Section 3: Z スコア表 | 速度・歩幅・ケイデンスの基準値・Z・判定 |
| Section 4: 波形 | PCA 加速度プロファイル SVG（ピーク・定常区間表示） |
| 解析基準注記 | 主要エビデンス出典（3 列） |

**臨床リスクスクリーニング閾値:**

| 閾値 | 判定 | 根拠 |
|------|------|------|
| < 0.8 m/s | 転倒・入院リスク要注意 | Fritz S, Lusardi M. J Geriatr Phys Ther 2009; Quach L et al. J Am Geriatr Soc 2011 |
| < 1.0 m/s | サルコペニア・フレイル精査推奨 | AWGS 2019 (Chen 2020) |
| ≥ 1.0 m/s | 屋外自立歩行・社会参加可能 | 道路構造令に基づく歩行者横断速度基準 |
| ≥ 1.2 m/s | 高機能群水準（生命予後良好） | Studenski et al. JAMA 2011 |

### 6.4 Page 4 — シューズレコメンド（任意・ON/OFF切替）

- デフォルト非表示。ヘッダーの「シューズレコメンド」ボタンで ON/OFF。
- 靴データベース（Google Sheets）読込後に表示。
- 詳細は [セクション 7](#7-シューズレコメンドpage-4) 参照。

### 6.5 地域在住者向け評価レポート（Page 2）

**表示制御:** ヘッダーの「地域在住向け」ボタンで ON/OFF 切替。デフォルト非表示。

4セクション構成:

| セクション | 内容 |
|-----------|------|
| Section 1: 転倒・生活機能リスク判定 | 信号機カード3枚（速度・歩幅・転倒リスク閾値） |
| Section 2: フレイル・サルコペニアスクリーニング | AWGS 2019基準（速度・歩幅・握力代理指標） |
| Section 3: 歩行の質 | CV・SI・歩行速度（3枚カード） |
| Section 4: 推奨介入アドバイス | 速度ティア（A/B/C）別エビデンスベース介入提案 |

---

## 7. シューズレコメンド（Page 4）

### 7.1 靴データベース形式

**Google Sheets → ウェブに公開（CSV）**

| 列名 | 型 | 説明 |
|------|-----|------|
| `name` | string | 商品名（メンズ/レディースを含む推奨） |
| `url` | string | 商品ページ URL |
| `image_url` | string | 商品画像 URL |
| `price` | string | 価格（DB保持のみ・カード表示なし） |
| `features` | string | 特徴タグ（`|` 区切り） |
| `description` | string | 商品説明文 |

区切り文字: カンマまたはタブ（自動判定）。UTF-8 BOM 対応。引用符エスケープ対応。

### 7.2 画像取得フロー

```
Netlify 環境: proxy.js?url=<image_url>&type=image → base64 データ URL
GAS 環境: google.script.run.fetchImageAsBase64(url) → base64
ローカル: 直接 URL 表示（CORS で取得失敗の場合は img src のみ）
```

### 7.3 パーソナライズ設問（Q1–Q6）

ユーザーが左パネルで入力する設問（シューズレコメンド ON 時に表示）。

| 設問 | 質問文 | 選択肢 | 対応ロジック |
|------|--------|--------|------------|
| Q1 | O脚・膝の悩みはありますか？ | なし / 軽度 / 強い悩みあり | stability/cushion ボーナス + KNEESUP 専用ボーナス(max 40) |
| Q2 | 使用シーン（防水） | 雨の日でも着用したい | 3段階防水スコア: GORE-TEX(+20) > 合皮(+15) > 一般(+10) |
| Q3 | 足の悩み・特徴 | 特になし / 外反母趾 / 扁平足 / 外反母趾＋扁平足 / 幅広・甲高 | wideWidth/archSupport マッチ, 4E/5E超幅広ボーナス(+20) |
| Q4 | 靴の着脱方法 | こだわらない / 紐靴 / マジックテープ / サイドジッパー | preFilter + スコアリング (velcro→ライフウォーカー限定) |
| Q5 | 主な使用目的 | 自動判定（推奨） / 日常 / ウォーキング / アクティブ | activityLevel のオーバーライド |
| Q6 | 好みのデザインや着用シーン | こだわらない / スポーティ / キレイめ | sportyDesign/smartDesign マッチ(+15/-8) |

### 7.4 歩行プロファイルの構造化評価（`assessWalkingProfile()`）

以下のフィールドを返す。

| フィールド | 元データ | 説明 |
|-----------|---------|------|
| `sp` | `S.speedVal` | 歩行速度 (m/s) |
| `st` | `S.strideVal` | 歩幅 (m) |
| `ca` | `S.cadenceVal` | ケイデンス (歩/分) |
| `spZ`, `stZ`, `caZ` | 計算済み Z スコア | 各指標の標準化値 |
| `cv`, `si`, `wr`, `rms` | CSV 解析結果 | バイオメカニクス指標 |
| `age`, `walkingAge` | 入力・計算値 | 実年齢・歩行年齢 |
| `knee` | Q1 | `'none'` / `'mild'` / `'severe'` |
| `rain` | Q2 | boolean |
| `foot` | Q3 | `'none'` / `'bunion'` / `'flat'` / `'both'` / `'wide'` |
| `fasten` | Q4 | `'any'` / `'lace'` / `'velcro'` / `'zipper'` |
| `purpose` | Q5 | `'auto'` / `'daily'` / `'walking'` / `'active'` |
| `design` | Q6 | `'any'` / `'sporty'` / `'smart'` |
| `gender` | `S.gender` | 性別（メンズ/レディースモデルマッチに使用） |
| `activityLevel` | Q5 or 速度から算出 | 下表参照 |

**活動量レベル（`activityLevel`）算出:**

Q5 で明示的に目的を選択した場合、速度判定よりもユーザー選択を優先する。

| Q5 選択 | activityLevel | 条件 |
|---------|--------------|------|
| `daily` | `low` | ユーザー明示選択 |
| `walking` | `moderate` | ユーザー明示選択 |
| `active` | `high` | ユーザー明示選択 |
| `auto` | 速度から算出 | < 0.8: verylow / 0.8–1.0: low / 1.0–1.2: moderate / ≥ 1.2: high |

### 7.5 シューズ分類エンジン（`classifyShoe()` + `SHOE_KMAP`）

商品テキスト（name + description + features）に対してキーワードマッチで構造化属性を生成。

**出力:** `{ activityLevel, gender, flags: { stability, cushion, wideWidth, archSupport, waterproof, easyOn, rocker, lightweight, lace, sportyDesign, smartDesign, antiTrip, odorControl } }`

活動量互換性は `ACT_COMPAT` マトリクス（4×4、0–100%）で評価。
シリーズ判定は `SERIES_KMAP` で8シリーズ（ridewalk, fieldwalker, fastwalk, lasiro, hadashi, funwalker, lifewalk, kneesup）を自動検出。

### 7.6 事前フィルタリング（`preFilterShoes()`）

| ルール | 条件 | 動作 |
|--------|------|------|
| 速度フィルタ | 歩行速度 ≤ 0.9 m/s | ライフウォーカーのみ |
| マジックテープ | Q4 = `velcro` | ライフウォーカーのみ |
| ジッパー | Q4 = `zipper` | テキストに「ジッパー/ファスナー」含む靴のみ |
| 紐靴 | Q4 = `lace` | lace フラグ有り or easyOn/ジッパー無しの靴 |

### 7.7 多次元スコアリング（`scoreShoeV2()` — 8次元）

| 次元 | 内容 | 最大スコア |
|------|------|-----------|
| 1. 性別マッチ | 一致 +20 / ユニセックス +5 / 不一致 −30 | 20 |
| 2. 活動量互換 | ACT_COMPAT マトリクスから算出 | 20 |
| 3. 歩行速度 | 速度帯別に stability/cushion/rocker/lightweight をマッチ | 28 |
| 4. バイオメカニクス | CV/SI 閾値超過時に stability/archSupport をマッチ | 10 |
| 5. 設問ニーズ | Q1膝(23) + Q2防水(20) + Q3足(20) + Q4着脱(15) + Q6デザイン(15) | ~83 |
| 6. 年齢ADL | 75+ easyOn(5)+wideWidth(3) / 65+ wideWidth(3) | 8 |
| 7. シリーズ適合 | 速度帯適合(8) + 活動量適合(7) | 15 |
| 8. KNEESUP専用 | severe +40 / mild +25 | 40 |

**正規化:** `dynamicMax`（ユーザーの条件に関係する項目の理論上最大値のみを分母にする）で正規化スコア（内部値）を算出。

### 7.8 歩行プロファイルサマリーバッジ

Page 4 上部に表示されるプロファイルサマリーのバッジ一覧。

| バッジ種別 | 表示条件 | 内容 |
|-----------|---------|------|
| ♂ メンズ / ♀ レディース | 常時 | 対象者の性別 |
| 🦵 O脚・強 / 膝悩み | Q1 選択時 | 膝の悩みレベル |
| 🌧 防水 | Q2 選択時 | 雨天対応希望 |
| 👟 外反母趾 / 扁平足 / 外反+扁平 / 幅広/甲高 | Q3 選択時 | 足の悩み |
| 🔒 マジックテープ / サイドジッパー / 紐靴 | Q4 でany以外を選択時 | 着脱方法希望 |
| 🎯 日常・買物 / ウォーキング / アクティブ | Q5 でauto以外を選択時 | 使用目的 |
| 👟 スポーティ / 👔 キレイめ | Q6 でany以外を選択時 | デザイン希望 |
| ⚡ 活動量：低〜高 | 速度データあり | 歩行速度から算出した活動量レベル |

推奨特性バッジ: ポジティブ要件（ユーザーに一致する推奨特性）のみを表示。

---

## 8. Netlify Functions API

### 8.1 `proxy.js` — CORS プロキシ

**エンドポイント:** `/.netlify/functions/proxy`

**パラメータ:**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `url` | string（必須） | プロキシ対象 URL |
| `type` | `image`（省略可） | 指定時は base64 データ URL を返す |

**許可ドメイン（SSRF 対策）:**
```
api.qrserver.com       # QRコード生成
walking.asics.com      # ASICS ウォーキング商品
images.asics.com       # ASICS 画像 CDN
www.asics.com
shop.asics.com
```

**レスポンス:**
- HTML モード: `text/plain` でページ HTML をそのまま返却
- 画像モード: `text/plain` で base64 データ URL を返却（`data:<mime>;base64,...`）

**用途:**
- phyphox WiFi リモートデータ取得の HTTPS→HTTP 中継
- ASICS 商品画像の base64 化
- QR コード画像の base64 化

### 8.2 `shoe-info.js` — 商品情報抽出

**エンドポイント:** `/.netlify/functions/shoe-info`

**パラメータ:** `url`（商品ページ URL）

**処理フロー:**
1. 商品ページ HTML を Googlebot UA で fetch
2. JSON-LD (`application/ld+json`) から Product スキーマを優先抽出
3. OG タグ / meta タグでフォールバック（name, description, image, price）
4. HTML 全文（最大 100 KB）から靴特徴キーワードを抽出（28 ルール）
5. 画像 URL を absolute URL に変換 → base64 化（3 MB 未満）

**レスポンス JSON:**
```json
{
  "name": "商品名",
  "description": "説明文（最大 400 文字）",
  "image": "data:image/jpeg;base64,...",
  "imageUrl": "https://...",
  "price": "¥17,600",
  "features": ["GEL", "安定性", "幅広", ...],
  "url": "元のURL"
}
```

**特徴キーワード抽出ルール（28 件）:** fuzeGEL, GEL, FlyteFoam, Boost, React, Nike Air, クッション, 衝撃吸収, 安定性, ガイドレール, モーションコントロール, グルーヴ設計, トラスティック, アーチサポート, インソール, OrthoLite, 4E幅, 3E幅, 2E幅, 幅広, ロッカー, 屈曲性, 推進補助, 前傾設計, 軽量, GORE-TEX, 防水, 通気, 反発, サイドジッパー, ベルクロ, BOAフィット, シニア向け, ウォーキング, トレイル

### 8.3 `netlify.toml`

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
```

---

## 9. UI / UX 設計

### 9.1 レイアウト

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header（固定）                                                         │
│ タイトル ／ 地域在住向け ／ 臨床向け ／ シューズ ／ 詳細アドバイス ／ 印刷 │
├──────────────────┬───────────────────────────────────────────────────┤
│ Left Pane（400px）│ Right Pane（flex-1）                               │
│ ・対象者情報      │ ズームコントロール（フローティング）                  │
│ ・CSV読み込み     │                                                    │
│ ・phyphox WiFi   │ ┌───────────────────────────────────────────┐     │
│ ・測定値調整      │ │ Page 1（A4）患者向け（常時表示）            │     │
│ ・コメント・担当者│ ├───────────────────────────────────────────┤     │
│ ・靴DB（ON時のみ）│ │ Page 1.5（A4）詳細アドバイス ※ON時        │     │
│   ・Q1–Q6 設問   │ ├───────────────────────────────────────────┤     │
│ ・アドバイスリスト│ │ Page 2（A4）地域在住向け ※地域ON時         │     │
│   （ON時のみ）   │ ├───────────────────────────────────────────┤     │
│                  │ │ Page 3（A4）臨床向け ※臨床ON時            │     │
│                  │ ├───────────────────────────────────────────┤     │
│                  │ │ Page 4（A4）靴 ※シューズON時              │     │
│                  │ └───────────────────────────────────────────┘     │
└──────────────────┴───────────────────────────────────────────────────┘
```

### 9.2 ヘッダーボタン

| ボタン | ID | 機能 |
|--------|----|------|
| 地域在住向け | `btn-community-mode` | Page 2 表示/非表示 |
| 臨床向け | `btn-clinical-mode` | Page 3 表示/非表示 |
| シューズレコメンド | `btn-shoe-mode` | Page 4 + 靴DB欄 表示/非表示 |
| 詳細アドバイス | `btn-advice-mode` | Page 1.5 + アドバイス入力欄 表示/非表示 |
| ガイド | `btn-guide` | 計測ガイドモーダル表示 |
| 音声 | `btn-voice` | 音声フィードバック ON/OFF |
| 印刷 | `btn-print` | window.print() |
| 共有 | `btn-share` | PDF→Web Share API |
| PDF出力 | `btn-download` | PDF→ダウンロード + 履歴自動保存 |

各モードボタン: デフォルト OFF。ON 時に対応ページ・入力欄が表示される。

### 9.3 モバイル対応

- `max-width: 767px` で Left Pane がドロワー式（`transform: translateX(-100%)`）に変化
- ハンバーガーボタンでトグル、バックドロップタップで閉じる
- ズームは「画面に合わせる」ボタンで自動調整

### 9.4 ズームコントロール

- フローティングボタン（縮小 / フィット / 拡大）
- スケール範囲: 0.3×–2.5×
- フィット計算: `min(1, (rightPane.clientWidth − 64) / 794)`

### 9.5 レーダーチャート（SVG）

5 軸: スピード・歩幅・テンポ・リズム安定・左右対称
- リズム安定 = `max(0, min(1, (8 − CV) / 8))`
- 左右対称 = `max(0, min(1, (10 − SI) / 10))`
- CSV 未読込時はリズム安定・左右対称を 0.5 で表示

### 9.6 波形表示（SVG）

- 最大 1500 点にダウンサンプル
- 定常区間を薄青帯で強調
- ピーク: 定常=青（r=4）、非定常=グレー（r=2.5）
- X 軸ラベル: 8 等分時刻

### 9.7 通知

- 画面上部フローティングトースト（3 秒で消える）
- 成功: ダークスレート背景 / エラー: 赤背景

---

## 10. デプロイメント環境

### 10.1 環境判定ロジック

```javascript
const IS_GAS     = typeof google !== 'undefined' && !!google.script;
const IS_NETLIFY = !IS_GAS && location.protocol === 'https:' && location.hostname !== '';
```

| 環境 | 特徴 |
|------|------|
| Google Apps Script (GAS) | `google.script.run` で画像取得・CSV 取得 |
| Netlify（本番） | `/.netlify/functions/proxy` 経由で画像・WiFi データ取得 |
| ローカル（file:// / http://） | 直接 fetch（CORS 制限あり） |

### 10.2 スプレッドシート URL の保存

選択したシート URL を `localStorage` に保存し、次回起動時に自動復元。
キー: `walkingAgeShoeSheetUrl`

### 10.4 計測履歴（IndexedDB）

| 項目 | 内容 |
|------|------|
| DB名 | `WalkingAgeHistoryDB` |
| ストア | `results` |
| インデックス | userId, userName, timestamp |

`saveResult()` で計測結果を自動保存。モーダルUIで一覧表示・個別削除・CSVエクスポートが可能。

### 10.5 音声フィードバック

Web Speech Synthesis APIを使用。localStorage キー `walkingAgeVoiceEnabled` で ON/OFF を永続化。
データ読込完了時・直接計測時に結果を自動読み上げ。

### 10.3 GAS 連携（別途管理）

GAS 側で実装が必要な関数:
- `fetchCsvData(url)` — CSV テキストを返す
- `fetchImageAsBase64(url)` — base64 データ URL を返す

---

## 11. 規準値テーブル（NORM）

出典: 複数文献による合成規範値（Bohannon & Andrews Physiotherapy 2011; Hollman et al. Gait Posture 2011; Mobbs et al. Sensors 2025 N=280; Schwesig et al. Gait Posture 2011 N=1,860）
注: 5歳刻みは10歳区間からの線形補間。85・90歳は外挿推定。腰部装着・10m歩行では一定のバイアスあり。

### 男性 `[speed_μ, speed_σ, stride_μ, stride_σ, cadence_μ, cadence_σ]`

| 年齢 | 速度 μ | 速度 σ | 歩幅 μ | 歩幅 σ | テンポ μ | テンポ σ |
|------|--------|--------|--------|--------|---------|---------|
| 20 | 1.48 | 0.19 | 0.82 | 0.10 | 108 | 8 |
| 25 | 1.47 | 0.18 | 0.81 | 0.10 | 109 | 8 |
| 30 | 1.46 | 0.18 | 0.80 | 0.09 | 110 | 8 |
| 35 | 1.44 | 0.18 | 0.79 | 0.09 | 110 | 8 |
| 40 | 1.42 | 0.18 | 0.77 | 0.09 | 110 | 9 |
| 45 | 1.39 | 0.19 | 0.75 | 0.10 | 110 | 9 |
| 50 | 1.35 | 0.20 | 0.73 | 0.10 | 110 | 9 |
| 55 | 1.30 | 0.21 | 0.70 | 0.11 | 109 | 9 |
| 60 | 1.24 | 0.22 | 0.67 | 0.11 | 109 | 10 |
| 65 | 1.17 | 0.23 | 0.64 | 0.12 | 108 | 10 |
| 70 | 1.09 | 0.24 | 0.60 | 0.12 | 107 | 11 |
| 75 | 1.01 | 0.25 | 0.56 | 0.13 | 106 | 11 |
| 80 | 0.91 | 0.26 | 0.51 | 0.14 | 104 | 12 |
| 85 | 0.82 | 0.27 | 0.46 | 0.15 | 102 | 13 |
| 90 | 0.73 | 0.28 | 0.41 | 0.16 | 100 | 14 |

### 女性 `[speed_μ, speed_σ, stride_μ, stride_σ, cadence_μ, cadence_σ]`

| 年齢 | 速度 μ | 速度 σ | 歩幅 μ | 歩幅 σ | テンポ μ | テンポ σ |
|------|--------|--------|--------|--------|---------|---------|
| 20 | 1.40 | 0.17 | 0.73 | 0.09 | 115 | 9 |
| 25 | 1.39 | 0.17 | 0.72 | 0.09 | 116 | 9 |
| 30 | 1.37 | 0.17 | 0.71 | 0.09 | 116 | 9 |
| 35 | 1.35 | 0.17 | 0.70 | 0.09 | 117 | 9 |
| 40 | 1.33 | 0.18 | 0.68 | 0.09 | 117 | 9 |
| 45 | 1.30 | 0.19 | 0.66 | 0.10 | 118 | 10 |
| 50 | 1.25 | 0.20 | 0.63 | 0.10 | 118 | 10 |
| 55 | 1.20 | 0.21 | 0.60 | 0.11 | 118 | 10 |
| 60 | 1.14 | 0.22 | 0.57 | 0.11 | 118 | 11 |
| 65 | 1.07 | 0.23 | 0.54 | 0.12 | 118 | 11 |
| 70 | 0.99 | 0.24 | 0.50 | 0.12 | 118 | 12 |
| 75 | 0.90 | 0.25 | 0.46 | 0.13 | 117 | 12 |
| 80 | 0.81 | 0.26 | 0.41 | 0.14 | 115 | 13 |
| 85 | 0.72 | 0.27 | 0.37 | 0.15 | 113 | 14 |
| 90 | 0.63 | 0.28 | 0.33 | 0.16 | 111 | 15 |

---

## 12. 詳細アドバイス機能（ADVICE_DB）

28件のエビデンスベース運動アドバイスDB。5カテゴリで構成:

| カテゴリ | 内容 |
|---------|------|
| BALANCE | バランス訓練（片脚立ち、タンデム歩行等） |
| STRENGTH | 筋力強化（大腿四頭筋、股関節屈筋、体幹） |
| ENDURANCE | 持久力向上（有酸素、歩行継続時間） |
| GAIT_QUALITY | 歩行パターン改善（歩幅拡大、リズム訓練） |
| FLEXIBILITY | 柔軟性改善（ストレッチ、可動域） |

`assessInterventionProfile()` で歩行プロファイルから条件フラグを生成。
`selectAdvice()` で最大5件を自動選択。左パネルのチェックリストで手動調整可能。
`isAdviceEdited` フラグで自動/手動を管理（手動編集後は自動上書きをスキップ）。

---

## 13. エビデンス・引用文献

| 略称 | 文献 | 用途 |
|------|------|------|
| Mobbs 2025 | Mobbs et al. *Sensors* 2025;25:581 (N=313) | 規準値テーブル（速度・歩幅・ケイデンス） |
| Fritz 2009 | Fritz S, Lusardi M. *Phys Ther J* 2009 | 速度 0.8 m/s 転倒リスク閾値・歩行年齢重み |
| AWGS 2019 | Chen LK et al. *J Am Med Dir Assoc* 2020;21(3):300-307 | 速度 1.0 m/s サルコペニアスクリーニング |
| AWGS 2025 | Nature Aging 2025, PMID:41188603 | 速度の予後指標としての再定義 |
| Studenski 2011 | Studenski S et al. *JAMA* 2011;305(1):50-58 (N=34,485, Level I-II) | 速度 1.2 m/s 高機能群・生命予後 |
| Quach 2011 | Quach L et al. *J Am Geriatr Soc* 2011;59(6):1069-1073 | 低歩行速度と転倒リスクの非線形関係 |
| Cesari 2005 | Cesari M et al. *J Gerontol A* 2005 | 地域在住高齢者の生活機能分類 |
| Hausdorff 2001 | Hausdorff JM et al. *Arch Phys Med Rehabil* 2001;82(8):1050-1056 (前向きコホート, Level II) | CV > 4% 転倒リスク |
| Beauchet 2003 | Beauchet O et al. 2003 | CV 4–8% 注意域 |
| BMC Geriatrics 2022 | BMC Geriatrics アンブレラレビュー 2022 | Step Time CV のアンブレラエビデンス |
| Robinson 1987 | Robinson et al. *J Manipulative Physiol Ther* 1987;10(4):172-176 | Symmetry Index (SI) 計算式の原典 |
| Patterson 2010 | Patterson KK et al. *Gait Posture* 2010 | SI 5% / 10% 判定閾値 |
| Sekiya 1998 | Sekiya N, Nagasaki H. *Gait Posture* 1998 | Walk Ratio 0.38–0.42 m/Hz 不変性 |
| Plotnik 2011 | Plotnik M et al. *J Neurol Sci* 2011 | Walk Ratio 神経疾患との関連 |
| Moe-Nilssen 2004 | Moe-Nilssen R, Helbostad JL. *J Biomech* 2004 | 体幹 RMS 加速度の方法論 |
| Tao 2012 | Tao W et al. *Sensors* 2012;12(2):2255-2283 | 慣性センサー歩行計測のレビュー |

---

*このドキュメントは `index.html`（v7.0）の実装コードを直接読み取り生成しました。*
*最終更新: 2026-03-22*
