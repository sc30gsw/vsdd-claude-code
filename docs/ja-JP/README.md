# vsdd-claude-code

![バージョン](https://img.shields.io/badge/version-1.0.0-blue)
![ライセンス](https://img.shields.io/badge/license-MIT-green)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-orange)

**言語**: [English](../../README.md)

**Verified Spec-Driven Development (VSDD)** をあらゆるプロジェクトにもたらす Claude Code プラグイン。

---

## VSDDとは

AI支援開発は生産性を大きく向上させる一方で、構造的な品質ゲートが欠落しやすいという問題を抱えている。テストは通過するが仕様とは乖離している、レビューでは問題が見つからないが本番で障害が発生する、といった「AIスロップ（AI slop）」と呼ばれる現象がその代表例だ。AIスロップとは、表面上は正しく見えながら隠れた欠陥を持つコードのことを指す。

VSDDはこの問題に対して、以下の3つの手法を統合した体系的なワークフローで応答する。

- **SDD（Spec-Driven Development）**: 仕様を実装の起点に据える
- **TDD（Test-Driven Development）**: テストをコードより先に書く
- **VDD（Verification-Driven Development）**: 形式検証を品質保証の仕上げに使う

これらに加え、builderエージェントとは独立した**敵対的レビュー（Adversarial Review）**を組み合わせることで、AIスロップを体系的に排除する。

---

## 主な特徴

### 6フェーズパイプライン

仕様記述から収束判定まで、すべての作業を明確なフェーズに分割して進める。フェーズをまたぐ作業は許可されず、各フェーズ完了時に品質ゲートが走る。

| フェーズ | 名称 | 内容 |
|---------|------|------|
| 1a | 行動仕様 | EARS形式の要件定義、エッジケースカタログ |
| 1b | 検証アーキテクチャ | 純粋性境界マップ、証明義務の定義 |
| 1c | 仕様レビューゲート | adversaryによる仕様レビュー。strict では人間による承認も必要 |
| 2a | テスト生成（Red） | 必ず失敗するテストを先に書く |
| 2b | 実装（Green） | テストを通過させる最小実装 |
| 2c | リファクタ | グリーンを維持しながら構造を改善 |
| 3 | 敵対的レビュー | 新鮮なコンテキストのadversaryエージェントによる審査 |
| 4 | フィードバック統合 | 指摘事項を適切なフェーズへルーティング |
| 5 | 形式的強化 | 検証ティアに応じた形式証明の実行 |
| 6 | 収束判定 | 4次元収束が達成された場合のみ完了 |

### 2つの動作モード

**strictモード**は高保証作業向けの完全な VSDD セレモニーを提供する。**leanモード**も全6フェーズを通過するが、承認、スプリント契約、証明義務を軽量化してプロダクト開発や試作に向けた運用をしやすくする。詳細は[動作モード比較表](#動作モード比較表)を参照。

### adversaryエージェント（opusモデル、レビュー出力専用）

adversaryエージェントはVSDDの中核的な品質ゲートだ。以下の制約のもとで動作する。

- **新鮮なコンテキストで必ず起動する**: builderエージェントの文脈を一切引き継がない
- **レビュー出力以外は書き込まない**: `reviews/**/output/` 配下に verdict と findings を出力する以外、仕様・コード・テストは変更しない
- **「全体的に良さそう」と言うことが禁止されている**: 明確な証拠に基づいたバイナリ PASS/FAIL の判定のみが許される

adversaryエージェントは以下の5次元でPASS/FAILを判定する。

1. 仕様忠実性（Spec Fidelity）
2. エッジケースカバレッジ（Edge Case Coverage）
3. 実装正確性（Implementation Correctness）
4. 構造的健全性（Structural Integrity）
5. 検証準備状態（Verification Readiness）

### Chainlinkビードトレーサビリティシステム

すべてのコード行を仕様要件まで追跡できる。すべての成果物（仕様・テスト・実装・指摘・証明）がビードとして記録され、REQ-XXX から PROOF-XXX まで双方向リンクで結ばれる。

詳細は[トレーサビリティチェーン](#トレーサビリティチェーン)を参照。

### Claude Codeフックによるゲート強制

PreToolUseフックがフェーズ外の `Write`/`Edit` および、リダイレクト等でソースやテストへ書き込む可能性のある `Bash` をヒューリスティックにブロックする。開発者が誤って作業順序を飛ばすことを防ぐ。

### 言語プロファイル

言語固有の検証ツールチェーンをプリセットで提供する。

| 言語 | Tier 1（プロパティテスト） | Tier 2（軽量形式手法） |
|------|--------------------------|----------------------|
| Rust | proptest, cargo-fuzz | Kani |
| Python | hypothesis, mutmut | - |
| TypeScript | fast-check | - |
| Go | go-fuzz | - |
| C++ | libFuzzer | CBMC |

### フェーズタグ付きGit統合

`/vsdd-commit` はフェーズ識別子、ビード要約、成果物マニフェストを含むコミットメッセージを生成する。オプションの自動コミットは、アクティブな feature と現在 phase に属するファイルだけをステージし、既存タグを上書きせずに `vsdd/<feature>/phase-<id>` タグを作成する。

---

## アーキテクチャ

### 4エージェント構成

| エージェント | モデル | ツール権限 | 役割 | 主な制約 |
|-------------|--------|-----------|------|---------|
| vsdd-orchestrator | sonnet | Read, Write, Glob, Grep, Bash | パイプライン調整、ゲート強制 | ゲートチェックをスキップしない |
| vsdd-builder | sonnet | Read, Write, Edit, Bash, Glob, Grep | 仕様記述、TDD実装 | フェーズ対応ファイルへの書き込みのみ |
| vsdd-adversary | **opus** | Read, Write, Edit, Grep, Glob | 敵対的レビュー | `reviews/**/output/` のみ書込可、毎回新鮮なコンテキスト |
| vsdd-verifier | sonnet | Read, Write, Edit, Bash, Grep, Glob | 形式検証の調整 | `verification/**` と `state.json` の proof 更新、言語プロファイル対応 |

### ファイルベース通信

エージェント間の通信は会話ではなくファイルを介して行われる。`.vsdd/features/<name>/` ディレクトリがすべての中継点として機能する。orchestratorがレビューマニフェストをディスクに書き込み、adversaryはそれを読み取ってverdictを返す。

### コンポーネント構成

| コンポーネント | 数量 | 説明 |
|--------------|------|------|
| スラッシュコマンド | 13 | `/vsdd-init` から `/vsdd-commit` まで |
| スキル | 13 | トレーサビリティ、言語プロファイルなど |
| JSONスキーマ | 6 | state, bead, finding, grading など |

---

## クイックスタート

### インストール

```bash
# リポジトリを clone
git clone https://github.com/sc30gsw/vsdd-claude-code.git
cd vsdd-claude-code

# standardプロファイルでインストール
bash install.sh --profile standard

# TypeScript言語プロファイルを追加する場合
bash install.sh --profile standard --language typescript
```

代替として package manager 経由でも実行できる。

```bash
npx vsdd-claude-code --profile standard
pnpm dlx vsdd-claude-code --profile standard
yarn dlx vsdd-claude-code --profile standard
bunx vsdd-claude-code --profile standard
npx vsdd-claude-code --profile standard --dry-run
```

### フィーチャーパイプラインの開始

```bash
# user-authフィーチャーをleanモードで初期化
/vsdd-init user-auth --mode lean

# フェーズ1a + 1b: 行動仕様と検証アーキテクチャの記述
/vsdd-spec

# フェーズ1c: 仕様レビューゲート
/vsdd-spec-review

# フェーズ2a: 失敗するテストの生成（Red）
/vsdd-tdd
# 2a への遷移時に、この実装サイクル用の sprint 1 が開始される

# フェーズ2b + 2c: 実装して Green にし、その後リファクタ
/vsdd-impl

# strict モードのみ: sprint contract を adversary がレビュー
/vsdd-contract-review
# PASS 後に status 以外を変更した場合は再レビューが必要

# フェーズ3: 敵対的レビュー（新鮮なコンテキストのopusエージェントが審査）
/vsdd-adversary

# フェーズ4: FAIL 時は指摘をルーティング
/vsdd-feedback

# フェーズ5: 形式的強化
# leanモードでも verification-report.md は必ず生成される。
# required な証明義務がゼロなら軽量レポートになる。
/vsdd-harden

# フェーズ6: 4次元収束を確認
/vsdd-converge

# パイプラインの現在状態を確認
/vsdd-status

# トレーサビリティチェーンを表示
/vsdd-trace REQ-001
```

---

## パイプライン状態機械

```
init -> 1a -> 1b -> 1c -> 2a -> 2b -> 2c -> 3 -> 4 -> [1a|1b|2a|2b|2c|5] -> 5 -> 6 -> complete
                                                                             ^
                                                                     収束ループ（最大2回）
```

フェーズ4（フィードバック統合）では、adversaryの指摘内容に応じて適切なフェーズへルーティングされる。

strict モードでは追加で以下を強制する。

- フェーズ3前: `contracts/sprint-{N}.md` は `status: approved` で、contract review verdict の `reviewContext.contractPath` と `reviewContext.contractDigest` が現在の契約に一致している必要がある
- フェーズ6前: `convergenceSignals.allCriteriaEvaluated = true` に加えて、`convergenceSignals.evaluatedCriteria` が承認済み contract の `CRIT-XXX` 集合と完全一致している必要がある
- 収束ループが 2 回目以降なら、完了前に `convergenceSignals.findingCount < convergenceSignals.previousFindingCount` も必要になる

| 指摘の種類 | ルーティング先 |
|-----------|--------------|
| 仕様の曖昧さ | フェーズ1a |
| 検証ツール不一致 | フェーズ1b |
| 要件との不一致 | フェーズ2b |
| エッジケースの欠落 | フェーズ1a + 2a |
| テスト品質の問題 | フェーズ2a |
| 実装バグ | フェーズ2b |
| コード構造の問題 | フェーズ2c |
| 純粋性境界の破綻 | 原則フェーズ1b |
| 証明ギャップ | フェーズ5 |

---

## 動作モード比較表

| 項目 | strictモード | leanモード |
|------|------------|----------|
| 対象用途 | 高保証作業、安全要件のある実装 | プロダクト開発、試作、通常のフィーチャー開発 |
| スプリント契約 | 全スプリントで必須 | リスクの高い作業のみ |
| スプリント契約レビュー | フェーズ3前に必須。判定は承認済み契約スナップショットに束縛される | 契約を使う場合のみ任意 |
| adversaryレビュー | 複数ラウンド | 1ラウンド |
| 仕様レビュー時の人手承認 | 必須 | 不要 |
| 証明義務 | required な義務を強制 | 選択的。required が 0 件でもよい |
| 形式的強化レポート | 必須 | 必須 |
| ゲート強制 | strictフックプロファイル | 緩和された設定 |
| イテレーション速度 | 低速（高保証） | 高速 |
| 推奨フロー | 全6フェーズを完全に実行 | 全6フェーズを維持しつつ運用を軽量化 |

---

## インストールオプション

### インストールプロファイル

```bash
# minimal: docs / manifests / schemas / rules / commands / core runtime を導入
bash install.sh --profile minimal

# standard: contexts / agents / skills / hooks を含むフルワークフロー（推奨）
bash install.sh --profile standard

# strict: standard に strict hook profile を組み合わせる高保証向け
bash install.sh --profile strict
```

代替:

```bash
npx vsdd-claude-code --profile standard
```

| プロファイル | 内容 | 適用シーン |
|------------|------|----------|
| minimal | docs + manifests + schemas + rules + commands + core runtime | 試用、軽量な利用 |
| standard | + agents, skills, contexts, hooks, scripts（既定 `VSDD_HOOK_PROFILE=standard`） | 通常の開発作業 |
| strict | standard と同じファイル構成。`VSDD_HOOK_PROFILE=strict` で厳しいフックマップ（自動コミットフック有効化など） | 高保証作業、チーム開発 |

### 言語プロファイル

言語プロファイルはインストール時に `--language` オプションで指定する。

```bash
bash install.sh --profile standard --language rust
bash install.sh --profile standard --language python
bash install.sh --profile standard --language typescript
bash install.sh --profile standard --language go
bash install.sh --profile standard --language cpp
```

代替:

```bash
npx vsdd-claude-code --profile standard --language typescript
```

各言語プロファイルには検証ツールの設定、テストコマンド、カバレッジコマンドがプリセットされている。Rust/Python/TypeScript は専用スキルも追加され、Go/C++ は manifest ベースのツールプロファイルとして動作する。

---

## VSDD 8原則

### 1. 仕様の優位性（Spec Supremacy）

仕様は実装よりも優先される。曖昧な仕様を前提に実装を進めることは許されない。実装が仕様と矛盾する場合は、実装を直す。

### 2. 検証ファースト設計（Verification-First Architecture）

何を検証するかを事前に設計する。検証可能性を後付けで追加することはコストが高い。検証アーキテクチャ（フェーズ1b）は仕様と同じタイミングで定義される。

### 3. グリーン前のレッド（Red Before Green）

テストは実装より先に書かれ、かつ最初は必ず失敗しなければならない。失敗しないテストは何も保証しない。

### 4. アンチスロップバイアス（Anti-Slop Bias）

「動いているように見える」は十分条件ではない。隠れた欠陥、仕様との乖離、エッジケースの見落としを体系的に探す姿勢を常に保つ。

### 5. 強制的な否定性（Forced Negativity）

adversaryエージェントは批判を義務付けられている。「問題なし」という結論は証拠なしに出せない。この強制的な否定性が、builderの自己評価バイアスを打ち消す。

### 6. 線形説明責任（Linear Accountability）

すべてのエージェントアクションはファイル成果物か状態遷移を生成する。会話の中だけで完結する作業は存在しない。Chainlinkビードがこの説明責任を実現する。

### 7. エントロピー抵抗（Entropy Resistance）

adversaryエージェントは必ず新鮮なコンテキストで起動する。builderとadversaryが同じ会話の文脈を共有することはない。この分離がコンテキスト汚染を防ぎ、独立したレビューを保証する。

### 8. 4次元収束（Four-Dimensional Convergence）

フェーズ6への移行は、以下の4つの条件がすべて満たされた場合にのみ許される。

1. 仕様が敵対的レビューを通過している
2. テストが十分なカバレッジを提供している
3. 実装がすべてのテストに通過している
4. 必要なすべての証明が通過している

---

## トレーサビリティチェーン

VSDDのChainlinkビードシステムは、すべての成果物を双方向にリンクする。以下は `user-auth` フィーチャーにおける典型的なチェーンの例だ。

```
REQ-001 [spec-requirement] active
  仕様: ユーザーは有効なメールアドレスとパスワードでログインできる
  |
  +-- PROP-001 [verification-property] proved
  |     検証: パスワードは常にハッシュ化されて保存される
  |
  +-- TEST-001 [test-case] passing
  |     テスト: tests/test_auth.py::test_login_valid_credentials
  |     |
  |     +-- IMPL-001 [implementation] implemented
  |           実装: src/auth.py:42-58 (authenticate関数)
  |
  +-- FIND-001 [adversary-finding] resolved
        指摘: レート制限が仕様に明記されているが実装されていない
        -> フェーズ2b へルーティング済み
```

`/vsdd-trace` コマンドで現在のフィーチャーのチェーン全体を表示できる。

---

## フックプロファイル表

この表は hooks bundle が導入されている前提の挙動を示す。install profile の `minimal` は hooks 自体を導入しない。

| フック | minimal | standard | strict |
|--------|---------|----------|--------|
| ゲート強制（PreToolUse: Write/Edit/Bash） | OFF | ON | ON |
| セッション開始コンテキスト（SessionStart） | OFF | ON | ON |
| セッション永続化（Stop） | OFF | ON | ON |
| コンパクト前チェックポイント（PreCompact） | OFF | ON | ON |
| 自動コミット（PostToolUse） | OFF | OFF | ON（要設定） |

strictプロファイルで自動コミットを有効にするには、環境変数 `VSDD_AUTO_COMMIT=true` を設定する。

このフラグを有効にしても、現在の feature / phase に属さない dirty file がある場合、自動コミットはスキップされる。通常運用では手動の `/vsdd-commit` が既定経路である。

---

## ランタイム状態ディレクトリ構造

VSDDは `.vsdd/` ディレクトリ配下にすべてのランタイム状態を保持する。

```
.vsdd/
  index.json              # 全フィーチャーのインデックス（activeFeature が canonical）
  active-feature.txt      # index.json.activeFeature のミラー
  history.jsonl           # 監査ログ
  features/
    <feature-name>/
      state.json          # パイプライン状態（フェーズ、モード、フラグ）
      specs/
        behavioral-spec.md        # フェーズ1aで生成
        verification-architecture.md
      contracts/
        sprint-{N}.md
      reviews/
        spec/
          iteration-{N}/
            input/
              manifest.json
            output/
              findings/
                FIND-NNN.json
              verdict.json
        contracts/
          sprint-{N}/
            input/
              manifest.json
            output/
              findings/
                FIND-NNN.json
              verdict.json
        sprint-{N}/
          input/
            manifest.json     # orchestratorがadversaryに渡すマニフェスト
          output/
            findings/
              FIND-NNN.json
            verdict.json      # adversaryが出力したPASS/FAILバイナリ判定
      evidence/
        sprint-{N}-red-phase.log
        sprint-{N}-green-phase.log
        sprint-{N}-coverage.json
      verification/
        proof-harnesses/      # フェーズ5で生成
        fuzz-results/
        mutation-results/
        verification-report.md
      escalations/
        escalation-{timestamp}.md
```

---

## スラッシュコマンド一覧

| コマンド | フェーズ | 説明 |
|---------|---------|------|
| `/vsdd-init` | - | フィーチャーパイプラインを初期化する |
| `/vsdd-spec` | 1a/1b | 行動仕様と検証アーキテクチャを記述する |
| `/vsdd-spec-review` | 1c | adversaryによる仕様レビューを実行する。strict では人手承認も必要 |
| `/vsdd-tdd` | 2a | 失敗するテストを生成する（Red） |
| `/vsdd-impl` | 2b/2c | テストを通過する最小実装を行い、その後リファクタする |
| `/vsdd-contract-review` | 2c | strict モードの sprint contract を adversary にレビューさせる |
| `/vsdd-adversary` | 3 | 敵対的レビューを実行する |
| `/vsdd-feedback` | 4 | adversaryの指摘を適切なフェーズへルーティングする |
| `/vsdd-harden` | 5 | 形式的強化を実行する |
| `/vsdd-converge` | 6 | 4次元収束を判定する |
| `/vsdd-status` | - | パイプラインの現在状態を表示する |
| `/vsdd-trace` | - | Chainlinkトレーサビリティチェーンを表示する |
| `/vsdd-commit` | - | フェーズタグ付きGitコミットを作成する |

---

## 参考資料

- **VSDDメソドロジー原典**: https://gist.github.com/dollspace-gay/d8d3bc3ecf4188df049d7a4726bb2a00
- **Anthropicハーネス設計（長時間実行アプリ向け）**: https://www.anthropic.com/engineering/harness-design-long-running-apps
- **everything-claude-code（ECCパターン集）**: https://github.com/affaan-m/everything-claude-code

---

## ライセンス

MIT。詳細は `package.json` を参照。
