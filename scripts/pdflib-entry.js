// What File Studio uses of pdf-lib (the @cantoo fork, which can also open password-protected files).
// Listing the names keeps the bundle to what the PDF tools call (the form classes are there to tell a field's kind). Build with scripts/build-pdflib.mjs.
export {
  PDFDocument, StandardFonts, rgb, degrees,
  PDFName, PDFString,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, PDFButton, PDFSignature,
  EncryptedPDFError,
  pushGraphicsState, popGraphicsState, setLineJoin, LineJoinStyle, LineCapStyle,
} from '@cantoo/pdf-lib';
