# 歩行年齢テスト計測システム
## 評価指標アルゴリズム リファレンス

**対象**: `index.html` の解析・スコアリング・判定ロジック
**最終更新**: 2026-03-22

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
通過帯域: 0.5 – 6.0 Hz
フィルタ次数: 2
設計方法: バイリニア変換

カットオフ正規化:
  f_low  = 0.5 / (fs/2)
  f_high = 6.0 / (fs/2)

ゼロ位相処理: 順方向フィルタ → 逆順フィルタ（filtfilt 等価）
```

**設計根拠**: 成人歩行ケイデンス 50–180 歩/分（0.83–3.0 Hz）。超低速歩行（ケイデンス < 60 歩/分 = 0.5 Hz）にも対応するため下限 0.5 Hz。高調波成分を含むため上限 6 Hz。

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

**根拠**: Hausdorff JM et al. Arch Phys Med Rehabil 2001;82(8):1050-1056（前向きコホート, Level II）; BMC Geriatrics 2022 アンブレラレビュー

---

### 2.2 対称性指標（Symmetry Index, SI）

```
OddMean  = mean( Δt[奇数インデックス] )
EvenMean = mean( Δt[偶数インデックス] )
Overall  = mean( Δt[全て] )

SI = |OddMean - EvenMean| / Overall × 100  [%]
```

> Robinson 1987 式。奇数・偶数ステップ交互の時間差で左右非対称性を評価。

> **実装上の制約**: 本システムは腰部加速度センサーから左右脚を直接同定できないため、奇数・偶数ステップを左右の代理指標として使用している。歩行開始足によりマッピングが反転する可能性があり、臨床的な左右差の方向（どちらが患側か）の判定には使用できない。Patterson et al. Gait Posture 2010 はSymmetry Ratioを推奨しており、本SIの閾値（5%/10%）は臨床コンセンサスに基づく参考値である。

#### 判定グレード

| グレード | 閾値 | 臨床的意義 |
|---------|------|-----------|
| 優良 | < 3.0 % | 非常に良好な左右対称性 |
| 正常 | 3.0–5.0 % | 正常範囲の左右差 |
| 注意 | 5.0–10.0 % | 跛行・整形外科疾患・片麻痺の可能性 |
| 要精査 | ≥ 10.0 % | 顕著な左右非対称。筋骨格・神経系疾患を疑う。 |

**根拠**: Robinson et al. J Manipulative Physiol Ther 1987;10(4):172-176（原典）; Patterson et al. Gait Posture 2010

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
| 正常 | 0.35–0.45 m/Hz（参考値） | 中枢神経による効率的な歩行制御 |
| 注意（低値） | 0.28–0.35 m/Hz | 神経疾患・恐怖性歩行・廃用症候群の可能性 |
| 注意（高値） | 0.45–0.50 m/Hz | 代償的大股歩き・筋力低下の可能性 |
| 要精査（低値） | < 0.28 m/Hz | パーキンソン病様の小刻み歩行パターン |
| 要精査（高値） | > 0.50 m/Hz | 高度の代償歩行 |

> 実装上の判定: `|WR - 0.40| ≤ 0.05` → 正常 / `≤ 0.10` → 注意 / `> 0.10` → 要精査

**根拠**: Sekiya & Nagasaki, Gait Posture 1998（不変性の実証; 原典単位 mm/(steps/min)≈6.5, 本システムはm/Hz換算の参考範囲）; Plotnik et al. J Neurol Sci 2011

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

**根拠**: Moe-Nilssen & Helbostad, J Biomech 2004; Tao W et al. Sensors 2012;12(2):2255-2283

---

## 3. 歩行速度・歩幅・ケイデンスの算出

```
計測距離: D = walkDist [m]  （ユーザー設定: 5 / 10 / 20 m、デフォルト 10 m）

歩行速度 [m/s]:
  allPeakTime = t[peaks.last] - t[peaks.first]  （全ピーク区間の経過時間）
  speed = D / allPeakTime
  ※ 有効範囲: 0.3 < speed < 3.0 m/s の場合のみ採用

ステップ数 n = steadyPeaks.length - 1
平均ステップ時間 meanST = (t[steadyPeaks.last] - t[steadyPeaks.first]) / n  [s]

ケイデンス [歩/分]:
  cadence = 60 / meanST

歩幅（ステップ長）[m]:
  stride = speed / (cadence / 60)
         = speed × meanST
```

> **歩行距離変更時の再計算（recalcSpeedFromDist）**: ユーザーが walkDist を変更すると、保存済みの `_allPeakTime` から速度・歩幅を自動再計算する。`_allPeakTime` が未取得（CSV未読込）の場合は再計算をスキップする。

---

### 3.1 倒立振子モデルによるステップ長直接推定（Mode A）

身長が入力されている場合、加速度データからステップ長を直接推定する。
歩行距離の入力は校正用のオプションとなり、距離に依存しない推定が可能。

**エビデンス**:
- Zijlstra W, Hof AL. Gait Posture 2003;18(2):1-10（原典, 被引用1,138回）
- Zijlstra A, Zijlstra W. Gait Posture 2013;38(4):940-4（高齢者での検証, 4バリアント比較）

**アルゴリズム**:

```
脚長推定:
  L = height_cm × 0.53 / 100  [m]（地面〜大転子高）

各ステップの鉛直変位算出:
  1. 定常区間の隣接ピーク間で加速度を抽出
  2. 台形積分で速度を算出 → 線形トレンド除去
  3. 台形積分で変位を算出 → 線形トレンド除去
  4. h = max(displacement) − min(displacement)

倒立振子モデル:
  SL = K × 2 × √(2Lh − h²)
  K = 1.25（Zijlstra 2003 補正係数、2013で高齢者にも有効と検証）

収束チェック:
  hCV（鉛直変位のCV）< 30% かつ 有効ステップ率 > 70%

速度算出:
  speed = mean(SL) × cadence / 60

距離校正（オプション, walkDist入力あり時）:
  α = walkDist / Σ(各ステップ長)
  0.7 < α < 1.3 → 校正適用（IP+CAL）
  |α − 1| > 0.3 → 警告フラグ
```

**モード分岐**:

| 条件 | 推定モード | 速度算出 |
|------|-----------|---------|
| 身長あり＋IP収束 | `IP` | mean(SL) × cadence/60 |
| 身長あり＋IP収束＋距離校正 | `IP+CAL` | mean(SL) × α × cadence/60 |
| 身長なし or IP失敗 | `DIST` | 定常区間距離 ÷ 定常区間時間 |
| サンプルデータ | `DEMO` | 固定値 |

> **Mode B（DIST）速度算出:**
>
> ```
> steadySteps = steadyPeaks.length - 1
> steadyTime  = t[steadyPeaks.last] - t[steadyPeaks.first]
> steadyDist  = walkDist × (steadySteps / totalSteps)
> speed       = steadyDist / steadyTime
> ※ 定常区間データが不十分な場合は全ピーク区間（walkDist / allPeakTime）にフォールバック
> ```

---

## 4. スコアリングアルゴリズム

### 4.1 規範値テーブル（NORM）

**出典（複数文献参照による合成規範値テーブル）**:
- Bohannon RW, Andrews AW. Physiotherapy 2011;97(3):182-189（メタ分析, N=23,111, 20研究統合）— 主要参照
- Hollman JH et al. Gait Posture 2011;34(1):111-118（高齢者規範値, N=118）
- Mobbs RJ et al. Sensors 2025;25(2):581（IMUベース, N=280解析対象, 胸骨装着・50m歩行）
- Schwesig R et al. Gait Posture 2011;33(4):673-678（IMUベース, N=1,860, 5-100歳）

※ 各年齢ブラケットの値は上記文献を参考に構成した合成規範値であり、単一文献からの直接引用ではない。
※ 原典（Mobbs 2025）は10歳刻み。5歳刻みの値は線形補間により生成。85歳・90歳は外挿推定。

構造: `NORM[gender][ageKey]` → `{ speed:{mu,sig}, stride:{mu,sig}, cadence:{mu,sig} }`

年齢ブラケット: 20, 25, 30, … , 80, 85, 90 歳（5歳刻み）
※ 原典文献は10歳刻みのため、5歳刻みの中間値は線形補間で生成。85歳・90歳は80歳からの外挿推定。
※ Mobbs 2025の解析対象はN=280（313名中33名を除外）。装着位置は胸骨角（sternal angle）、本システムの腰部装着とは条件が異なる。

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
  const keys = [20, 25, 30, ..., 75, 80, 85, 90];
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
| 歩幅 | 40 % | 転倒・認知機能低下と強く関連（Verghese et al. JNNP 2007;78:929; PMC 2021 stride length meta-analysis） |
| ケイデンス | 15 % | 速度・歩幅から導出される従属変数のため重み小 |

> **統計的注記**: speed = stride × cadence/60 の数学的関係から3変数は独立ではない（多重共線性）。ケイデンスの重みを15%に抑え、速度と歩幅を主要評価軸とすることで冗長性の影響を最小化している。ケイデンスは速度・歩幅と異なる臨床的意味（神経系のリズム生成能力）を持つため、低い重みで包含する設計とした。

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

探索範囲: age_candidate ∈ {20, 25, 30, ..., 80, 85, 90}

手順:
  for each candidate in [20..90, step 5]:
    norm = getNormRow(candidate, gender)
    zS = (speedVal   - norm.speed.mu)   / norm.speed.sig
    zSt= (strideVal  - norm.stride.mu)  / norm.stride.sig
    zC = (cadenceVal - norm.cadence.mu) / norm.cadence.sig
    cost = 0.45×zS² + 0.40×zSt² + 0.15×zC²

  bestCandidate = candidate with minimum cost

  // 隣接ブラケット線形補間
  neighbor = 隣接ブラケットのうちコストが小さい方
  w = bestCandidate.cost / (bestCandidate.cost + neighbor.cost)
  walkingAge = round(bestCandidate.age × (1-w) + neighbor.age × w)
```

---

## 5. 臨床リスク & 生活機能スクリーニング

4つの閾値を 0.8 → 1.0 → 1.2 m/s のスペクトルで配置。

| カード | 閾値 | 判定 | 臨床的意義 | 根拠文献 |
|--------|------|------|-----------|---------|
| 転倒・入院リスク | < 0.8 m/s | NG: 要注意 / OK: クリア | 転倒・入院リスクが有意に上昇する閾値 | Fritz S, Lusardi M. J Geriatr Phys Ther 2009;32(2):46; Quach L et al. J Am Geriatr Soc 2011;59(6):1069-1073 |
| サルコペニア・フレイル精査 | < 1.0 m/s | NG: 精査推奨 / OK: クリア | AWGS 2019 現行スクリーニング閾値 | Chen LK et al. J Am Med Dir Assoc. 2020 |
| 社会参加・屋外自立歩行 | ≥ 1.0 m/s | OK: 自立 / NG: 要支援 | 横断歩道通過・屋外活動に必要な速度水準 | 道路構造令に基づく歩行者横断速度基準（1.0 m/s）; Cesari et al. J Gerontol A 2005 |
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
| `walkDist` | 5 / 10 / 20 m（デフォルト 10 m） | 歩行距離（ユーザー選択） |
| `MIN_PEAK_INTERVAL` | 0.3 s | ピーク検出最小間隔 |
| `PEAK_THRESHOLD_PERCENTILE` | 40 % | ピーク動的閾値 |
| `TRIM_FRACTION` | 0.20 | 定常区間トリミング率 |
| `BP_LOW` | 0.5 Hz | バンドパス下限（超低速歩行対応） |
| `BP_HIGH` | 6.0 Hz | バンドパス上限 |
| `PCA_ITER` | 300 | べき乗法反復回数 |
| `W_SPEED` | 0.45 | 総合スコア重み（速度） |
| `W_STRIDE` | 0.40 | 総合スコア重み（歩幅） |
| `W_CADENCE` | 0.15 | 総合スコア重み（ケイデンス） |
| `SCORE_CENTER` | 50 | Z=0 に対応するスコア |
| `SCORE_SCALE` | 20 | スコア感度（Z=1 → +20点） |
| `CV_WARN` | 4.0 % | CV 注意閾値 |
| `SI_WARN` | 5.0 % | SI 注意閾値 |
| `WR_NORMAL_LO` | 0.35 m/Hz（参考値） | Walk Ratio 正常下限 |
| `WR_NORMAL_HI` | 0.45 m/Hz（参考値） | Walk Ratio 正常上限 |
| `RMS_LOW` | 0.50 m/s² | RMS 低値閾値 |
| `RMS_HIGH` | 2.50 m/s² | RMS 高値閾値 |

---

## 9. シューズレコメンドアルゴリズム（scoreShoeV2）

> **アーキテクチャ変更**: v6.1 より、旧 `getShoeRequirements()` + `scoreShoeAdvanced()` を廃止し、`SHOE_KMAP` ベースの新分類エンジン + `scoreShoeV2()` 多次元スコアリングに全面移行。

---

### 9.1 assessWalkingProfile() — プロファイル生成

歩行計測結果と Q1–Q6 質問回答からシューズ要件プロファイルを生成する。

```javascript
function assessWalkingProfile() {
  return {
    sp, st, ca,              // 歩行速度・歩幅・ケイデンス
    spZ, stZ, caZ,           // Z スコア（各指標）
    cv, si, wr, rms,         // バイオメカニクス指標
    age, walkingAge,         // 実年齢・歩行年齢
    knee,    // Q1: 'none' | 'mild' | 'severe'
    rain,    // Q2: boolean
    foot,    // Q3: 'none' | 'bunion' | 'flat' | 'both' | 'wide'
    fasten,  // Q4: 'any' | 'lace' | 'velcro' | 'zipper'
    purpose, // Q5: 'auto' | 'daily' | 'walking' | 'active'
    design,  // Q6: 'any' | 'sporty' | 'smart'
    gender,  // 'male' | 'female'
    activityLevel,  // 速度or Q5から算出
  };
}
```

**activityLevel 決定ロジック（Q5 優先）**

| 条件 | activityLevel | 根拠 |
|------|--------------|------|
| Q5 = `daily` | `low` | ユーザー明示選択が速度判定に優先 |
| Q5 = `walking` | `moderate` | 同上 |
| Q5 = `active` | `high` | 同上 |
| Q5 = `auto` かつ speed < 0.8 m/s | `verylow` | Fritz 2009 — 転倒リスク閾値 |
| Q5 = `auto` かつ 0.8–1.0 m/s | `low` | AWGS 2019 |
| Q5 = `auto` かつ 1.0–1.2 m/s | `moderate` | 標準活動量 |
| Q5 = `auto` かつ ≥ 1.2 m/s | `high` | Studenski 2011 — 高機能群 |

---

### 9.2 SHOE_KMAP — シューズ分類キーワードマップ

商品名・説明文・features を全文結合したテキストに対し、キーワードマッチで構造化属性を生成する。

#### 9.2.1 活動量分類

| レベル | キーワード |
|--------|-----------|
| high | スポーツ, フィットネス, ランニング, FlyteFoam, フルイドライド, エナジーセービング |
| moderate | ウォーキング, walking, ロッカー, ガイダンスライン, グルーヴ設計, 屈曲性 |
| low | クッション, GEL, fuzeGEL, 衝撃吸収, 快適 |
| verylow | シニア, 高齢, マジックテープ, ベルクロ, BOA, サイドジッパー, ワンタッチ |

活動量スコア計算: 基準値1に対し high=+3, moderate=+2, low=+1, verylow=-1 を加算。
合計 ≥5 → high / ≥4 → moderate / ≥2 → low / <2 → verylow

#### 9.2.2 性別判定

`メンズ` → male / `レディース` → female / どちらも含まない → unisex

#### 9.2.3 機能フラグ

| フラグ | キーワード | 用途 |
|--------|-----------|------|
| `stability` | 安定性, ガイドレール, モーションコントロール, メディアルサポート, デュアルデンシティ, MCCS, バランスサポート, ヒールカウンター | 膝・低速域マッチ |
| `cushion` | クッション, GEL, fuzeGEL, 衝撃吸収, FlyteFoam, P-GEL, T-GEL, SPEVA | 衝撃吸収マッチ |
| `wideWidth` | 3E幅, 4E幅, 5E幅, 幅広, ワイドフィット, ワイドトゥ, 外反母趾対応, スクエアトゥ, 幅広フィット | Q3 足幅マッチ |
| `archSupport` | アーチサポート, OrthoLite, メディアルサポート, インソール, 扁平足対応, アーチサポートベルト, 3D成型インソール | 扁平足マッチ |
| `waterproof` | 防水, GORE-TEX, ゴアテックス, 撥水, 耐水, 合皮, 合成皮革, 防水透湿 | Q2 防水マッチ |
| `easyOn` | マジックテープ, ベルクロ, BOAフィット, サイドジッパー, ワンタッチ, ファスナー, スリップオン, ゴムひも | 着脱容易マッチ |
| `rocker` | ロッカー, グルーヴ設計, ガイダンスライン, ロッカーソール, エナジーセービング, 省エネ機能, 省エネ設計 | 中〜高速域マッチ |
| `lightweight` | 軽量, ライト, 軽量クッション | 高速域マッチ |
| `lace` | レースアップ, 靴紐 | 紐靴判定 |
| `sportyDesign` | メッシュ, ニット, ラッセルメッシュ, ニットメッシュ, 運動特化, モノソックアッパー | Q6 スポーティマッチ |
| `smartDesign` | 天然皮革, 人工皮革, 合成皮革, 本革, プレミアム, スマートデザイン, ビジネスカジュアル, コートスニーカー, 人工皮革ストレッチ | Q6 キレイめマッチ |
| `antiTrip` | つまずき防止, グルーヴチェンジ | つまずき防止 |
| `odorControl` | 消臭機能, MOFF, 消臭繊維 | 消臭機能 |

---

### 9.3 ACT_COMPAT — 活動量互換性マトリクス

シューズ設計活動量とユーザー活動量の互換度（0–100%）を 4×4 マトリクスで定義。

```
ユーザー →      verylow  low   moderate  high
シューズ ↓
verylow           100     60      30       5
low                70    100      70      40
moderate           30     70     100      70
high                5     30      60     100
```

スコア = `round(compat / 100 × 20)` → 最大 20 点

---

### 9.4 SERIES_KMAP / SERIES_PROFILE — シリーズコンセプト適合

#### 9.4.1 シリーズ検出テーブル（SERIES_KMAP）

| シリーズ ID | 検出キーワード |
|------------|-------------|
| `ridewalk` | ゲルライドウォーク, GEL-RIDEWALK, RIDEWALK |
| `fieldwalker` | フィールドウォーカー, FIELDWALKER |
| `fastwalk` | ゲルファストウォーク, GEL-FASTWALK, FASTWALK |
| `lasiro` | ゲルラシーロ, GEL-LASIRO, LASIRO |
| `hadashi` | ハダシウォーカー, HADASHIWALKER |
| `funwalker` | ゲルファンウォーカー, GEL-FUNWALKER, FUNWALKER |
| `lifewalk` | ライフウォーカー, LIFE WALKER, LIFEWALKER |
| `kneesup` | ニーズアップ, KNEESUP |

#### 9.4.2 シリーズプロファイル（SERIES_PROFILE）

| シリーズ | 速度帯 (m/s) | 適合活動量 | 設計コンセプト |
|---------|-------------|------------|-------------|
| ridewalk | 0.8–1.2 | low, moderate | エネルギーセービング快適ウォーキング |
| fieldwalker | 1.0–1.5 | moderate, high | アウトドア・低山ハイキング |
| fastwalk | 1.2–2.0 | high | ファストウォーキング高機能 |
| lasiro | 0.8–1.3 | low, moderate | ライフスタイル・カジュアルウォーキング |
| hadashi | 1.0–1.5 | moderate, high | ハダシ感覚・軽量スポーティ |
| funwalker | 0.5–1.0 | verylow, low | 足への負担軽減・日常歩行快適 |
| lifewalk | 0.0–1.0 | verylow, low | ヘルスサポート・日常生活支援 |
| kneesup | 0.0–1.5 | verylow, low, moderate | O脚・ひざ関節負担軽減専用 |

**シリーズ適合スコア（max 15 点）:**
- 速度帯適合: ユーザー速度がシリーズ速度帯内 → +8 / 0.3 m/s 以内 → +3 / 範囲外 → 0
- 活動量適合: ユーザー活動量がシリーズ適合リストに含まれる → +7

---

### 9.5 preFilterShoes() — 事前フィルタリング

スコアリング前にハードフィルタでシューズ候補を絞り込む。

| ルール | 条件 | フィルタ動作 |
|--------|------|------------|
| 1. 速度フィルタ | 歩行速度 ≤ 0.9 m/s（安全マージンとして0.9 m/sに設定。1.0 m/s以下でも手動選択によりライフウォーカー以外を推薦可能） | ライフウォーカーのみに絞込 |
| 2. マジックテープ指定 | Q4 = `velcro` | ライフウォーカーのみに絞込 |
| 3. ジッパー指定 | Q4 = `zipper` | テキストに「ジッパー/ファスナー/zipper」を含む靴のみ |
| 4. 紐靴指定 | Q4 = `lace` | `lace`フラグ有り、またはeasyOn・ジッパー・BOA無しの靴 |

> **設計方針**: マジックテープはライフウォーカーシリーズのみが対応するため、velcro 選択時はライフウォーカーに限定。

---

### 9.6 scoreShoeV2() — 多次元スコアリング（8次元）

#### 全体構造

```
scoreShoeV2(shoe, profile) → { score, pct, reasons[] }

1. classifyShoe(shoe) → { activityLevel, gender, flags{} }
2. 8 次元でスコア加算/減算
3. dynamicMax（動的最大値）で正規化
4. pct = clamp(score / dynamicMax × 100, 0, 100)
```

#### 次元別スコアリング詳細

**次元 1: 性別マッチング (max 20)**

| 条件 | スコア |
|------|--------|
| シューズ性別 = ユーザー性別 | +20 |
| ユニセックス | +5 |
| 性別不一致 | −30 |

**次元 2: 活動量互換性 (max 20)**

ACT_COMPAT マトリクスから互換度を取得し `round(compat/100 × 20)` でスコア化。

**次元 3: 歩行速度・臨床ニーズ (max 28)**

| 速度帯 | stability | cushion | easyOn | rocker | lightweight |
|--------|-----------|---------|--------|--------|-------------|
| < 0.8 m/s | +12 | +8 | +8 (fasten=any時) | — | — |
| 0.8–1.0 | +8 | +5 | — | — | — |
| 1.0–1.2 | — | +4 | — | +8 | — |
| ≥ 1.2 | — | — | — | +10 | +8 |

**次元 4: バイオメカニクス (max 10)**

| 指標 | 閾値 | 条件 | スコア |
|------|------|------|--------|
| CV | > 8.0% | stability | +10 |
| CV | 4.0–8.0% | stability | +5 |
| SI | > 10.0% | archSupport | +10 |
| SI | 5.0–10.0% | archSupport | +5 |

**次元 5: パーソナライズ設問 (max ~83)**

| 設問 | 条件 | スコア | 備考 |
|------|------|--------|------|
| Q1 膝 severe | stability | +15 | |
| Q1 膝 severe | cushion | +8 | |
| Q1 膝 mild | stability | +8 | |
| Q2 防水 | GORE-TEX検出 | +20 | 最優先 |
| Q2 防水 | 合皮/合成皮革検出 | +15 | 次優先 |
| Q2 防水 | waterproofフラグ | +10 | 一般防水 |
| Q2 防水 | 上記いずれも非該当 | −5 | ペナルティ |
| Q3 外反母趾/both | wideWidth | +15 | |
| Q3 外反母趾/both | 非該当 | −8 | |
| Q3 扁平足/both | archSupport | +15 | |
| Q3 扁平足/both | 非該当 | −5 | |
| Q3 幅広・甲高 | wideWidth + 4E/5E | +20 | 超幅広ボーナス |
| Q3 幅広・甲高 | wideWidth（標準） | +15 | |
| Q3 幅広・甲高 | 非該当 | −10 | |
| Q4 ジッパー | テキストマッチ | +15 | |
| Q4 紐靴 | lace フラグ | +8 | |
| Q4 any + verylow | easyOn フラグ | +10 | 低活動量自動推奨 |
| Q6 スポーティ | sportyDesign | +15 | |
| Q6 スポーティ | smartDesign | −8 | ミスマッチ減点 |
| Q6 キレイめ | smartDesign | +15 | |
| Q6 キレイめ | sportyDesign | −8 | ミスマッチ減点 |

**次元 6: 年齢・ADL考慮 (max 8)**

| 条件 | フラグ | スコア |
|------|--------|--------|
| 75歳以上 | easyOn | +5 |
| 75歳以上 | wideWidth | +3 |
| 65歳以上 | wideWidth | +3 |

**次元 7: シリーズコンセプト適合 (max 15)**

9.4.2 参照。速度帯適合 (max 8) + 活動量適合 (max 7)

**次元 8: KNEESUP 膝悩み専用ボーナス (max 40)**

| 条件 | スコア | 根拠 |
|------|--------|------|
| シリーズ = kneesup かつ Q1 = severe | +40 | O脚専用設計への強力な適合 |
| シリーズ = kneesup かつ Q1 = mild | +25 | 膝負担軽減設計への適合 |

---

### 9.7 dynamicMax — 動的最大値正規化

ユーザーの条件に関係ない項目が分母を水増しして正規化スコアが不自然に低くなる問題を解消するため、各ユーザーが理論上獲得できる最大点のみを分母にする。

```
基本: 40 点（性別 20 + 活動量 20）

+ 速度帯別最大:
  < 0.8 m/s: +28  (stability 12 + cushion 8 + easyOn 8)
  0.8–1.0:   +13  (stability 8 + cushion 5)
  1.0–1.2:   +12  (rocker 8 + cushion 4)
  ≥ 1.2:     +18  (rocker 10 + lightweight 8)

+ バイオ指標（CSV データありの場合のみ）:
  CV > 8.0%: +10 / CV > 4.0%: +5
  SI > 10.0%: +10 / SI > 5.0%: +5

+ 設問条件（ユーザー該当分のみ加算）:
  Q1 severe: +23 (stability 15 + cushion 8) / Q1 mild: +8
  Q2 防水: +20
  Q3 外反母趾/both: +15 / 扁平足/both: +15 / 幅広・甲高: +20
  Q4 zipper: +15 / lace: +8 / any+verylow: +10
  Q6 sporty|smart: +15
  年齢 ≥75: +8 / ≥65: +3

+ シリーズコンセプト: +15（常時加算）

+ KNEESUP膝悩みボーナス（膝問題ありの場合のみ）:
  severe: +40 / mild: +25

dynamicMax = max(合計, 1)
pct = clamp(round(score / dynamicMax × 100), 0, 100)
```

---

### 9.8 Q2 防水スコアリング（3 段階優先度）

雨天使用希望時に、素材ベースで 3 段階のスコアを適用する。

```
テキスト = name + description + features（結合テキスト）

1. GORE-TEX / ゴアテックス → +20（最優先）
2. 合皮 / 合成皮革           → +15（次優先）
3. waterproof フラグのみ      → +10（一般防水）
4. いずれも非該当             → −5（ペナルティ）
```

**根拠**: GORE-TEX は透湿防水の最高規格。合皮は撥水性が高いが透湿性は劣る。一般防水は撥水加工のみ。

---

### 9.9 パーソナライズ設問一覧（Q1–Q6）

| 設問 | 質問文 | 選択肢 | 主な影響 |
|------|--------|--------|---------|
| Q1 | O脚・膝の悩みはありますか？ | なし / 軽度 / 強い悩みあり | stability/cushion ボーナス + KNEESUP 専用ボーナス |
| Q2 | 雨の日でも着用したい（防水性重視） | チェックボックス | 3段階防水スコア（GORE-TEX > 合皮 > 一般） |
| Q3 | 足の悩み・特徴はありますか？ | 特になし / 外反母趾 / 扁平足 / 外反母趾＋扁平足 / 幅広・甲高 | wideWidth/archSupport マッチ + 4E/5E 超幅広ボーナス |
| Q4 | 靴の着脱方法は？ | こだわらない / 紐靴 / マジックテープ / サイドジッパー | preFilter + スコアリング |
| Q5 | 主な使用目的は？ | 自動判定（推奨） / 日常のお出かけ / ウォーキング / アクティブ | activityLevel のオーバーライド |
| Q6 | 好みのデザインや着用シーンは？ | こだわらない / スポーティ / キレイめ | sportyDesign/smartDesign マッチ |

---

### 9.10 アルゴリズム定数（シューズレコメンド）

| 定数 | 値 | 説明 |
|------|----|------|
| 上位表示件数 | 3 件 | pct 降順ソートの上位 3 件を表示 |
| 性別マッチスコア | +20 / ユニセックス +5 / 不一致 −30 | 性別による強力なフィルタリング |
| GORE-TEX 防水スコア | +20 | 最高ランク防水素材 |
| 合皮防水スコア | +15 | 次ランク防水素材 |
| 一般防水スコア | +10 | 標準防水 |
| KNEESUP severe ボーナス | +40 | 膝悩み強 → KNEESUP 強推奨 |
| KNEESUP mild ボーナス | +25 | 膝悩み軽度 → KNEESUP 推奨 |
| 超幅広(4E/5E)ボーナス | +20 | Q3 幅広 + 4E/5E テキスト検出 |
| デザインマッチボーナス | +15 | Q6 sporty/smart が合致 |
| デザインミスマッチ減点 | −8 | Q6 不一致時のペナルティ |
| シリーズ速度帯適合 | +8 (適合) / +3 (近接) / 0 (範囲外) | SERIES_PROFILE による |
| シリーズ活動量適合 | +7 | 活動量リストに含まれる場合 |
| 速度フィルタ閾値 | ≤ 0.9 m/s | ライフウォーカー限定 |




