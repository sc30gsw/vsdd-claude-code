# vcsdd-claude-code

![バージョン](https://img.shields.io/badge/version-1.0.0-blue)
![ライセンス](https://img.shields.io/badge/license-MIT-green)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-orange)

**言語**: [English](../../README.md)

**Verified Coherence Spec-Driven Development (VCSDD)** をあらゆるプロジェクトにもたらす Claude Code プラグイン。

---

## VCSDDとは

AI支援開発は生産性を大きく向上させる一方で、構造的な品質ゲートが欠落しやすいという問題を抱えています。テストは通過するが仕様とは乖離している、レビューでは問題が見つからないが本番で障害が発生する、といった「AIスロップ（AI slop）」と呼ばれる現象がその代表例です。AIスロップとは、表面上は正しく見えながら隠れた欠陥を持つコードのことを指します。

VCSDDはこの問題に対して、以下の4つの手法を統合した体系的なワークフローで応答します。

- **SDD（Spec-Driven Development）**: 仕様を実装の起点に据える
- **TDD（Test-Driven Development）**: テストをコードより先に書く
- **VDD（Verification-Driven Development）**: 形式検証を品質保証の仕上げに使う
- **CoDD（Coherence-Driven Development）**: 追跡対象の成果物どうしの依存関係を記録し、要件変更が発生した際に下流の設計書や宣言済み実装モジュールへ変更を伝播させる

これらに加え、builderエージェントとは独立した**敵対的レビュー（Adversarial Review）**を組み合わせることで、AIスロップを体系的に排除します。

---

## 主な特徴

### 6フェーズパイプライン

仕様記述から収束判定まで、すべての作業を明確なフェーズに分割して進めます。フェーズをまたぐ作業は許可されず、各フェーズ完了時に品質ゲートが走ります。

| フェーズ | 名称 | 内容 |
|---------|------|------|
| 1a | 行動仕様 | EARS形式の要件定義、エッジケースカタログ |
| 1b | 検証アーキテクチャ | 純粋性境界マップ、証明義務の定義 |
| 1c | 仕様レビューゲート | canonical VCSDD では adversary と人間の両方がレビューする。このプラグインは strict で人手承認を必須にし、lean では任意に緩和する |
| 2a | テスト生成（Red） | 必ず失敗するテストを先に書く |
| 2b | 実装（Green） | テストを通過させる最小実装 |
| 2c | リファクタ | グリーンを維持しながら構造を改善 |
| 3 | 敵対的レビュー | 新鮮なコンテキストのadversaryエージェントによる審査 |
| 4 | フィードバック統合 | 指摘事項を適切なフェーズへルーティング |
| 5 | 形式的強化 | 検証ティアに応じた形式証明の実行 |
| 6 | 収束判定 | 4次元収束が達成された場合のみ完了 |

### 2つの動作モード

**strictモード**は高保証作業向けの完全な VCSDD セレモニーを提供します。**leanモード**も全6フェーズを通過しますが、承認、スプリント契約、証明義務を軽量化してプロダクト開発や試作に向けた運用をしやすくします。詳細は[動作モード比較表](#動作モード比較表)を参照してください。

これらのモードはプラグイン独自の拡張であり、canonical VCSDD 自体が 2 種類のセレモニーを定義しているという意味ではありません。canonical VCSDD では Phase 1c の仕様ゲートで Human Architect の sign-off を前提とし、このプラグインはその期待を `strict` ではハードゲートとして保持し、`lean` では高速なプロダクト開発向けに緩和しています。

### adversaryエージェント（opusモデル、レビュー出力専用）

adversaryエージェントはVCSDDの中核的な品質ゲートです。以下の制約のもとで動作します。

- **新鮮なコンテキストで必ず起動する**: builderエージェントの文脈を一切引き継がない
- **レビュー出力以外は書き込まない**: `reviews/**/output/` 配下に verdict と findings を出力する以外、仕様・コード・テストは変更しない
- **「全体的に良さそう」と言うことが禁止されている**: 明確な証拠に基づいたバイナリ PASS/FAIL の判定のみが許される

adversaryエージェントは以下の5つの運用次元で PASS/FAIL を判定します。

1. 仕様忠実性（Spec Fidelity）
2. エッジケースカバレッジ（Edge Case Coverage）
3. 実装正確性（Implementation Correctness）
4. 構造的健全性（Structural Integrity）
5. 検証準備状態（Verification Readiness）

これはプラグインの安定した機械可読 verdict 形式であり、VCSDD 原文がこのままの 5 次元名を定義しているという意味ではありません。方法論上は、仕様忠実性、エッジケースを含むテスト品質、コード品質、セキュリティサーフェス、仕様ギャップや verification readiness をこの 5 つのバケットに圧縮しています。

### Chainlinkビードトレーサビリティシステム

すべてのコード行を仕様要件まで追跡できます。すべての成果物（仕様・テスト・実装・指摘・証明）がビードとして記録され、REQ-XXX から PROOF-XXX まで双方向リンクで結ばれます。
persisted な adversary finding に対応する `adversary-finding` ビードが存在しない場合、完了できません。

詳細は[トレーサビリティチェーン](#トレーサビリティチェーン)を参照してください。

### Claude Codeフックによるゲート強制

PreToolUseフックがフェーズ外の `Write`/`Edit` および、リダイレクト等でソースやテストへ書き込む可能性のある `Bash` をヒューリスティックにブロックします。開発者が誤って作業順序を飛ばすことを防ぎます。

### Coherence エンジン（CoDD統合）

要件が途中で変わったとき、Coherence エンジンがどの追跡対象成果物へ影響が及ぶかを追跡し、コードに触れる前に信頼度バンドで分類します。`scripts/lib/vcsdd-coherence.js` にネイティブ実装され、グラフは `.vcsdd/features/<name>/coherence.json` に保存されます。

- **CEG（Conditioned Evidence Graph）**: 仕様ドキュメントと宣言済み実装モジュールの有向依存グラフ。Markdown ファイルの `coherence:` フロントマターから構築され、upstream CoDD 互換として `codd:` も受け付ける
- **Noisy-OR 信頼度スコアリング**: 証拠ベースのエッジ重みを集約して Green（≥90%）/ Amber（≥50%）/ Gray（<50%）のインパクトバンドに分類する
- **BFS 前方インパクト伝播**: 仕様が変更されたとき、すべての下流ノードをトレースし、影響を受けるドキュメントを見逃さない
- **DFS 循環検出**: 仕様グラフの循環依存を伝播前に検出し防止する
- **CoDD流モジュールトレーサビリティ**: `modules:` フロントマターから `module:*` ノードと technical edge を生成し、spec 変更時に影響を受ける実装モジュールを表面化する
- **ファイルパストレーサビリティ**: `source_files:` は参照用のファイルパスを保存する。前方 impact 伝播は生のパス一覧ではなく、上記グラフエッジで判定する
- **参照整合性強制**: 未解決の参照（dangling reference）やプレースホルダーノードは Phase 2a ゲートのハードエラーとなる。壊れたグラフは修正するまで red phase への遷移をブロックする
- **オプトイン**: spec のフロントマターに `coherence:` を書いたとき、または既存の `coherence.json` を追跡しているときに有効化される。coherence metadata を持たない通常の VCSDD feature は完全に no-op のまま。オプトイン後は、dangling 参照・循環依存・不正な frontmatter・ランタイムエラーが Phase 2a ゲートをブロックする。破損した `coherence.json` は `coherence.json.bak` に退避したうえで、現在の frontmatter から再構築される
- **自動リフレッシュフック**: `standard` / `strict` hook profile では、spec 編集後に `coherence.json` を自動再構築する

> **注意:** coherence scan および impact 分析は LLM による支援であり、自動化された静的解析ではありません。CEG（`coherence.json`）は `/vcsdd-coherence-scan`、`/vcsdd-coherence-validate`、Phase 2a ゲート、または `vcsdd-coherence-refresh` PostToolUse フックで更新されます。これらを経由しない spec 変更では古い CEG が残り、BFS impact 分析を誤らせる可能性があります。

### 言語プロファイル

言語固有の検証ツールヒントをプリセットで提供します。以下は現在バンドルされている runtime ヒントに対応します。

| 言語 | 現在バンドルされる主なヒント |
|------|----------------------------|
| Rust | `proptest` / `cargo-fuzz` / `cargo-mutants`、Tier 2 検証として `kani`、Tier 3 フォールバックとして `cbmc` |
| Python | `hypothesis` / `mutmut` |
| TypeScript | `fast-check` / `@stryker-mutator/core` |
| Go | `rapid` / `go-fuzz` |
| C/C++ | `libFuzzer` / `CBMC` |

### フェーズタグ付きGit統合

`/vcsdd-commit` はフェーズ識別子、ビード要約、成果物マニフェストを含むコミットメッセージを生成します。オプションの自動コミットは、アクティブな feature と現在 phase に属するファイルだけをステージし、既存タグを上書きせずに `vcsdd/<feature>/phase-<id>` タグを作成します。

---

## アーキテクチャ

### 方法論上の役割とランタイムエージェント

canonical VCSDD が定義するのは Human Architect、Builder、Tracker（Chainlink）、Adversary の 4 役割です。このプラグインでは、Human Architect はプラグイン外の受け入れ責任者として残り、Tracker はビードグラフと `history.jsonl` として実装され、実行補助として `vcsdd-orchestrator` と `vcsdd-verifier` を追加しています。

### 4ランタイムエージェント

| エージェント | モデル | ツール権限 | 役割 | 主な制約 |
|-------------|--------|-----------|------|---------|
| vcsdd-orchestrator | sonnet | Read, Write, Glob, Grep, Bash | パイプライン調整、ゲート強制 | ゲートチェックをスキップしない |
| vcsdd-builder | sonnet | Read, Write, Edit, Bash, Glob, Grep | 仕様記述、TDD実装 | フェーズ対応ファイルへの書き込みのみ |
| vcsdd-adversary | **opus** | Read, Write, Edit, Grep, Glob | 敵対的レビュー | `reviews/**/output/` のみ書込可、毎回新鮮なコンテキスト |
| vcsdd-verifier | sonnet | Read, Write, Edit, Bash, Grep, Glob | 形式検証の調整 | `verification/**` と `state.json` の proof 更新、言語プロファイル対応 |

### ファイルベース通信

エージェント間の通信は会話ではなくファイルを介して行われます。`.vcsdd/features/<name>/` ディレクトリがすべての中継点として機能します。orchestratorがレビューマニフェストをディスクに書き込み、adversaryはそれを読み取ってverdictを返します。

### コンポーネント構成

| コンポーネント | 数量 | 説明 |
|--------------|------|------|
| スラッシュコマンド | 17 | `/vcsdd-init` から `/vcsdd-coherence-validate` まで |
| スキル | 30 | スラッシュコマンド補助、方法論コア、言語プロファイル、Coherence |
| JSONスキーマ | 7 | state, bead, finding, grading, coherence など |

---

## クイックスタート

### ステップ1: プラグインをインストールする

**方法1: Claude Code プラグインシステム（推奨）**

```bash
# マーケットプレイスとして登録（初回のみ）
/plugin marketplace add sc30gsw/vcsdd-claude-code

# プラグインをインストール
/plugin install vcsdd@vcsdd-claude-code

# プラグインを再読み込み
/reload-plugins
```

インストール後、スキルは `/vcsdd:init`、`/vcsdd:spec`、`/vcsdd:adversary` のように呼び出せます。

**方法2: インストールスクリプト**

```bash
git clone https://github.com/sc30gsw/vcsdd-claude-code.git
cd vcsdd-claude-code

# standardプロファイルでインストール
bash install.sh --profile standard

# TypeScript言語プロファイルを追加する場合
bash install.sh --profile standard --language typescript
```

**方法3: パッケージマネージャー**

```bash
npx vcsdd-claude-code --profile standard
pnpm dlx vcsdd-claude-code --profile standard
```

インストール後は **Claude Codeを再起動**（またはウィンドウをリロード）してプラグインを有効化してください。`/vcsdd-status`（インストールスクリプト）または `/vcsdd:status`（プラグインシステム）で動作確認できます。

### ステップ2: フィーチャーパイプラインを開始する

```bash
# user-authフィーチャーをleanモードで初期化
/vcsdd-init user-auth --mode lean

# フェーズ1a + 1b: 行動仕様と検証アーキテクチャの記述
/vcsdd-spec

# フェーズ1c: canonical VCSDD では adversary review に加えて人間の sign-off を期待する。
# このプラグインは strict でそれを必須にし、lean では任意に緩和する。
/vcsdd-spec-review

# フェーズ2a: 失敗するテストの生成（Red）
/vcsdd-tdd
# 2a への遷移時に、この実装サイクル用の sprint 1 が開始される

# フェーズ2b + 2c: 実装して Green にし、その後リファクタ
/vcsdd-impl
# canonical VCSDD の推奨チェックポイント: Phase 3 前に人間がテストと実装を読み、
# 仕様の spirit と一致しているか確認する

# strict モードのみ: sprint contract を adversary がレビュー
/vcsdd-contract-review
# PASS 後に status 以外を変更した場合は再レビューが必要

# フェーズ3: 敵対的レビュー（新鮮なコンテキストのopusエージェントが審査）
/vcsdd-adversary

# フェーズ4: FAIL 時は指摘をルーティング
/vcsdd-feedback

# フェーズ5: 形式的強化
# leanモードでも verification-report.md / security-report.md / purity-audit.md は必ず生成される。
# required な証明義務がゼロでも、security と purity の監査成果物は必須。
/vcsdd-harden

# フェーズ6: 4次元収束を確認
/vcsdd-converge

# パイプラインの現在状態を確認
/vcsdd-status

# トレーサビリティチェーンを表示
/vcsdd-trace REQ-001

# --- 任意: コヒーレンスエンジン（CoDD）---
# 仕様ファイルの `coherence:` / `codd:` フロントマターから CEG を再構築する
/vcsdd-coherence-scan

# インパクト分析を実行する。
# node_id を省略した場合は git diff HEAD から変更ファイルを自動検出し、CEG の開始ノードへ解決する。
# 過去比較は --diff HEAD~1、明示指定したい場合は node_id を渡す。
/vcsdd-coherence-impact
/vcsdd-coherence-impact --diff HEAD~1
/vcsdd-coherence-impact design:system-design

# CEG の参照整合性と循環依存をチェックする
/vcsdd-coherence-validate
```

---

## パイプライン状態機械

```
init -> 1a -> 1b -> 1c -> 2a -> 2b -> 2c -> 3 -> 4 -> [1a|1b|2a|2b|2c|5] -> 5 -> 6 -> complete
                                                      （coherence コマンドはどのフェーズでも任意に実行可能）
                                                                             ^
                                                                     収束ループ（最大2回）
```

フェーズ4（フィードバック統合）では、adversaryの指摘内容に応じて適切なフェーズへルーティングされます。runtime 上も `3 -> 4 -> 対象フェーズ` を明示的に記録し、現在の sprint の persisted finding が要求する最も早い `routeToPhase` を飛ばすルーティングは拒否します。

strict モードでは追加で以下を強制します。

- フェーズ3前: `contracts/sprint-{N}.md` は `status: approved` で、contract review verdict の `reviewContext.contractPath` と `reviewContext.contractDigest` が現在の契約に一致している必要があります
- フェーズ6前: `verification-report.md` / `security-report.md` / `purity-audit.md` が必要セクション付きで存在し、いずれもフェーズ5突入後に生成されており、`verification/security-results/` にもフェーズ5突入後の実行痕跡ファイルが少なくとも1つあり、required な proof obligation はすべて `proved` である必要があります。strict ではさらに `convergenceSignals.allCriteriaEvaluated = true` に加えて `convergenceSignals.evaluatedCriteria` が承認済み contract の `CRIT-XXX` 集合と完全一致している必要があります
- 収束ループが 2 回目以降なら、完了前に `convergenceSignals.findingCount < convergenceSignals.previousFindingCount` も必要になります

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
| adversaryレビュー | 複数ラウンド（フェーズ3は最大5回） | 短縮ラウンド（フェーズ3は最大3回） |
| 仕様レビュー時の人手承認 | 必須。canonical VCSDD の期待と一致 | 任意のプラグイン緩和。canonical VCSDD 自体は sign-off を期待する |
| 証明義務 | required な義務を強制 | 選択的。required が 0 件でもよい |
| 形式的強化成果物 | `verification-report.md` / `security-report.md` / `purity-audit.md` | `verification-report.md` / `security-report.md` / `purity-audit.md` |
| イテレーション速度 | 低速（高保証） | 高速 |
| 推奨フロー | 全6フェーズを完全に実行 | 全6フェーズを維持しつつ運用を軽量化 |

`--mode`、install profile、`VCSDD_HOOK_PROFILE` は別軸の設定です。`/vcsdd-init --mode strict` を使ってもフックプロファイルは自動で `strict` に切り替わらず、逆に `install.sh --profile strict` を実行しても feature の `state.json.mode` は変更されません。

---

## インストールオプション

### インストールプロファイル

```bash
# minimal: docs / manifests / schemas / rules / commands / core runtime を導入
bash install.sh --profile minimal

# standard: contexts / agents / skills / hooks を含むフルワークフロー（推奨）
bash install.sh --profile standard

# strict: standard と同じファイル群を高保証運用向けに導入する。
# strict な runtime 挙動にしたい場合は /vcsdd-init --mode strict と VCSDD_HOOK_PROFILE=strict を併用する
bash install.sh --profile strict
```

代替:

```bash
npx vcsdd-claude-code --profile standard
```

| プロファイル | 内容 | 適用シーン |
|------------|------|----------|
| minimal | docs + manifests + schemas + rules + commands + core runtime | 試用、軽量な利用 |
| standard | + agents, skills, contexts, hooks, scripts, coherence engine（未指定時の hook profile は `standard`） | 通常の開発作業 |
| strict | standard と同じファイル構成（coherence engine 含む）。必要なら `VCSDD_HOOK_PROFILE=strict` を明示して厳しいフックマップを使う | 高保証作業、チーム開発 |

### 言語プロファイル

言語プロファイルはインストール時に `--language` オプションで指定します。

```bash
bash install.sh --profile standard --language rust
bash install.sh --profile standard --language python
bash install.sh --profile standard --language typescript
bash install.sh --profile standard --language go
bash install.sh --profile standard --language cpp
```

代替:

```bash
npx vcsdd-claude-code --profile standard --language typescript
```

各言語プロファイルには検証ツールの設定、テストコマンド、カバレッジコマンドがプリセットされています。Rust/Python/TypeScript は専用スキルも追加され、Go/C++ は manifest ベースのツールプロファイルとして動作します。

runtime が参照する正規のツールヒントは `manifests/language-profiles.json` にあり、この README では現在バンドルされている内容だけを要約しています。

---

## VCSDD 8原則

### 1. 仕様の優位性（Spec Supremacy）

仕様は実装よりも優先されます。曖昧な仕様を前提に実装を進めることは許されません。実装が仕様と矛盾する場合は、実装を直します。

### 2. 検証ファースト設計（Verification-First Architecture）

何を検証するかを事前に設計します。検証可能性を後付けで追加することはコストが高いです。検証アーキテクチャ（フェーズ1b）は仕様と同じタイミングで定義されます。

### 3. グリーン前のレッド（Red Before Green）

テストは実装より先に書かれ、かつ最初は必ず失敗しなければなりません。失敗しないテストは何も保証しません。

### 4. アンチスロップバイアス（Anti-Slop Bias）

「動いているように見える」は十分条件ではありません。隠れた欠陥、仕様との乖離、エッジケースの見落としを体系的に探す姿勢を常に保ちます。

### 5. 強制的な否定性（Forced Negativity）

adversaryエージェントは批判を義務付けられています。「問題なし」という結論は証拠なしに出せません。この強制的な否定性が、builderの自己評価バイアスを打ち消します。

### 6. 線形説明責任（Linear Accountability）

すべてのエージェントアクションはファイル成果物か状態遷移を生成します。会話の中だけで完結する作業は存在しません。Chainlinkビードがこの説明責任を実現します。

### 7. エントロピー抵抗（Entropy Resistance）

adversaryエージェントは必ず新鮮なコンテキストで起動します。builderとadversaryが同じ会話の文脈を共有することはありません。この分離がコンテキスト汚染を防ぎ、独立したレビューを保証します。

### 8. 4次元収束（Four-Dimensional Convergence）

フェーズ6への移行は、以下の4つの条件がすべて満たされた場合にのみ許されます。

1. 仕様が敵対的レビューを通過している
2. テストが十分なカバレッジを提供している
3. 実装がすべてのテストに通過している
4. 必要なすべての証明が通過している

---

## トレーサビリティチェーン

VCSDDのChainlinkビードシステムは、すべての成果物を双方向にリンクします。以下は `user-auth` フィーチャーにおける典型的なチェーンの例です。

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

`/vcsdd-trace` コマンドで現在のフィーチャーのチェーン全体を表示できます。

---

## フックプロファイル表

この表は hooks bundle が導入されている前提の挙動を示します。install profile の `minimal` は hooks 自体を導入しません。

| フック | minimal | standard | strict |
|--------|---------|----------|--------|
| ゲート強制（PreToolUse: Write/Edit/Bash） | OFF | ON | ON |
| セッション開始コンテキスト（SessionStart） | ON | ON | ON |
| セッション永続化（Stop） | ON | ON | ON |
| コンパクト前チェックポイント（PreCompact） | OFF | ON | ON |
| coherence 自動リフレッシュ（PostToolUse: spec Write/Edit/MultiEdit） | OFF | ON | ON |
| 自動コミット（PostToolUse: Write/Edit/MultiEdit） | OFF | OFF | ON（要設定） |

feature の mode と hook profile は独立しています。`VCSDD_HOOK_PROFILE=minimal` を使うと、ゲート強制を切りつつセッション系フックだけを維持できます。

strictプロファイルで自動コミットを有効にするには、環境変数 `VCSDD_AUTO_COMMIT=true` を設定します。

このフラグを有効にしても、現在の feature / phase に属さない dirty file がある場合、自動コミットはスキップされます。通常運用では手動の `/vcsdd-commit` が既定経路です。

---

## ランタイム状態ディレクトリ構造

VCSDDは `.vcsdd/` ディレクトリ配下にすべてのランタイム状態を保持します。

```
.vcsdd/
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
        security-results/     # security tool の生出力。少なくとも1ファイル必要
        verification-report.md
        security-report.md
        purity-audit.md
      escalations/
        escalation-{timestamp}.md
      coherence.json        # CEG（任意。存在しない場合はコヒーレンスエンジンは no-op）
```

---

## スラッシュコマンド一覧

| コマンド | フェーズ | 説明 |
|---------|---------|------|
| `/vcsdd-init` | - | フィーチャーパイプラインを初期化する |
| `/vcsdd-spec` | 1a/1b | 行動仕様と検証アーキテクチャを記述する |
| `/vcsdd-spec-review` | 1c | canonical VCSDD では adversary と人間の両方による仕様レビューを想定する。このプラグインは strict で人手承認を必須にし、lean では任意に緩和する |
| `/vcsdd-tdd` | 2a | 失敗するテストを生成する（Red） |
| `/vcsdd-impl` | 2b/2c | テストを通過する最小実装を行い、その後リファクタする |
| `/vcsdd-contract-review` | 2c | strict モードの sprint contract を adversary にレビューさせる |
| `/vcsdd-adversary` | 3 | 敵対的レビューを実行する |
| `/vcsdd-feedback` | 4 | adversaryの指摘を適切なフェーズへルーティングする |
| `/vcsdd-harden` | 5 | 形式的強化を実行する |
| `/vcsdd-converge` | 6 | 4次元収束を判定する |
| `/vcsdd-escalate` | - | architect のエスカレーション承認を記録する |
| `/vcsdd-status` | - | パイプラインの現在状態を表示する |
| `/vcsdd-trace` | - | Chainlinkトレーサビリティチェーンを表示する |
| `/vcsdd-commit` | - | フェーズタグ付きGitコミットを作成する |
| `/vcsdd-coherence-scan` | - | 仕様ファイルのフロントマターから CEG を再構築する |
| `/vcsdd-coherence-impact` | - | 変更された仕様ノードから BFS 変更インパクト分析を実行する |
| `/vcsdd-coherence-validate` | - | CEG の参照整合性チェックと循環依存検出を行う |

---

## 参考資料

- **VCSDDメソドロジー原典**: https://gist.github.com/dollspace-gay/d8d3bc3ecf4188df049d7a4726bb2a00
- **Anthropicハーネス設計（長時間実行アプリ向け）**: https://www.anthropic.com/engineering/harness-design-long-running-apps
- **everything-claude-code（ECCパターン集）**: https://github.com/affaan-m/everything-claude-code
- **CoDD（Coherence-Driven Development）**: https://github.com/yohey-w/codd-dev
- **CoDD — Coherence Engine解説**（Zenn記事）: https://zenn.dev/shio_shoppaize/articles/shogun-codd-coherence

---

## ライセンス

MIT。詳細は `package.json` を参照してください。
