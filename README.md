# File Studio — a custom widget for Grist (by ANUPRESS)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563EB.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-0F1B2D.svg)](CHANGELOG.md)

File Studio is a gallery, viewer, editor and file manager for the files in your Grist
**Attachments** columns. It shows them the way people look at files:
as **cards** with a cover picture, as a **wall of files**, or one record at a time in a **viewer**.
Any file opens large, whether a photo, a PDF, a video, a voice note, a CSV or a text file. Pictures
and text files can be edited and saved back in place. Drop files in, paste a screenshot, copy or move
them between records, see every cell a file sits in, rename them by a pattern, and download them as
one zip named after your columns. It runs entirely in the viewer's browser: there is no server, and your
files go only between the browser and your own Grist.

Paste this into Grist (**Add widget → Custom → Enter Custom URL**):

```
https://anupress.github.io/grist-file-studio/
```

![Property inspections as cards, each with its first photo as the cover](docs/images/cards.png)

## Try it without Grist

Opened in a plain browser tab, the widget runs on sample property inspections and saves nothing:
**[the demo](https://anupress.github.io/grist-file-studio/)**. Add `?example=speed` for
2,000 records with 10,000 files.

## The three layouts

| Layout | Shows | What you do in it |
|---|---|---|
| **Cards** | one card per record: the cover picture, the title, up to four fields | hover the cover to flip through its pictures, drop files on a card, click to select the record |
| **Files** | every file of the records shown, in justified rows or squares, with a heading per record | search, filter by type, sort, mark several and zip, rename or remove them |
| **Viewer** | the selected record's files, large, with a filmstrip | follow a table next to it, drag the filmstrip to reorder, make a cover, add files |

![Every file of the inspections, a heading per record: photos, a PDF's first page, a video frame, a text file's first lines, a floor plan](docs/images/files.png)

Next to a Grist table, the **Viewer** is the attachment viewer people have asked Grist for: link it
to the table (**Select by**, same record) and it shows the files of whichever row is selected.

![The Viewer: one record's files, large, with the filmstrip and the cover marked](docs/images/viewer.png)

## Any file, large

The lightbox shows the file as big as the widget allows and steps through everything on show:

- **Photos:** fit or 100 %, wheel and pinch zoom around the pointer, double-click to zoom, drag to pan,
  rotate the view. Phone photos stand the right way up.
- **PDFs:** every page, drawn by pdf.js, with zoom. **Open in a new tab** gives the browser's own
  viewer for search and printing.
- **Video and audio:** played in the browser, with skipping ahead.
- **Text, CSV, JSON, Markdown, HTML:** shown as text, CSV as a table. Never run as a web page.
- **Anything else** (Word, Excel, ZIP, HEIC on Chrome): its type, size and a Download button.

Arrow keys, swipes and the filmstrip move between files; **I** shows the details (size, picture size,
pages, length, upload date, record and column).

![The inspection report, a PDF, in the lightbox](docs/images/lightbox.png)

## Adding and arranging files

- **Drop** files on a card, a record's heading or the Viewer to add them to that record. Drop them
  anywhere else, or press **Add files**, and choose: add them to the selected record, or make **one
  new record per file**, named after the file (handy for importing a folder of photos).
- **Paste** a screenshot with Ctrl+V. On a phone, **Add files** offers the camera.
- **Shrink large photos before uploading** (an option in Columns) keeps the document small and also
  removes the location and camera data photos carry.
- **Reorder** by dragging in the Viewer's filmstrip; **Make cover** moves a file to the front.
- **Remove** takes a file out of its record; **Rename** changes its name everywhere in the document.

Every change is one Grist action, so one Undo (in Grist, in the widget's toast, or Ctrl+Z in the
widget) takes it back. Files in a formula column are shown, never changed. When the widget is
filtered by a link, new records get the linked value, so they stay in view.

## Editing files

Pictures and text files open in an editor: **E** in the lightbox, or **Edit…** in a file's menu.
Videos, audio, PDFs and office files are shown, not edited.

![The picture editor, marking up a damp patch with a box and an arrow](docs/images/edit-picture.png)

**Pictures** (JPEG, PNG, WebP, GIF, BMP, AVIF), up to 40 megapixels, edited at full size:

- **Crop** freely or to 1:1, 4:3, 3:2, 16:9 or the original shape, upright or across; turn left or
  right, flip either way, straighten by up to 45°.
- **Adjust** exposure, contrast, highlights, shadows, saturation, warmth and sharpness, or press
  **Auto** to stretch the light and take out a colour cast. Five looks (black and white, warm, cool,
  vivid, soft). Hold the eye button to see the original.
- **Mark up** with arrows, boxes, circles, a pen and text, in five colours and three line weights.
- **Hide** faces, number plates or names under blur, pixels or a black box before a picture goes out.
- **Size** sets the width in pixels, the format (as the original, JPEG, PNG or WebP) and the quality.

Saving writes a new picture, so camera data such as the place a photo was taken is not carried over.

**Text files** (TXT, CSV, TSV, JSON, Markdown, HTML, CSS, JavaScript, XML, YAML, SVG and more, up to
2 MB) open in a code editor with line numbers, syntax colours, search and replace, folding and
wrapping of long lines.

- **CSV** opens as a table: click a cell and type, Enter and Tab move on, rows and columns are added
  and removed with a button. Or switch to the raw text. The file keeps its own separator, quoting,
  line endings and byte-order mark, so Excel opens it as before.
- **Markdown, HTML and SVG** show a live preview next to the code. The HTML preview is sandboxed:
  scripts in the file do not run.
- **JSON** has a Format button. A file that is not UTF-8 opens as Windows text and is saved as UTF-8;
  the editor says so.

**Save** offers three ways:

- **Save:** the edited file takes the original's place in the cell, under the same name. If the same
  file is in other cells too (other records, other tables), the widget asks whether to update those as
  well. Either way it is one Grist action, which one Undo takes back.
- **Save as copy:** a new file next to the original, named "… (edited)".
- **Download:** to your computer only; the document stays as it is.

## The file manager

A file's menu (**⋯** on its tile, or the menu in the lightbox) has:

| | |
|---|---|
| **Rename…** | changes the name everywhere in the document |
| **Duplicate** | a separate copy right after it, named "… (copy)" |
| **Copy to…** | the same file also in another record, picked from a searchable list |
| **Move to…** | out of this record and into another |
| **Replace with…** | a file from your computer takes its place |
| **Make cover** | moves it to the front |
| **Remove from this record** | takes it out of this cell only; other cells that hold the file keep it |
| **Remove from every place…** | takes it out of every cell that holds it, in any table, after listing them |

Neither remove deletes the file from the document straight away. A file that no cell uses any more
stays in the document for a while, so Undo can still bring it back, and Grist then deletes it (see
*Where the files live*). Formula columns are never written; they follow their formula.

In the Files layout, drag a file (or the files you marked) onto another record's group to move it there;
hold Ctrl (or Alt) to copy instead.

**Where it is** (in the lightbox's details, **I**, or in a file's menu) lists every cell in the
document that holds the file: in this table and in any other, including tables the widget does not
show. Each line names the record, the table and the column. One button shows that row right here, as
a card; the other opens Grist at that very cell.

![Where it is: the handover protocol is in two inspections, and the other one is shown as a card](docs/images/where-it-is.png)

## Where the files live

In Grist a file is not inside a cell. Grist keeps each uploaded file once per document, either inside
the document itself or, when the document is set to it, in an external store (Document settings →
Attachment storage), and lists it with its name, size, picture size, upload time and a hash of its
content. An Attachments cell holds only the numbers of the files it shows. So the same file can sit in
many cells without being stored twice: that is what **Copy to** does, and what **Where it is** finds.

Grist never changes an uploaded file. **Save** therefore uploads the edited version as a new file and
points the cell, or every cell, to it. The original stays in the document while anything uses it.
Files that no cell uses any more are kept for a while, so Undo can still bring them back, and then
cleared out by Grist; how long is set by whoever runs the Grist server.

File Studio stores no files of its own. It reads them from your Grist and writes them back there,
in your browser; only the thumbnails are kept, in this browser's cache.

## Getting files out

**Download** saves one file under its own name. **Download → as zip** packs the selected record's
files, everything on show, or the files you marked. In **Columns** you set how the files in a zip are
named, from your columns: `{Invoice} {Client} {nn}` turns into `R-2026-014 Müller GmbH 01.jpg`. A
zip can have a folder per record and a `files.csv` that says which file came from which record.

**Rename by a pattern** (mark files, then **Rename…**) uses the same patterns to rename the files in
Grist itself, with a preview first.

## Use it in Grist

1. Add a widget, choose **Custom**, and paste the widget URL.
2. Accept **Full document access** when Grist asks.

Full access is needed because the widget reads the files' names and contents through Grist's
document access (short-lived tokens it renews by itself), and writes your changes back. It shows the
table you chose when adding the widget and finds its Attachments columns by itself; **Columns** lets
you pick which ones, which column names a record, and what a card shows.

**Linking works both ways.** Clicking a card or a file moves Grist's cursor, so a linked card or
table follows. Linked to a table, the Viewer follows its selected row; selected by another table
(locations, projects), the wall shows only that selection's files.

**Self-hosted Grist:** thumbnails, video and zips read the files with `fetch`, which needs Grist's
API to answer cross-origin requests (it does by default). Some servers sit behind a firewall that
refuses the upload preflight; the widget then says so and the Grist cell still takes files.

## Fast with big galleries

Thumbnails are made in your browser the first time a file is on screen and kept there, under the
file's content hash, so the next visit draws at once. At most four files download at a time, and only
what is on screen is drawn: 10,000 files open in about 0.3 s and scroll at full frame rate.

## Languages and keys

English, German and French, following Grist's language (or chosen in Columns). Arrows move,
Enter opens, Space marks, Delete removes, **?** lists the rest.

## Where settings live

- **In the widget's options**, saved in the document and shared by everyone, written only when
  someone presses Save in Columns: the columns, the layout it opens in, card and tile options, zip
  naming and the upload option.
- **In this browser**: the layout last switched to, tile size, filters and sort, the interface
  language, and the thumbnail cache.

## Building

```
npm install
npm test        # version check, shared-core check, unit tests
npm run build   # obfuscated bundle in dist/
```

`src/` runs as native modules for development (`scripts/serve.ps1` serves the folder). The files in
`src/core/` are shared with Advanced Charts and copied by `scripts/sync-core.mjs`; edit them there.
The text editor's libraries are one committed bundle, `vendor/codemirror/editor.mjs`; after changing
a CodeMirror or marked version, `node scripts/build-editor.mjs` rebuilds it with their licences.

## Licence

MIT, see [LICENSE](LICENSE). Bundled third-party code (Grist's plugin API, pdf.js, Sortable,
CodeMirror, marked) is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
