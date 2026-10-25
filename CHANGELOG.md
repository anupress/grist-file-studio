# Changelog

## 1.0.0

The first release. Tested in Grist 1.7.20 on docs.getgrist.com (a guest document, headless Chrome)
and in the demo, editing included.

### Showing files
- Three layouts over any table with an Attachments column: **Cards** (a cover picture, the title and
  up to four fields; hover the cover to flip through the record's pictures), **Files** (every file,
  justified rows or squares, a heading per record) and **Viewer** (one record large, with a filmstrip).
- The Viewer follows a linked table's selected row; clicking a card or a file moves Grist's cursor,
  so a linked card follows.
- Search, filter chips by type with counts, sort by cell order, name, date or size.
- The lightbox: photos with zoom, pan and rotate; PDFs page by page (pdf.js, loaded only when needed);
  video and audio with seeking; text, JSON and CSV (as a table); a file card with Download for the rest.
- Thumbnails made in the browser and cached under the file's content hash: PDF first pages with the
  page count, video frames with the length, the first lines of text files. Phone photos stand the right
  way up, whatever size Grist recorded.

### Changing files
- Drop files on a card, a heading or the Viewer; Add files; paste a screenshot. Files dropped
  elsewhere can go to the selected record or become one new record each, named after the file.
- Upload progress per file, with clear reasons for refusals (size, permissions, a server that blocks
  uploads from widgets). Optional shrinking of large photos, which also removes their location data.
- Reorder in the filmstrip, Make cover, Remove from the record, Rename (one file, or many by a pattern
  with a preview). Each is one Grist action, undone by Grist.

### Editing files
- A picture editor for JPEG, PNG, WebP, GIF, BMP and AVIF, at full size up to 40 megapixels: crop
  (free or to a shape, upright or across), turn, flip, straighten; Auto, exposure, contrast,
  highlights, shadows, saturation, warmth, sharpness and five looks; mark-up with arrows, boxes,
  circles, a pen and text; hiding faces or plates under blur, pixels or a black box; size, format and
  quality. Undo and redo, hold to compare.
- A text editor (CodeMirror 6, loaded only when needed) for TXT, CSV, JSON, Markdown, HTML, CSS,
  JavaScript, XML, YAML, SVG and more, up to 2 MB: syntax colours, search and replace, folding,
  wrapping. CSV as an editable table or as text; Markdown, HTML and SVG with a live preview (HTML
  sandboxed, scripts never run); JSON formatting. Files keep their separator, quoting, line endings
  and byte-order mark.
- Save in place (the edited file takes the original's place, and on request every other place it is
  in, as one Grist action), Save as copy, or Download.

### Where files are and moving them
- **Where it is**: every cell in the document holding a file, in any table, with the row as a card
  and a link that opens Grist at that cell.
- **Remove from every place…** takes a file out of every cell that holds it, after listing them, in
  one step; **Remove from this record** now says under its name that it only touches this cell.
  Formula cells are left to their formulas, also by Save's "update every place" (which no longer asks
  about them).
- Duplicate, Copy to… and Move to… another record (a searchable record list), Replace with… a file
  from the computer; drag files onto another record to move them (Ctrl or Alt: copy).

### Getting files out
- Download one file under its name; zip the selected record, everything on show, or marked files.
- Zip names from a pattern of columns (`{Invoice} {Client} {nn}`), a folder per record, and a
  `files.csv` saying which file came from which record.

### Everything else
- English, German and French; light and dark following Grist; keyboard operation throughout.
- 10,000 files open in about 0.3 s and scroll at full frame rate (only what is on screen is drawn).
