# Third-party notices

File Studio bundles the files below under `vendor/`, and ships them as part of the widget. Each
one's licence requires its copyright notice to travel with the code; Apache-2.0 additionally
requires a copy of the licence itself. This file carries both.

Nothing here changes the licence of the ANUPRESS source, which is MIT — see `LICENSE`.

---

## Grist Plugin API

`vendor/grist-plugin-api.js` — <https://github.com/gristlabs/grist-core>
Copyright Grist Labs Inc.
Licensed under the **Apache License, Version 2.0**. The full licence text is at
<https://www.apache.org/licenses/LICENSE-2.0> and is reproduced in `vendor/LICENSE-Apache-2.0.txt`.

The bundle Grist Labs publishes incorporates `events` (a browser port of Node's EventEmitter),
Copyright Joyent, Inc. and other Node contributors, under the MIT License (text below).

## Sortable 1.15.3

`vendor/Sortable.min.js` — <https://github.com/SortableJS/Sortable>
Copyright (c) 2019 All contributors to Sortable
Licensed under the **MIT License**:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## pdf.js 6.4.299

`vendor/pdfjs/` (pdf.min.mjs, pdf.worker.min.mjs, cmaps/, standard_fonts/, wasm/, iccs/) —
<https://github.com/mozilla/pdf.js>
Copyright Mozilla Foundation. Licensed under the **Apache License, Version 2.0**
(`vendor/pdfjs/LICENSE`, and `vendor/LICENSE-Apache-2.0.txt`). Loaded only when a PDF is on screen.
The files in `vendor/pdfjs/wasm/` carry their own notices next to them: OpenJPEG (BSD 2-clause),
the PDFium JBIG2 decoder (BSD 3-clause), qcms (MIT; its colour data CC0). `iccs/` is a CC0 colour profile. `standard_fonts/` holds the Foxit fonts
(BSD 3-clause, `LICENSE_FOXIT`); `cmaps/` holds Adobe's character maps (BSD 3-clause, `cmaps/LICENSE`).
The Liberation fonts pdf.js also ships (GPL-2.0 with a font exception) are left out on purpose: they
are only a fallback for form-field text, and leaving them out keeps every file here under a
permissive licence. The PDF scripting engine (quickjs) is not shipped.

## CodeMirror 6 and marked (the text editor)

`vendor/codemirror/editor.mjs` — one bundle, loaded only when someone opens a text file for editing.
It holds CodeMirror 6 (<https://codemirror.net>) with its Lezer parsers for HTML, CSS, JavaScript,
JSON, Markdown, XML and YAML, and marked (<https://github.com/markedjs/marked>) for the Markdown
preview. Every package in it is under the **MIT License**:

- `@codemirror/*` (autocomplete, commands, lang-css, lang-html, lang-javascript, lang-json,
  lang-markdown, lang-xml, lang-yaml, language, search, state, streamparser, view), `@lezer/*`
  (common, css, highlight, html, javascript, json, lr, markdown, xml, yaml), `style-mod`,
  `w3c-keyname`, `crelt` and `@marijn/find-cluster-break`: Copyright (C) 2016–2024 by Marijn
  Haverbeke and others.
- `marked`: Copyright (c) 2018+, MarkedJS; Copyright (c) 2011–2018, Christopher Jeffrey. Its licence
  also carries the original Markdown.pl notice (Copyright © 2004, John Gruber, BSD 3-clause).

The exact version of each package is in the bundle's first lines, and each one's own licence text,
word for word, is in `vendor/codemirror/LICENSES.txt`, which `scripts/build-editor.mjs` writes from
the packages themselves.

## pdf-lib (the PDF tools)

`vendor/pdflib/pdflib.mjs` — the @cantoo fork of pdf-lib, <https://github.com/cantoo-scribe/pdf-lib>
(original by Andrew Dillon, <https://github.com/Hopding/pdf-lib>). One bundle, loaded only when a PDF is
opened for editing. It carries 14 packages, all under permissive licences:

- **MIT License**, each with its own copyright line: `@cantoo/pdf-lib` (2019 Andrew Dillon),
  `@pdf-lib/standard-fonts` (2018 Andrew Dillon), `@pdf-lib/upng` (2017 Photopea), `color` (2012 Heather Arthur),
  `color-convert` (2011-2016 Heather Arthur), `color-string` (2011 Heather Arthur), `color-name` (2015 Dmitry
  Ivanov), `crypto-js` (2009-2013 Jeff Mott, 2013-2016 Evan Vosberg), `html-entities` (2021 Dulin Marat),
  `is-arrayish` (2015 JD Ballard), `simple-swizzle` (2015 Josh Junon), `node-html-better-parser` (2019 Tao
  Qiufeng).
- `pako` (Copyright (C) 2014-2017 Vitaly Puzrin and Andrei Tuputcyn): **MIT License** with the zlib licence
  for the parts derived from zlib.
- `tslib` (Copyright (c) Microsoft Corporation): **0BSD**.

The exact version of each package is in the bundle's first lines, and each one's own licence text, word for
word, is in `vendor/pdflib/LICENSES.txt`, which `scripts/build-pdflib.mjs` writes from the packages themselves
(and refuses to build if a licence outside its short list of permissive ones appears).

---

Nothing else is fetched at view time. The widget makes no network requests of its own: it talks only
to the Grist document it is placed in (rows, file metadata, file contents and uploads), and the one
outbound link is the ANUPRESS logo.

## libheif and libde265 (HEIC pictures)

`vendor/libheif/libheif-bundle.mjs` — libheif-js 1.23.5, <https://github.com/catdad-experiments/libheif-js>: libheif
(<https://github.com/strukturag/libheif>) and libde265 (<https://github.com/strukturag/libde265>) compiled to WebAssembly.
Licensed under the **GNU Lesser General Public License, version 3**: the licence texts are in `vendor/libheif/LICENSE-LGPL-3.0.txt` and
`vendor/libheif/LICENSES-libheif.txt`, and `vendor/libheif/NOTICE.txt` says where the source is and how to replace the library. It is kept as a
separate file that the widget loads at run time in a Worker (`vendor/libheif/heic-worker.mjs`), unchanged, so it can be replaced by another
build of the same library. Loaded only when a HEIC picture has to be shown.

## tesseract.js, Tesseract and the language data (text recognition)

`vendor/tesseract/` — tesseract.js 7.0.0 (<https://github.com/naptha/tesseract.js>), tesseract.js-core 7.0.0 (the Tesseract OCR engine and
Leptonica compiled to WebAssembly) and the "best" models of tessdata_best for English, German and French
(<https://github.com/tesseract-ocr/tessdata_best>), all licensed under the **Apache License, Version 2.0** (`vendor/LICENSE-Apache-2.0.txt`).
Their bundled notices (buffer, ieee754, regenerator-runtime, zlib.js) are in `vendor/tesseract/LICENSES.txt`. Loaded only when scanned pages
or pictures are read for their words.
