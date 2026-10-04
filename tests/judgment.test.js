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

test('a main dish filed under a site\'s brunch list is still a dinner (roast pork is too heavy for breakfast, so it was fitting nothing)', () => {
    const roast = PL.mealFit({ name: 'Roast pork with hasselback potatoes', category: 'Brunch', ingredients: ['1kg pork belly', '500g potatoes', '2 tbsp olive oil', '1 tsp salt'] });
    assert.ok(roast.dinner, JSON.stringify(roast));
    assert.ok(!roast.breakfast);
    const bake = PL.mealFit({ name: 'Tuna pasta bake', category: 'Brunch', ingredients: ['300g penne', '2 cans tuna', '200g cheddar', '400g chopped tomatoes'] });
    assert.ok(bake.dinner, JSON.stringify(bake));
    // A real brunch dish filed under brunch stays a breakfast only.
    const pancakes = PL.mealFit({ name: 'Buttermilk pancakes', category: 'Brunch', ingredients: ['200g flour', '300ml buttermilk', '1 egg', '2 tbsp sugar', '1 tsp baking powder', 'pinch salt'] });
    assert.ok(pancakes.breakfast && !pancakes.dinner, JSON.stringify(pancakes));
});

test('a vegetable curry, stew or veggie pie is a dinner even without meat or fish', () => {
    const pasanda = PL.mealFit({ name: 'Mushroom pasanda', category: 'Dinner', ingredients: ['400g chestnut mushrooms', '1 onion', '150ml natural yogurt', '2 tbsp ground almonds', '1 tsp garam masala', '1/2 tsp salt'] });
    assert.ok(pasanda.dinner, JSON.stringify(pasanda));
    const pie = PL.mealFit({ name: 'Carrot and swede-topped veggie cottage pie', category: '', ingredients: ['400g green lentils', '2 carrots', '1 swede', '1 onion', '500ml vegetable stock', '1 tbsp tomato puree'] });
    assert.ok(pie.dinner, JSON.stringify(pie));
    // Every recipe that fits no meal says why.
    const sauce = PL.mealFit({ name: 'Hollandaise sauce', category: '', ingredients: ['3 egg yolks', '150g butter', '1 tbsp lemon juice'] });
    assert.ok(!sauce.breakfast && !sauce.lunch && !sauce.dinner && sauce.why);
});

// 0.1.12
test('articles and guides are not recipes, even with recipe data', () => {
    for (const name of ['How To Build a Better Smoothie', '15 Easy Breakfast Ideas', 'A Beginner\'s Guide to Meal Prep', 'Healthy Lunch Tips', 'The Best Ways to Cook Salmon']) {
        const f = PL.mealFit({ name, ingredients: ['1 cup milk', '1 banana', '2 tbsp oats'], steps: ['Blend.'] });
        assert.ok(!f.breakfast && !f.lunch && !f.dinner, name);
        assert.match(f.why, /article or guide/, name);
    }
    assert.ok(PL.mealFit({ name: 'Smoked Salmon Bagel', ingredients: ['1 bagel', '2 oz smoked salmon', '1 tbsp cream cheese'] }).breakfast);
});

test('smoothies follow one rule: a breakfast only when filling enough to be a meal, otherwise a drink', () => {
    const smoothie = (name, calories, protein_g) => PL.mealFit({ name, ingredients: ['1 cup milk', '1 banana'], nutrition: { calories, protein_g, carbs_g: 30, fat_g: 5 } });
    assert.ok(smoothie('Peanut Butter Banana Protein Smoothie', 420, 28).breakfast);
    assert.ok(smoothie('Green Smoothie', 310, 14).breakfast);
    const light = smoothie('Strawberry Smoothie', 140, 4);
    assert.ok(!light.breakfast && !light.lunch && !light.dinner);
    assert.match(light.why, /a drink .*too light to be a meal/);
    const shake = smoothie('Mango Lassi Shake', 180, 6);
    assert.ok(!shake.breakfast);
    // Never a lunch or dinner either way.
    assert.ok(!smoothie('Big Protein Shake', 600, 40).dinner);
});

test('a dish that says breakfast and is made with eggs is a breakfast (Breakfast Enchiladas were turned away as a dinner dish)', () => {
    const f = PL.mealFit({ name: 'Breakfast Enchiladas', ingredients: ['8 eggs', '6 flour tortillas', '1 cup salsa', '1 cup cheddar', '1/2 lb sausage'], steps: ['Bake.'] });
    assert.ok(f.breakfast, JSON.stringify(f));
    assert.ok(!f.dinner);
    // Enchiladas without the word breakfast are still a dinner.
    const d = PL.mealFit({ name: 'Chicken Enchiladas', ingredients: ['2 cups chicken', '8 tortillas', '2 cups enchilada sauce'] });
    assert.ok(d.dinner && !d.breakfast);
});
