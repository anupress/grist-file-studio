# Changelog

## 1.12.0

The list. Checked in the demo (clicks, keys and the right mouse button, 1366 to 390 px), in the audit (light and dark, English, German
and French) and in Grist 1.7.20 (thumbnails through the attachment endpoint, sort, opening, kept after a reload).

### Files
- **Display → Show as → List**: one row per file (picture or type, name, type, size, date added, tags; the record without headings)
  with column headings that sort: click for the first order, again for the opposite. New sorts: Name Z to A, Smallest first, Type Z to A.
  Marks, dragging to another record, right click, the keyboard and the search hit under the name all work as on tiles. The size slider
  is hidden (rows have one height).

## 1.11.0

Folder sizes. Checked in the demo (the right mouse button) and in the audit at 1366 and 390 px, light and dark, English, German and French.

### Files
- A folder's heading says how much space its files take: "9 files · 469 kB" (the files shown, when a search narrows them).
- **Properties…** in a folder's right-click menu: files, size, what the document stores for them (the same file twice is stored once),
  the largest file, the first and last upload, the space by type (a bar for each) and the record's own fields.

## 1.10.0

Right-click menus and folders. Checked in the demo with the real mouse (right button) and keys, and in Grist 1.7.20 (a guest document:
New folder wrote a record, files dropped on the empty folder went into its cell, Move to and Rename wrote the cells, the switch
stayed after a reload).

### Right-click
- On a file: its menu, at the pointer. With several files marked: the menu of the marked files (zip, copy, move, tag, rename, merge,
  report, compare, unmark, remove).
- On a folder's heading, empty line or card: Open in the Viewer, Add files…, New folder…, Rename folder…, Download as zip, Photo
  report…, Select this record. On the empty part of the wall: Add files…, New folder…, Mark all shown, Show or hide records without
  files, Storage…. The menu stays on screen (it opens upward or to the left near an edge). The menu key and Shift+F10 do the same
  on a card.

### Folders
- **New folder…** adds a record named by you (in the record's name column: a plain Text column, not a formula) that can take
  files: a line says it is empty and takes dropped files; Add, Move to and Copy to work as for any record. **Rename folder…** writes
  the name cell. Undo takes both back.
- The Files layout still hides records without a file; folders made in this visit stay on show, and **Display → Show records
  without files** shows them all (kept per table in this browser).

## 1.9.0

Tags and a note for each file. Checked in the demo with the real mouse and keys, and in Grist 1.7.20 (a guest document: the table is
added after asking, the tags are written, read again after a reload, shared by the same photo in two records, and undone step by step).

### Files
- **Tags and note** from a file's menu, the lightbox's Details, or **Tag…** on the marked files. Tags are chips (Enter or a comma adds
  one, tags already in use are offered); the note is free text.
- They are kept in a table of the document, `File_Studio_notes`, that File Studio adds after asking when the first tag is made:
  the file's content hash, its name, the tags (a choice list) and the note. The same photo in two records has the same tags; an
  edited, shrunk or replaced file takes them along. Every change is one Grist action, so Undo covers it, and a change made in
  Grist itself shows when the widget is looked at again.
- A **Tag** list beside Sort (it appears once a tag exists) shows only the files with that tag. The search box also finds tags and
  notes, a tile's tooltip shows them, and so do the Details.

### Layout
- The type chips no longer get squeezed to a sliver between 620 and 900 px when the bar is full (a Tag list, German or French
  labels): they keep at least 140 px or take a row of their own.

### Fixed
- The French text for "and {n} more" was defined twice (the later one won); it is now defined once.

## 1.8.0

The Document look for photos of pages. Checked in the demo with a synthetic photo (a page lit from one side, a shadow in a corner,
noise) in the picture editor.

### Picture editor
- **Look → Document** and **Document, colour**: the paper is made white and even and the print dark. The paper's brightness is
  estimated block by block (the 85th percentile of each block, so print does not count), smoothed and interpolated; each pixel is
  measured against it. Resolution independent, so the preview and the saved picture agree. The colour variant keeps a blue pen blue.
- It goes through the same adjustments as the other looks: the sliders still tune it, Reset and the eye button work, and the
  result is saved like any edit.

## 1.7.0

Slideshow, a before/after slider and the date a photo was taken. Checked in the demo with real mouse and keys, and in Grist 1.7.20 (the date, camera and place of a photo read through the attachment endpoint).

### Photos
- **Slideshow** in the lightbox: play button or **S**; 3, 5 or 8 seconds a picture (More menu, kept), twice as long for documents,
  video and audio play to their end; a thin line shows the time left (hidden when the system asks for less motion).
- **Compare**: two marked pictures, or the current one with the next or previous in the lightbox, laid over each other with a
  divider to drag or move with the arrow keys; the frame has the first picture's shape; Swap.
- **Sort by date taken** (oldest or newest first, photos without a date last): the dates are read from the first 128 kB of each JPEG
  (the rest of the download is cancelled), four at a time, and kept in this browser under the photo's content hash. A line
  beside the sort shows the progress and Stop.
- A photo's **Details** show Taken, Camera and Place (a link that opens a map only when clicked) for JPEGs with EXIF.
- The demo's photos carry EXIF (a time, a phone and a place near each address) so all of this has something to show.

### Fixed
- The group chip and the sort that were chosen last time were never restored when the widget opened again (the README
  said they were); now they are.

## 1.6.0

Previews of Word, Excel and PowerPoint files. Checked in Grist 1.7.20 (a guest document: the Word and Excel demo files through the attachment endpoint) and in the demo with a presentation added through the
file chooser.

### Previews
- `.docx` files open in the lightbox and the Viewer as a white sheet: headings (by style name or outline level), numbered and
  bulleted lists with their markers, bold, italic, underline and strike-through, line breaks, links (http, https and mailto
  only), tables with merged cells, pictures out of the file, tracked changes as accepted. No page layout, headers, footers,
  footnotes or colours.
- `.xlsx` files show each visible sheet as a grid with column letters and row numbers, a tab per sheet, the numbers in their own
  format (decimals, thousands, percent, scientific, a currency sign), dates and times in the viewer's language, booleans,
  errors, merged cells, column widths and the stored result of formulas; 1,000 rows by 60 columns, with a note when cut.
- `.pptx` files show each slide as a white card: title, subtitle, text with its levels and bullets, tables, and a note
  where pictures are not shown.
- Read as data and drawn with text nodes: nothing in a file can run. The XML reader is our own (no DTDs or external entities:
  a DOCTYPE is skipped, never read), so the readers are tested in Node (46 cases). Files over 30 MB, damaged files and files
  with a password say so and offer Download.
- The demo has `inspection-costs.xlsx` (Testgasse 7).

### Smaller
- One token for the dark room of the lightbox and editors, and one for the ink on white sheets.

## 1.5.0

More PDF tools. Checked in the demo with real mouse and keys, read back with pdf-lib, and in Grist 1.7.20 (a guest document: the form saved in place with its fields kept, opened again with the entries, Undo).

### PDF editor
- **Form** tab, when the PDF has form fields: text (one line or several), tick boxes, radio buttons, drop-down lists and option
  lists are drawn as inputs on the page, in place, turned with the page. What is typed is written into the saved file.
  Filled fields are flattened by default (printed on the page); unticking that keeps a form with the entries in it
  when the document is edited where it stands. Fields with an automatic text size get a readable 12 pt (11 pt multi-line).
- **Finish** tab: **Turn pages into pictures** (only pages with a cover-up, or every page; 100, 150 or 200 dpi) makes a
  cover a real redaction (the words are gone from the file, tested by looking for them inside every stream) and shrinks scans;
  **Password** locks the file with a password to open and the choices to allow printing, copying and changing.
- **A blank page** on the Pages tab, the size of the page before it; **Picture** on the Fill and sign tab places a logo or
  stamp from the computer (JPEG stays JPEG, other pictures keep their transparency).
- The Cover up hint now says that the text under a cover stays in the file until the page is turned into a picture.

### Smaller
- The demo has a fillable `move-in-form.pdf` (Hafenstraße 12).
- The vendored pdf-lib exports its form classes; nothing new is bundled.
- The text on tile labels and search hits stays light in the dark theme (it had borrowed the tooltip's ink).

## 1.4.0

Photo report. Checked in Grist 1.7.20 on docs.getgrist.com (a guest document, headless Chrome) and in the demo.

### Photo report
- A record's photos on pages as a PDF: title, the record's details in two columns, the photos with their names under
  them, the other files listed. From the Viewer's **Report** button, **Download → Photo report of …**, or the marked
  bar's **Photo report…** (the marked photos, from any records, without a record's details).
- Options: 1, 2, 4 or 6 photos per page, A4 or Letter, the details, the file names, the list of other files; the dialog
  says how many pages that makes. Kept in this browser.
- Add to the record (one Grist action; Undo takes it out) or Download. Photos are redrawn upright, at most 1,500 px (2,000
  at one or two per page), as JPEG; photos the browser cannot read are left out and counted.
- Pages are laid out by `model/report.js` (pure, 54 tests): a fixed rhythm of rows, no page with more rows than the grid,
  a row that does not fit goes to the next page or is drawn smaller when four fifths of it fit; every page has the title
  and "Page n of N" at the foot.

### Smaller
- Dialog buttons wrap on a narrow widget instead of running off the edge.

## 1.3.0

Search inside files. Checked in Grist 1.7.20 on docs.getgrist.com (a guest document, headless Chrome) and in the demo.

### Search inside files
- **Inside files**, a box at the end of the search field: the search also looks at the words in PDFs (page by page),
  Word, Excel, PowerPoint and OpenDocument files, and text, Markdown, CSV and HTML files. Accents and capitals are
  ignored, and every word typed must be somewhere in the file's name, the record or the file's own text.
- The text is read when asked: a one-time question says how many files and how many bytes; it reads two files at a time,
  shows its progress beside the box, can be stopped, and carries on from where it stopped. It is kept in this browser
  under each file's content hash (IndexedDB), never in the document, so the same file in two records is read once and a
  changed file is read again.
- A tile says where the words are: the page (Page 3, Pages 3, 7) or In the text, with the words around the match, the
  match underlined. The lightbox opens a PDF at its first matching page, shows the same words, and has Next match.
  In Cards, a record shows when one of its files matches.
- Files that cannot be read (damaged, password-protected, too large) are counted next to the box and left out. A scanned
  PDF without a text layer has no words to find.
- Zip files are read with the browser's own inflate (no library), so nothing new is bundled.

### Smaller
- The PDF viewer can scroll to a page (used by the search; `goTo` on the view).

## 1.2.0

Storage: where the document's attachment space goes, and two ways to make room. Checked in Grist 1.7.20 on
docs.getgrist.com (a guest document, headless Chrome) and in the demo.

### Storage
- A **Storage** button opens a view of every file in the document: the total, split by kind (with the files nobody
  uses shown separately and in words), an allowance to watch (1 GB by default on Grist's hosted service, which keeps
  1 GB of attachments per document; none elsewhere; chosen per document, kept in this browser) and the biggest files.
  Grist stores a file once however many cells hold it, and the view counts it once.
- **Shrink photos**: the photos larger than a longest side you choose (1024 to 2560 px), or very heavy for their pixels,
  are redrawn smaller (JPEG at 85 %, a PNG stays a PNG), with a guess of what is saved shown first. The old file is
  replaced by the new one in every cell that holds it, in all tables, as one Grist action: one Undo takes it all back.
  It runs two photos at a time with a progress bar and can be stopped. What the camera wrote into the file, including
  where the photo was taken, is not kept.
- **Free up space**: asks Grist to look at which files nobody uses and to delete them. Only an owner of the document
  may (Grist answers "No owner access" otherwise, and the button says so before it is pressed). Grist keeps removed and
  replaced files so that Undo can bring them back; after this step it cannot.
- The biggest files each have Where it is…, Download and Remove from every place….

### Smaller
- Photos and files removed from a cell show up under Free up space until Grist's cleanup runs.

## 1.1.0

PDF tools: a PDF now opens in an editor of its own, and PDFs and photos can be merged. Checked in Grist 1.7.20
on docs.getgrist.com (a guest document, headless Chrome) and in the demo.

### PDF files
- **Pages**: every page as a thumbnail. Drag to reorder (or Earlier and Later), turn, remove and restore,
  duplicate, add pages from other PDFs and photos (from this document or your computer). Take pages out as a
  new file, or split into several files: every page, every few pages, or by ranges such as `1-3, 5, 8-`. New
  files land right after the original.
- **Fill and sign**: text, today's date, ticks, crosses, a cover box, a highlighter, a pen and a drawn
  signature (kept in this browser only if you ask). Marks can be moved, resized and recoloured, and keep their
  place when the page is turned. Standard PDF fonts, so Western European text; other letters are reported
  before they turn into "?".
- **Numbers**: page numbers (six positions, four looks, a start number, skip the cover) and a watermark.
- **Merge**: mark PDFs and photos and press Merge into PDF…, or use Merge with… in a file's menu. Reorder the
  files and the pages, name the result, and optionally take the originals out of their records in the same step.
- Saved like the other editors: Save in place (asking about other places, one Undo), Save as copy, Download.
- Password-protected PDFs ask for the password (the saved file is not protected). A digitally signed PDF says
  that a changed copy loses its signature.
- A page you take out carries nothing of the others: when pages are left out or files are joined, a new
  document is built from the kept pages. Turning, reordering and marking keep bookmarks, form fields and the
  file's information.

### Smaller
- The marked-files bar takes a second row on a narrow widget instead of scrolling sideways; the mark button
  on a tile is 24 px; the PDF page area in the lightbox has a name for screen readers; the danger button is
  readable in dark mode.

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
