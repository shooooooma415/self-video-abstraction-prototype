# 自己映像の表示プロトタイプ

個人作業中に自分のカメラ映像を「シルエット」「実写」「非表示」で切り替える、ローカル実行向けのプロトタイプです。アンケート、アカウント、データベース、映像の保存機能はありません。

## 起動

- Node.js 20 以上と npm を用意します。
- `npm install`
- `npm run dev`
- 表示された `http://localhost:5173/` をデスクトップ版 Chrome で開き、「カメラを利用開始」を押します。
- `npm run build` で本番ビルドします。

カメラを使うには localhost または HTTPS が必要です。マイクは取得しません。

## 顔アバター

カメラ映像全体をそのまま表示し、Face Landmarker の顔ランドマークと blendshape で目・瞳・口の動きを追って顔だけを陰影のあるメッシュに置き換えます。顔が検出できない場合は、顔も加工せず元映像を表示します。

WASM は `@mediapipe/tasks-vision@1.1.0` を jsDelivr から、顔モデル `face_landmarker/face_landmarker/float16/1/face_landmarker.task` は Google MediaPipe model storage から初回利用時に取得します。映像フレームは端末内で処理し、録画・保存・送信しません。モデルを取得するため初回利用時はネットワーク接続が必要です。

## 小窓表示と制限

対応 Chrome では「小窓表示を開く」ボタンから Document Picture-in-Picture を開きます。非対応環境はブラウザ内表示のみです。OS 全体での常時最前面は保証しません。

カメラ許可/拒否、3 条件の表示、シルエット検出、小窓表示を実機で確認してください。MediaPipe の実行性能は端末により異なります。
