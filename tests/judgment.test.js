// Better meal judgment: a dish is judged by what it is (its category, course, ingredients and how
// it's eaten), not by single words in its title like "sauce" or "pudding". A side, snack or part of a
// meal isn't a meal; a complete egg dish is.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');
const F = require('../finder.js');

const fit = (name, category = '', ingredients = ['2 large eggs', '1 cup chicken broth', '1/2 tsp salt']) => PL.mealFit({ name, category, ingredients });

test('an egg dish in a sauce is an egg dish, not a sauce', () => {
    const f = fit('Eggs in Spicy Tomato Sauce');
    assert.ok(f.breakfast && f.lunch, JSON.stringify(f));
    assert.equal(F.notAMeal({ name: 'Eggs in Spicy Tomato Sauce' }), '');
    assert.ok(fit('Baked Eggs with Spinach and Feta').breakfast);
    // A real sauce still isn't a meal.
    assert.ok(F.notAMeal({ name: 'Spicy Tomato Sauce' }));
});

test('chia pudding is a breakfast, even when the site also tags it dessert', () => {
    assert.ok(fit('Chia Pudding', 'Breakfast, Dessert').breakfast);
    assert.ok(fit('Chocolate Chia Seed Pudding', 'Breakfast').breakfast);
    assert.ok(!fit('Chocolate Pudding', 'Dessert').breakfast);
});

test('marinated or boiled eggs, and side dishes, are parts of a meal, not meals', () => {
    for (const [name, cat] of [['Korean Marinated Eggs (Mayak Eggs)', 'Side Dish'], ['Soy Sauce Eggs', ''], ['Hard Boiled Eggs', ''], ['Roasted Broccoli', 'Side Dish'], ['Garlic Bread', 'Side']]) {
        const f = fit(name, cat);
        assert.ok(!f.breakfast && !f.lunch && !f.dinner, `${name}: ${JSON.stringify(f)}`);
    }
});

test('a savoury porridge with meat is a lunch or dinner, not a breakfast; a sweet one is breakfast', () => {
    for (const n of ['Chicken Porridge', 'Chicken Congee', 'Pork and Ginger Congee']) {
        const f = fit(n, 'Breakfast');
        assert.ok(!f.breakfast && (f.lunch || f.dinner), `${n}: ${JSON.stringify(f)}`);
    }
    assert.ok(fit('Apple Cinnamon Porridge', '', ['1/2 cup oats', '1 cup milk', '1 apple']).breakfast);
});
