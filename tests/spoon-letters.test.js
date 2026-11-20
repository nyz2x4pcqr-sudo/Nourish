// 0.1.15: "1 T tamari" and "1 t salt" (a capital T is a tablespoon, a small t a teaspoon). The plan
// audit found "2 T olive oil" counted as 200 g of oil, 1,768 kcal.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../units.js');
const N = require('../nutrition.js');

test('T is a tablespoon and t a teaspoon, but T-bone and tomatoes stay as they are', () => {
    assert.equal(U.splitIngredient('1 T tamari').unit, 'tbsp');
    assert.equal(U.splitIngredient('1 T. honey').unit, 'tbsp');
    assert.equal(U.splitIngredient('1 t salt').unit, 'tsp');
    assert.equal(U.splitIngredient('1 t. vanilla').unit, 'tsp');
    assert.equal(U.splitIngredient('1 T-bone steak').unit, '');
    assert.equal(U.splitIngredient('2 tomatoes').unit, '');
    const oil = N.calculate(['2 T olive oil'], 1).lines[0];
    assert.ok(oil.kcal > 200 && oil.kcal < 280, `2 tbsp olive oil: ${oil.kcal} kcal`);
});
