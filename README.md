# Silent Cam PWA

iPhoneのホーム画面に追加して使う、音を鳴らさずに撮影できるカメラPWAです。

## Features

- iPhone向けのホーム画面PWA設定
- `getUserMedia` によるカメラ起動
- 音声トラックなしの静止画撮影
- 背面/前面カメラ切替
- 対応端末でのライト切替
- 直近写真のローカル保存とダウンロード
- Service Workerによる静的アセットのキャッシュ

## Local Preview

```bash
python -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173
```

## iPhone Usage

Camera access requires a secure context. Deploy this app over HTTPS, open it in Safari, then use Share > Add to Home Screen.
