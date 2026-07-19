// パート名（LocalPracticeApp の INSTRUMENT_OPTIONS）ごとの出欠画像送信先チャンネルID。
// ユーフォニアムと低音はSlack上で同一チャンネルのため、同じIDを指定している。
export const PART_SLACK_CHANNELS: Record<string, string> = {
  "ふるぼえ": "C0AMZR7TPGF",
  "クラリネット": "C0AP9H5FMJL",
  "サックス": "C0ANBS7RASZ",
  "トランペット": "C0ANF96CBMG",
  "トロンボーン": "C0AMZRFSFN3",
  "ホルン": "C0AMZRHRBJT",
  "ユーフォニアム": "C0ANF8W4N3C",
  "低音": "C0ANF8W4N3C",
  "パーカッション": "C0AP9HCKVPS"
};
