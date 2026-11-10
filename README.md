# 自己映像の表示プロトタイプ

自分の映像を非表示・実写・アバターで切り替える、ローカル実行向けのプロトタイプです。アカウント、データベース、映像の録画機能はありません。

## 起動

- Node.js 20 以上と npm を用意します。
- `npm install`
- `npm run dev`
- 表示された `http://localhost:5173/` をデスクトップ版 Chrome で開き、「接続」を押します。
- 偶奇判定課題は別ターミナルで `npm run dev:parity` を実行し、表示されたURL（通常 `http://localhost:5174/`）を**別タブ**で開きます。5174番が使用中ならViteが次の空きポートを選びます。カメラ側（5173）とは独立して起動・停止できます。実験課題を開始する前にカメラ側で各表示条件を選び、実写・アバター条件では小窓を表示してください。
- 別のターミナルで `npm run depth:bridge` を実行すると、RealSense D415 の深度ストリームをローカル連携します。macOS では USB アクセスのため管理者パスワードが求められる場合があります。
- `npm run build` で本番ビルドします。
- 偶奇判定課題のみをビルドする場合は `npm run build:parity` を実行します。

## アーキテクチャ図

[自己映像表示・偶奇判定プロトタイプの構成図](docs/architecture.html) を参照してください。カメラアプリ、実験課題、RealSense 深度ブリッジ間のデータの流れを示しています。

深度カメラブリッジは別ターミナルで起動します。マイクやブラウザーのカメラ権限は使いません。

## Vercelへの公開

顔映像・アバターを表示するカメラシステムをVercelに公開しています。

- 公開URL: https://self-video-abstraction-prototype.vercel.app
- Vercel設定: Framework Preset `Vite`、Build Command `npm run build`、Output Directory `dist`

深度ブリッジはVercelには配置しません。RealSense D415をUSB接続した実験用PCで起動してください。Vercelのカメラ画面から接続するには、ブリッジの許可オリジンに上記URLを完全一致で登録します。`*.vercel.app`のような全体許可は使いません。Chromeがローカルネットワーク接続の確認を表示した場合は、このサイトからの接続を許可してください。

## Vercel画面からD415を使う

この手順は、Vercelのカメラ画面を開くPCにD415をUSB接続して実施します。深度ブリッジはそのPCの`127.0.0.1:8090`で動き、映像・深度をVercelへ送信しません。

1. 使用するPCにNode.js 20以上とGitを用意し、このリポジトリを取得して依存関係をインストールします。

   ```bash
   git clone https://github.com/shoooooma415/self-video-abstraction-prototype.git
   cd self-video-abstraction-prototype
   npm install
   ```

2. OSに応じてRealSense SDKとブリッジを準備します。

   **macOS**

   ```bash
   brew install librealsense
   npm run depth:bridge
   ```

   初回起動時にC++ブリッジをビルドします。macOSがUSBアクセスのため管理者パスワードを求めたら入力し、ターミナルは開いたままにします。

   **Ubuntu Linux 22.04 / 24.04**

   RealSenseの[公式Ubuntu配布手順](https://github.com/realsenseai/librealsense/blob/master/doc/distribution_linux.md)に従ってパッケージリポジトリを設定し、SDKと開発ファイルをインストールします。

   ```bash
   sudo apt-get update
   sudo apt-get install librealsense2-utils librealsense2-dev
   realsense-viewer
   ```

   ViewerでD415を認識することを確認して終了し、D415をUSB 3ポートに接続した状態でブリッジを起動します。

   ```bash
   npm run depth:bridge
   ```

   初回はC++ブリッジをビルドします。公式パッケージのudevルールが適用されていれば、通常は`sudo`なしで起動できます。カメラを認識しない場合は、公式ガイドのudevルールとカーネル要件を確認してください。

   **Windows 10 / 11**

   1. [RealSense SDK for Windows](https://github.com/realsenseai/librealsense/blob/master/doc/distribution_windows.md)をインストールします。インストーラーにはViewerと開発用ファイルが含まれます。
   2. Visual Studio 2019以降で「C++によるデスクトップ開発」をインストールします。
   3. Visual Studioの「Developer PowerShell」を開き、リポジトリのフォルダーに移動してからブリッジを起動します。初回はC++ブリッジをビルドします。

      ```powershell
      npm install
      npm run depth:bridge
      ```

      SDKを標準以外の場所にインストールした場合は、起動前にSDKフォルダーを指定します。

      ```powershell
      $env:REALSENSE_SDK_ROOT = 'C:\path\to\Intel RealSense SDK 2.0'
      npm run depth:bridge
      ```

   4. D415をUSB 3ポートに接続し、`realsense-viewer`で認識されることを確認します。認識されない場合は、Windowsの「設定」→「プライバシーとセキュリティ」→「カメラ」でデスクトップアプリのカメラアクセスを許可してください。

   `npm run depth:bridge`はWindowsではPowerShellスクリプトを呼び出し、Visual Studioの`cl.exe`でビルドします。SDKとVisual Studio C++ツールが見つからない場合は、Developer PowerShellで起動しているか確認してください。

3. 同じPCのデスクトップ版Chromeで[カメラシステム](https://self-video-abstraction-prototype.vercel.app)を開き、「接続」を押します。Chromeがローカルネットワークへのアクセスを確認した場合は許可します。「RealSense D415 接続中」と表示されれば接続できています。ブラウザーのカメラ権限は使いません。

4. 必要に応じて実験課題を別タブで開き、実写・アバター条件ではカメラシステムの「小窓で表示」を押してください。

ブリッジを停止するときは、起動したターミナルで`Ctrl+C`を押します。接続できない場合は、D415のUSB接続、ブリッジの起動、本番URLがブリッジの許可オリジンに完全一致で登録されていることを確認してください。

## 実験の進め方

### 1. 実験画面を準備する

1. カメラシステムを起動し、表示されたURL（通常 `http://localhost:5173/`）をChromeで開きます。
2. 課題システムを別ターミナルで起動します。

   ```bash
   npm run dev:parity
   ```

3. 課題システムのターミナルに表示されたURL（通常 `http://localhost:5174/`）を**別タブ**で開きます。5174番が使用中の場合は5175など別のポートが表示されるので、そのURLを使ってください。
4. カメラシステムで「接続」を押してカメラ映像を確認します。D415の深度を使う場合は、別ターミナルで `npm run depth:bridge` も起動します。

### 2. 条件ごとにセッションを実施する

1. 課題タブで参加者IDを入力し、目標条件（速度重視または正確性重視）、今回の表示条件（非表示・実写映像・アバター）、練習試行の有無を指定します。同意を確認してセッションを開始します。1セッションで実施する表示条件は1つです。
2. 練習試行を「あり」にした場合は8試行を行います。「なし」の場合は練習を省略して本番課題へ進みます。正誤フィードバックは練習中のみ表示されます。
3. 課題開始前にカメラタブで同じ条件を選びます。課題アプリ側の「実写映像」はカメラアプリ側の「実写映像」、「アバター」はカメラアプリ側の「アバター」に対応します。
4. 実写・アバター条件では、カメラタブの「小窓で表示」を押してから課題タブへ戻ります。非表示条件ではカメラタブで「非表示」を選びます。表示条件の切替後は、課題が終わるまでカメラタブを操作しないでください。
5. 課題では左右の数字の偶奇が同じなら `F`、異なるなら `J` を押します。問題表示前のキー入力は回答にならず、本番中は回答の正誤を表示しません。
6. 1条件につき96試行（16試行×6ブロック）です。各ブロックは同偶奇8問・異偶奇8問です。条件終了後、このセッションの結果をダウンロードします。別の表示条件も実施する場合は、同じ参加者IDで新しいセッションを開始し、その条件を指定します。条件ごとに別のセッションIDとデータファイルが作成されます。目標条件は参加者内で固定してください。

### 3. 結果を保存する

課題が終了すると「セッションが終了しました」画面が表示されます。**「CSV・JSONをダウンロード」**を押すと、そのセッション分のファイルがブラウザーのダウンロード先に保存されます。別の条件は別セッションとしてダウンロードしてください。ブラウザーが複数ファイルのダウンロードを確認した場合は許可してください。

- `*_trials.csv`: 回答、正誤、反応時間、条件、ブロック、刺激などの試行ログ
- `*_sessions.csv`: 参加者ID、目標条件、表示条件、練習試行の有無、刺激シード、ブラウザー情報など
- `*_events.csv`: ページ非表示やウィンドウのフォーカス喪失などの記録
- `*_experiment.json`: セッション全体と実験設定を含むJSON

試行ログは回答ごとにブラウザー内へ自動保存されますが、途中再開機能はありません。実施中は課題タブを再読み込み・終了せず、各セッションの終了画面でファイルをダウンロードしたことを確認してから次のセッションを開始してください。カメラ映像は録画・保存されません。

## 顔アバター

Three.js と three-vrm で VRM モデルを 3D 表示し、Face Landmarker の3D顔変換行列と blendshape で顔の向き・まばたき・口の動きを反映します。位置と大きさは D415 の深度・カメラ内部パラメーターで合わせます。AvatarSample_A（女性）とAvatarSample_C（男性）の2体を同梱し、起動時に順番に読み込んでモデル選択メニューから切り替えられます。読み込んだモデルはメモリに保持し、切り替え時に再解析しません。モデル別の利用条件は [third_party/AvatarSample_A_LICENSE.md](third_party/AvatarSample_A_LICENSE.md) と [third_party/AvatarSample_C_LICENSE.md](third_party/AvatarSample_C_LICENSE.md) を参照してください。

RealSense D415 の RGB 映像と深度フレームは `npm run depth:bridge` のローカルブリッジから取得します。ブリッジはカラー座標に整列した深度とカメラ内部パラメーターを返し、鼻位置の近傍深度からアバターの実距離・投影サイズを計算します。深度ブリッジ未接続時は、奥行きに合わせたアバター表示を行いません。

カメラ映像・顔ランドマーク・深度フレームは端末内で処理し、録画・保存・送信しません。Face Landmarker の WASM とモデルは初回利用時に配信元から取得します。VRM ファイルも端末内で読み込みます。内蔵 AvatarSample_A の条件は [third_party/AvatarSample_A_LICENSE.md](third_party/AvatarSample_A_LICENSE.md) に記載しています。

## 制限

利用する VRM モデルは各自で用意してください。MediaPipe の実行性能と表情追従の精度は端末・カメラ・モデルにより異なります。
