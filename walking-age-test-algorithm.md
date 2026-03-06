# 歩行年齢テスト診断システム
## 評価指標アルゴリズム リファレンス

**対象**: `walking-age-test.html` の解析・スコアリング・判定ロジック
**作成日**: 2026-03-04

---

## 1. 信号処理パイプライン

### 1.1 入力フォーマット

phyphox「Linear Acceleration」エクスポート CSV

```
列: Time (s), Linear Acceleration x (m/s²), y (m/s²), z (m/s²)
```

- ヘッダー行を先頭5行から自動検出（正規表現マッピング）
- 有効データ点 < 50 の場合はエラー
- サンプリング周波数 `fs`: 連続時刻差の**中央値**から推定、10–1000 Hz にクランプ

---

### 1.2 主成分分析 PCA（装着向き非依存化）

```
入力: xs[], ys[], zs[]  (3軸加速度、各 N 点)

1. 平均除去
   mx = mean(xs),  ux[i] = xs[i] - mx  (y, z も同様)

2. 共分散行列 C (3×3)
   C[i][j] = Σ u_i[k] × u_j[k] / N   (i, j ∈ {x, y, z})

3. 第1主成分ベクトル: べき乗法 300反復
   v = [1, 0, 0]
   repeat 300:
     v = C × v
     v = v / |v|

4. 射影（スカラー時系列）
   signal[k] = ux[k]×v[0] + uy[k]×v[1] + uz[k]×v[2]
```

> スマートフォンの装着向きに依存せず、最大分散方向（歩行主軸）を自動抽出する。

---

### 1.3 バンドパスフィルタ（2次 Butterworth、ゼロ位相）

```
通過帯域: 0.7 – 6.0 Hz
フィルタ次数: 2
設計方法: バイリニア変換

カットオフ正規化:
  f_low  = 0.7 / (fs/2)
  f_high = 6.0 / (fs/2)

ゼロ位相処理: 順方向フィルタ → 逆順フィルタ（filtfilt 等価）
```

**設計根拠**: 成人歩行ケイデンス 50–180 歩/分（0.83–3.0 Hz）。高調波成分を含むため上限 6 Hz。

---

### 1.4 ピーク検出（動的閾値）

```
最小間隔: max(1, floor(fs × 0.3))  サンプル  [= 300 ms 相当]
動的閾値: abs(signal) の 40パーセンタイル

アルゴリズム:
  1. 全極大値を検出（前後隣接サンプルより大きい点）
  2. 振幅 ≥ 動的閾値 の極大値のみ保持
  3. 最小間隔内の競合は振幅最大のピークを採用
```

---

### 1.5 定常区間抽出

```
trim = max(2, floor(peaks.length × 0.2))

steadyPeaks = peaks.slice(trim, peaks.length - trim)

フォールバック（peaks.length ≤ 4 の場合）:
  steadyPeaks = peaks.slice(1, -1)
```

> 加速・減速相（両端 20%）を除去し、定常歩行区間のみで評価する。

---

## 2. バイオメカニクス指標

### 2.1 Step Time 変動係数（CV）

```
対象: 定常区間の連続ピーク間隔時系列 Δt[i] = t[i+1] - t[i]

Mean = Σ Δt[i] / n
SD   = √( Σ(Δt[i] - Mean)² / n )
CV   = SD / Mean × 100  [%]
```

#### 判定グレード

| グレード | 閾値 | 臨床的意義 |
|---------|------|-----------|
| 優良 | < 2.0 % | 非常に規則的。神経筋制御が良好。 |
| 正常 | 2.0–4.0 % | 正常範囲内のリズム変動 |
| 注意 | 4.0–8.0 % | 恐怖性歩行・軽度認知障害・神経疾患の影響を検討 |
| 要精査 | ≥ 8.0 % | 高度の不規則歩行。多職種評価を推奨。 |

**根拠**: Hausdorff et al. Arch Phys Med Rehabil 2001（前向きコホート, Level II）; BMC Geriatrics 2022 アンブレラレビュー

---

### 2.2 対称性指標（Symmetry Index, SI）

```
OddMean  = mean( Δt[奇数インデックス] )
EvenMean = mean( Δt[偶数インデックス] )
Overall  = mean( Δt[全て] )

SI = |OddMean - EvenMean| / Overall × 100  [%]
```

> Robinson 1987 式。奇数・偶数ステップ交互の時間差で左右非対称性を評価。

#### 判定グレード

| グレード | 閾値 | 臨床的意義 |
|---------|------|-----------|
| 優良 | < 3.0 % | 非常に良好な左右対称性 |
| 正常 | 3.0–5.0 % | 正常範囲の左右差 |
| 注意 | 5.0–10.0 % | 跛行・整形外科疾患・片麻痺の可能性 |
| 要精査 | ≥ 10.0 % | 顕著な左右非対称。筋骨格・神経系疾患を疑う。 |

**根拠**: Robinson et al. Dev Med Child Neurol 1987（原典）; Patterson et al. Gait Posture 2010

---

### 2.3 Walk Ratio（歩行比）

```
Walk Ratio = Step Length [m] / Step Frequency [Hz]
           = strideVal / (cadenceVal / 60)
単位: m/Hz
```

#### 判定グレード

| グレード | 閾値 | 臨床的意義 |
|---------|------|-----------|
| 正常 | 0.38–0.42 m/Hz | 中枢神経による効率的な歩行制御 |
| 注意（低値） | 0.30–0.38 m/Hz | 神経疾患・恐怖性歩行・廃用症候群の可能性 |
| 注意（高値） | 0.42–0.48 m/Hz | 代償的大股歩き・筋力低下の可能性 |
| 要精査（低値） | < 0.30 m/Hz | パーキンソン病様の小刻み歩行パターン |
| 要精査（高値） | > 0.48 m/Hz | 高度の代償歩行 |

> 実装上の判定: `|WR - 0.40| ≤ 0.02` → 正常 / `≤ 0.08` → 注意 / `> 0.08` → 要精査

**根拠**: Sekiya & Nagasaki, Gait Posture 1998（不変性の実証）; Plotnik et al. J Neurol Sci 2011

---

### 2.4 RMS 加速度（体幹動揺強度）

```
算出区間: 定常ピーク最初〜最後の全サンプル

RMS = √( Σ signal[k]² / N )  [m/s²]
```

#### 判定グレード

| グレード | 閾値 | 臨床的意義 |
|---------|------|-----------|
| 正常 | 0.50–2.50 m/s² | 良好な衝撃吸収能・体幹安定性 |
| 注意（低値） | < 0.50 m/s² | すり足・廃用・疼痛回避歩行 |
| 注意（高値） | > 2.50 m/s² | 体幹動揺大・バランス障害・関節疾患の疑い |

**根拠**: Moe-Nilssen & Helbostad, J Biomech 2004; Tao et al. IEEE Trans Biomed Eng 2012

---

## 3. 歩行速度・歩幅・ケイデンスの算出

```
計測距離: D = 10.0 m（固定）

歩行速度 [m/s]:
  T = t[steadyPeaks.last] - t[steadyPeaks.first]  （定常区間経過時間）
  speed = D / T

ステップ数 n = steadyPeaks.length - 1
平均ステップ時間 meanST = T / n  [s]

ケイデンス [歩/分]:
  cadence = 60 / meanST

歩幅（ステップ長）[m]:
  stride = speed / (cadence / 60)
         = speed × meanST
```

---

## 4. スコアリングアルゴリズム

### 4.1 規範値テーブル（NORM）

**出典**: Mobbs et al. Sensors 2025（胸骨装着・50 m歩行, N=313）

構造: `NORM[gender][ageKey]` → `{ speed:{mu,sig}, stride:{mu,sig}, cadence:{mu,sig} }`

年齢ブラケット: 20, 25, 30, … , 75, 80 歳（5歳刻み）

```
男性 抜粋:
  20歳: speed 1.48±0.19, stride 0.82±0.10, cadence 108±8
  65歳: speed 1.17±0.23, stride 0.64±0.12, cadence 108±10
  80歳: speed 0.91±0.26, stride 0.51±0.14, cadence 104±12

女性 抜粋:
  20歳: speed 1.40±0.17, stride 0.73±0.09, cadence 115±9
  65歳: speed 1.07±0.23, stride 0.54±0.12, cadence 118±11
  80歳: speed 0.81±0.26, stride 0.41±0.14, cadence 115±13
```

> **注意**: 原典は胸骨装着・50 m歩行条件。本アプリ（腰部装着・10 m歩行）との条件差によるバイアスは補正なし。

---

### 4.2 年齢ブラケット検索

```javascript
function getNormRow(age, gender) {
  const keys = [20, 25, 30, ..., 75, 80];
  const key = keys.reduce((best, k) =>
    Math.abs(k - age) < Math.abs(best - age) ? k : best
  );
  return NORM[gender][key];
}
```

---

### 4.3 Z スコア変換

```
Z_speed   = (speedVal   - μ_speed)   / σ_speed
Z_stride  = (strideVal  - μ_stride)  / σ_stride
Z_cadence = (cadenceVal - μ_cadence) / σ_cadence
```

---

### 4.4 0–100 スコア変換

```
Score = clamp( round(50 + 20 × Z), 0, 100 )

Z =  0  → Score = 50  （年齢性別平均）
Z = +2  → Score = 90  （上位 2.3 %）
Z = -2  → Score = 10  （下位 2.3 %）
```

---

### 4.5 総合スコア（加重 Z スコア）

```
weightedZ = 0.45 × Z_speed + 0.40 × Z_stride + 0.15 × Z_cadence

TotalScore = clamp( round(50 + 20 × weightedZ), 0, 100 )
```

**重み設定根拠**:

| 指標 | 重み | 根拠 |
|------|------|------|
| 歩行速度 | 45 % | 最も強力な生命予後予測因子（Studenski JAMA 2011） |
| 歩幅 | 40 % | 転倒・認知機能と強く関連（Verghese NEJM 2002） |
| ケイデンス | 15 % | 速度・歩幅から導出される従属変数のため重み小 |

---

### 4.6 判定ラベル

| Z 値範囲 | ラベル | 色 |
|---------|--------|-----|
| Z ≥ 1.5 | 優秀 | 緑 |
| 0.5 ≤ Z < 1.5 | 良好 | 青 |
| −0.5 ≤ Z < 0.5 | 標準 | グレー |
| −1.5 ≤ Z < −0.5 | やや低下 | 黄 |
| Z < −1.5 | 低下 | 赤 |

---

### 4.7 歩行年齢推定

```
目的関数: minimize Σ w_i × Z_i(age_candidate)²

w_speed = 0.45,  w_stride = 0.40,  w_cadence = 0.15

探索範囲: age_candidate ∈ {20, 25, 30, ..., 75, 80}

手順:
  for each candidate in [20..80, step 5]:
    norm = getNormRow(candidate, gender)
    zS = (speedVal   - norm.speed.mu)   / norm.speed.sig
    zSt= (strideVal  - norm.stride.mu)  / norm.stride.sig
    zC = (cadenceVal - norm.cadence.mu) / norm.cadence.sig
    cost = 0.45×zS² + 0.40×zSt² + 0.15×zC²

  walkingAge = candidate with minimum cost
```

---

## 5. 臨床リスク & 生活機能スクリーニング

4つの閾値を 0.8 → 1.0 → 1.2 m/s のスペクトルで配置。

| カード | 閾値 | 判定 | 臨床的意義 | 根拠文献 |
|--------|------|------|-----------|---------|
| 転倒・入院リスク | < 0.8 m/s | NG: 要注意 / OK: クリア | 転倒・入院リスクが有意に上昇する閾値 | Fritz & Lusardi PTJ 2009; Quach et al. Arch Intern Med 2011 |
| サルコペニア・フレイル精査 | < 1.0 m/s | NG: 精査推奨 / OK: クリア | AWGS 2019 現行スクリーニング閾値 | Chen LK et al. J Am Med Dir Assoc. 2020 |
| 社会参加・屋外自立歩行 | ≥ 1.0 m/s | OK: 自立 / NG: 要支援 | 横断歩道通過・屋外活動に必要な速度水準 | 日本交差点設計ガイドライン; Cesari et al. J Gerontol A 2005 |
| 良好な生命予後水準 | ≥ 1.2 m/s | OK: 高機能 / NG: 未達 | 地域在住高齢者の高機能群。ADL 維持・生命予後良好と関連 | Studenski et al. JAMA 2011;305(1):50-58（N=34,485, Level I-II） |

> **設計方針**: AWGS 2014（< 0.8 m/s）はサルコペニア旧基準として廃止されたが、0.8 m/s 閾値は転倒・入院リスクの独立した予測因子として有効であるため「転倒・入院リスク」として再位置づけた。

---

## 6. レーダーチャート 5軸スコア計算

```
軸 0（上）    スピード     = speedScore  / 100
軸 1（右上）  歩幅         = strideScore / 100
軸 2（右下）  テンポ       = cadenceScore / 100
軸 3（左下）  リズム安定   = max(0, (8.0 - bioCV) / 8.0)
                            （CV=0 → 1.0、CV=8 → 0.0）
軸 4（左上）  左右対称     = max(0, (10.0 - bioSI) / 10.0)
                            （SI=0 → 1.0、SI=10 → 0.0）

軸 3, 4 は CSV データ未読込時は 0.5（中央値）で表示
```

---

## 7. 担当者コメント自動生成

### 7.1 決定論的バリアント選択

```javascript
function hashCode(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function pick(arr, offset) {
  return arr[(hashCode(userId) + offset) % arr.length];
}
```

> 同一 userId では常に同じ文章が選ばれる。userId が異なれば異なるバリアントが出力される。

### 7.2 コメント構成（4パーツ結合）

```
(1) 速度コメント  — 4段階カテゴリ × 2バリアント
    great  : ≥ 1.20 m/s
    good   : 1.00–1.20 m/s
    moderate: 0.80–1.00 m/s
    slow   : < 0.80 m/s

(2) 歩行年齢コメント — 3段階 × 2バリアント
    younger: walkingAge < age - 5
    same   : |walkingAge - age| ≤ 5
    older  : walkingAge > age + 5

(3) リズム / 対称性コメント（CSV あり かつ 閾値超過時のみ追加）
    CV ≥ 4.0 % → リズム不安定コメント（2バリアント）
    SI ≥ 5.0 % → 左右差コメント（2バリアント）

(4) 締めの一言 — スコア高低 × 2バリアント
    高スコア (TotalScore ≥ 60): 激励・維持系
    低スコア (TotalScore < 60): 改善提案系

手動編集フラグ: isCommentEdited = true の場合、自動上書きをスキップ
```

---

## 8. アルゴリズム定数まとめ

| 定数 | 値 | 用途 |
|------|----|------|
| `WALK_DIST` | 10.0 m | 歩行距離 |
| `MIN_PEAK_INTERVAL` | 0.3 s | ピーク検出最小間隔 |
| `PEAK_THRESHOLD_PERCENTILE` | 40 % | ピーク動的閾値 |
| `TRIM_FRACTION` | 0.20 | 定常区間トリミング率 |
| `BP_LOW` | 0.7 Hz | バンドパス下限 |
| `BP_HIGH` | 6.0 Hz | バンドパス上限 |
| `PCA_ITER` | 300 | べき乗法反復回数 |
| `W_SPEED` | 0.45 | 総合スコア重み（速度） |
| `W_STRIDE` | 0.40 | 総合スコア重み（歩幅） |
| `W_CADENCE` | 0.15 | 総合スコア重み（ケイデンス） |
| `SCORE_CENTER` | 50 | Z=0 に対応するスコア |
| `SCORE_SCALE` | 20 | スコア感度（Z=1 → +20点） |
| `CV_WARN` | 4.0 % | CV 注意閾値 |
| `SI_WARN` | 5.0 % | SI 注意閾値 |
| `WR_NORMAL_LO` | 0.38 m/Hz | Walk Ratio 正常下限 |
| `WR_NORMAL_HI` | 0.42 m/Hz | Walk Ratio 正常上限 |
| `RMS_LOW` | 0.50 m/s² | RMS 低値閾値 |
| `RMS_HIGH` | 2.50 m/s² | RMS 高値閾値 |
