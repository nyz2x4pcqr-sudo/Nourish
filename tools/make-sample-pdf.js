// Writes a small sample cookbook (PDF) to try the recipe library with:
//   node tools/make-sample-pdf.js [file]   (default: sample-cookbook.pdf)
'use strict';
const fs = require('fs');
const { pdf } = require('../tests/sample-pdf.js');
const out = process.argv[2] || 'sample-cookbook.pdf';
fs.writeFileSync(out, pdf());
console.log(`Wrote ${out}`);
