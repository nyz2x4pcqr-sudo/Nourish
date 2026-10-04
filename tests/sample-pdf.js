// A small sample cookbook as a real PDF (text, not pictures), for the iPhone build test and to try
// the app with: node tools/make-sample-pdf.js. Built by hand: one page per recipe, Helvetica.
'use strict';
const RECIPES = [
    ['Arroz con Pollo', ['Serves 4', 'Ingredients', '4 chicken thighs', '2 cups long grain rice', '1 onion, chopped', '1 green pepper, chopped', '2 cloves garlic', '1 cup tomato sauce', '3 cups chicken stock', '1 tsp salt', 'Method',
        '1. Brown the chicken in a large pot with a little oil.', '2. Add the onion, pepper and garlic and cook for 5 minutes.', '3. Stir in the rice, tomato sauce and stock and bring to a boil.', '4. Cover and simmer for 25 minutes until the rice is tender.']],
    ['Habichuelas Guisadas', ['Serves 4', 'Ingredients', '2 cans pink beans', '1 potato, diced', '1/2 onion, chopped', '2 tbsp sofrito', '1 cup tomato sauce', '1 cup water', '1/2 tsp salt', 'Method',
        '1. Cook the sofrito and onion in a pot for 3 minutes.', '2. Add the beans, potato, tomato sauce and water.', '3. Simmer for 20 minutes until the potato is soft and the sauce thickens.']],
];
function pdf(recipes = RECIPES) {
    const esc = t => String(t).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?');
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pagesId = objects.length + 1 + recipes.length * 2;
    const kids = [];
    recipes.forEach(([title, lines]) => {
        const text = [`BT /F1 20 Tf 50 760 Td (${esc(title)}) Tj ET`]
            .concat(lines.map((l, i) => `BT /F1 12 Tf 50 ${725 - i * 18} Td (${esc(l)}) Tj ET`)).join('\n');
        const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
    });
    add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}
module.exports = { pdf, RECIPES };
