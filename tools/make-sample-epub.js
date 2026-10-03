// Writes a small sample cookbook (EPUB) to try the EPUB reader with:
//   node tools/make-sample-epub.js [file]   (default: sample-cookbook.epub)
// Then add it in Nourish: Settings → Recipes → Add files.
'use strict';
const fs = require('fs');
const { sampleBook } = require('../tests/sample-book.js');
const out = process.argv[2] || 'sample-cookbook.epub';
fs.writeFileSync(out, sampleBook());
console.log(`Wrote ${out}`);
