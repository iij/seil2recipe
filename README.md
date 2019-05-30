# SEIL Legacy Config to Recipe Config Converter
[SEILコンフィグ自動変換ツール](https://iij.github.io/pages/seil2recipe/) は SEIL/X,B1,x86,BPV4 の設定(旧コンフィグ)を SEIL/X4 の設定(レシピコンフィグ)に変換するツールです。


## 使い方
ブラウザ上で動作するウェブアプリケーションとしての利用と、JavaScript ライブラリとしての利用の二通りの使い方ができます。ブラウザ上で利用する場合は、左側のテキストエリアに旧コンフィグを入れると、右側のテキストエリアにレシピコンフィグに変換されたものが表示されます。ページ下部には変換できなかった行とその理由が表示されます。

![screenshot](/screenshot.png)

JavaScript ライブラリとして利用する場合は、index.html や main.js を参考に seil2recipe.js をアプリケーションに組み込んでください。


## コンフィグの変換ルール

 - 旧コンフィグには「show config コマンドの出力結果」を想定しており、そうではないコンフィグは正しく変換できないことがあります。SEIL の旧コンフィグは書式の自由度が非常に高く、ある程度限定しないとうまく解釈できないためです。
 - 一行で完結しないコンフィグは、依存するコンフィグがすべて揃ったタイミングで出力されます。たとえば "ppp add ..." と "interface pppoe0 ppp-configuration ..." は、両方揃ってはじめて意味を持ちます。
 - "disable" されているコンフィグは、レシピコンフィグとして出力されない場合があります。これはレシピコンフィグでは disable 状態を表現するキーが無かったり、変換後のコンフィグが煩雑で読み難くなる場合があるためです。


## 対応ブラウザ
PC 版の Safari, Chrome, Edge, Firefox に対応しています。Internet Explorer や Android/iOS 上のブラウザでの利用は想定していません。


## 不具合
左のボックスに「show config」の出力を貼り付けて、右のボックスに変換後のコンフィグが出てくるか、または画面下に変換されない理由が出てこない場合は基本的に不具合です。[issue 一覧](https://github.com/iij/seil2recipe/issues) からバグ報告してください。

バグレポートには

  1. うまく変換されない旧コンフィグ(の一部)
  2. 期待されるレシピコンフィグまたはエラーメッセージ

を含めてください。


## テスト
`% npm test` で実行できます。事前に `% npm install mocha` で [Mocha](https://mochajs.org) をインストールしておいてください。


## ライセンス
SEILコンフィグ自動変換ツールは MIT ライセンスにしたがって自由に利用できます。

Copyright (c) 2019 Internet Initiative Japan Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
