// The text editor's libraries, bundled once into vendor/codemirror/editor.mjs by
// scripts/build-editor.mjs. Not part of the widget's own bundle: the widget imports the built file at
// run time, only when someone opens a text file to edit. Everything here is MIT.
export { EditorState, Compartment } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
export { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
export { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
export { tags } from '@lezer/highlight';
export { html } from '@codemirror/lang-html';
export { css } from '@codemirror/lang-css';
export { javascript } from '@codemirror/lang-javascript';
export { json } from '@codemirror/lang-json';
export { markdown } from '@codemirror/lang-markdown';
export { xml } from '@codemirror/lang-xml';
export { yaml } from '@codemirror/lang-yaml';
export { marked } from 'marked';
