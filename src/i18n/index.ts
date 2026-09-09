export type Locale = "en" | "ja";

export interface Translations {
  leaderboardTitle: string;
  dataset: string;
  judge: string;
  run: string;
  rank: string;
  model: string;
  overall: string;
  properNounF1: string;
  propositionRecall: string;
  propositionPrecision: string;
  propositionF1: string;
  hallucinationRate: string;
  rtf: string;
  latency: string;
  audioDuration: string;
  samples: string;
  reportTitle: string;
  evalTimestamp: string;
  leaderboardSection: string;
  sampleDetails: string;
  sample: string;
  groundTruth: string;
  hypothesis: string;
  score: string;
  noOutput: string;
  notSet: string;
  checkItem: string;
  verdict: string;
  reasonAndEvidence: string;
  passBadge: string;
  failBadge: string;
  reliabilitySection: string;
  ciColumn: string;
  termRecall: string;
  latencyPercentiles: string;
  emptyOutputs: string;
  pairwiseSection: string;
  adjustedCi: string;
  significantAdjusted: string;
  significantUnadjusted: string;
  notSignificant: string;
  pairwiseNote: string;
  itemSection: string;
  conditionsSection: string;
  judgeSettings: string;
  parameters: string;
  provider: string;
  usageSection: string;
  audioLength: string;
  asrInputTokens: string;
  asrOutputTokens: string;
  asrCost: string;
  judgeInputTokens: string;
  judgeOutputTokens: string;
  judgeCost: string;
  totalCost: string;
  costTotalsRow: string;
  estimatedNote: string;
  noPricingNote: string;
  axes: {
    proper_noun_f1: string;
    proposition_recall: string;
    proposition_precision: string;
    proposition_f1: string;
  };
}

export const messages: Record<Locale, Translations> = {
  en: {
    leaderboardTitle: "KIKITORI-BENCH LEADERBOARD",
    dataset: "Dataset",
    judge: "Judge",
    run: "Run",
    rank: "Rank",
    model: "Model",
    overall: "Overall",
    properNounF1: "Names",
    propositionRecall: "Recall",
    propositionPrecision: "Precision",
    propositionF1: "F1",
    hallucinationRate: "Hallucinations / min",
    rtf: "RTF",
    latency: "Latency",
    audioDuration: "Duration",
    samples: "Samples",
    reportTitle: "Speech Recognition Benchmark Report",
    evalTimestamp: "Evaluation Timestamp",
    leaderboardSection: "Aggregate Leaderboard",
    sampleDetails: "Per-Sample Evaluation & Evidence",
    sample: "Sample",
    groundTruth: "Ground Truth",
    hypothesis: "Hypothesis",
    score: "Score",
    noOutput: "*(no output)*",
    notSet: "(not set)",
    checkItem: "Check Item",
    verdict: "Verdict",
    reasonAndEvidence: "Reason / Evidence",
    passBadge: "PASS (1)",
    failBadge: "FAIL (0)",
    reliabilitySection: "Reliability & Deterministic Checks",
    ciColumn: "95% CI",
    termRecall: "Proper-noun recall",
    latencyPercentiles: "Latency p50 / p95",
    emptyOutputs: "Empty outputs",
    pairwiseSection: "Is the ranking real?",
    adjustedCi: "Adjusted CI",
    significantAdjusted: "significant after multiple-comparison adjustment",
    significantUnadjusted: "significant unadjusted only",
    notSignificant: "not distinguishable",
    pairwiseNote:
      "Every pair, not just rank-adjacent ones - a chain of indistinguishable neighbours says nothing about the models at the two ends. Paired bootstrap of the per-sample difference (same audio for every model), Bonferroni-adjusted for the number of pairs, plus an exact McNemar test per axis.",
    itemSection: "Item analysis",
    conditionsSection: "Experiment Conditions",
    judgeSettings: "Judge settings",
    parameters: "Request parameters",
    provider: "Provider",
    usageSection: "Token Usage & Cost",
    audioLength: "Audio",
    asrInputTokens: "ASR in (audio/text)",
    asrOutputTokens: "ASR out",
    asrCost: "ASR cost",
    judgeInputTokens: "Judge in (cached)",
    judgeOutputTokens: "Judge out (reasoning)",
    judgeCost: "Judge cost",
    totalCost: "Total",
    costTotalsRow: "TOTAL",
    estimatedNote:
      "`~` marks a cost estimated from audio length because the provider returned no token counts.",
    noPricingNote:
      "`-` in a token column means the provider reports no token counts (duration-billed API); in a cost column it means no price list is configured in `kikitori.config.yaml`.",
    axes: {
      proper_noun_f1: "Proper-noun F1",
      proposition_recall: "Proposition recall",
      proposition_precision: "Proposition precision",
      proposition_f1: "Proposition F-beta"
    }
  },
  ja: {
    leaderboardTitle: "音声認識ベンチマーク リーダーボード",
    dataset: "データセット",
    judge: "ジャッジモデル",
    run: "実行ID",
    rank: "順位",
    model: "モデル名",
    overall: "総合スコア",
    properNounF1: "固有名詞",
    propositionRecall: "命題再現(R)",
    propositionPrecision: "命題精度(P)",
    propositionF1: "F値",
    hallucinationRate: "幻覚挿入 / 分",
    rtf: "RTF",
    latency: "平均レイテンシ",
    audioDuration: "音声長",
    samples: "サンプル数",
    reportTitle: "音声認識ベンチマーク結果レポート",
    evalTimestamp: "評価日時",
    leaderboardSection: "総合リーダーボード",
    sampleDetails: "サンプル別 評価詳細・判定根拠",
    sample: "サンプル",
    groundTruth: "正解テキスト (Ground Truth)",
    hypothesis: "文字起こし結果 (Hypothesis)",
    score: "スコア",
    noOutput: "*(出力なし)*",
    notSet: "(未設定)",
    checkItem: "チェック項目",
    verdict: "判定",
    reasonAndEvidence: "理由 / 判定根拠",
    passBadge: "合格 (1)",
    failBadge: "不合格 (0)",
    reliabilitySection: "統計的信頼性と決定的チェック",
    ciColumn: "95%信頼区間",
    termRecall: "固有名詞再現率",
    latencyPercentiles: "レイテンシ p50 / p95",
    emptyOutputs: "空出力",
    pairwiseSection: "この順位は実在するか",
    adjustedCi: "多重比較補正後CI",
    significantAdjusted: "補正後も有意",
    significantUnadjusted: "補正前のみ有意",
    notSignificant: "区別できない",
    pairwiseNote:
      "隣接順位だけでなく全ペアを比較しています（隣接ペアで差が出ないことを繋げても、両端に差がないことは導けません）。同一音声に対するサンプル別差分のペアブートストラップをペア数でBonferroni補正し、軸ごとにMcNemar厳密検定を併記しています。",
    itemSection: "アイテム分析",
    conditionsSection: "実験条件",
    judgeSettings: "ジャッジ設定",
    parameters: "リクエストパラメータ",
    provider: "プロバイダ",
    usageSection: "消費トークンとコスト",
    audioLength: "音声長",
    asrInputTokens: "ASR入力 (音声/テキスト)",
    asrOutputTokens: "ASR出力",
    asrCost: "ASRコスト",
    judgeInputTokens: "判定入力 (キャッシュ)",
    judgeOutputTokens: "判定出力 (推論)",
    judgeCost: "判定コスト",
    totalCost: "合計",
    costTotalsRow: "合計",
    estimatedNote:
      "`~` はプロバイダがトークン数を返さないため音声長から見積もったコストです。",
    noPricingNote:
      "トークン列の `-` はプロバイダがトークン数を返さない（音声長課金の）API、コスト列の `-` は `kikitori.config.yaml` に単価未設定であることを示します。",
    axes: {
      proper_noun_f1: "固有名詞F1",
      proposition_recall: "命題再現率 (Recall)",
      proposition_precision: "命題精度 (Precision)",
      proposition_f1: "命題F値"
    }
  }
};

export const getLocale = (): Locale => {
  const envLang = process.env["KIKITORI_LANG"] || process.env["LANG"] || "";
  return envLang.toLowerCase().startsWith("ja") ? "ja" : "en";
};

export const t = (locale?: Locale): Translations => messages[locale ?? getLocale()];
