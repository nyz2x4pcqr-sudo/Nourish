// Breakfast is breakfast, lunch is lunch, dinner is dinner: enforced in code (planner.js), with the
// person's schedule (Settings → My schedule) as hard limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');

const R = (name, ingredients, steps, extra = {}) => Object.assign({ name, ingredients, steps, servings: 4, nutrition: { calories: 500, protein_g: 30, carbs_g: 40, fat_g: 20 } }, extra);
const LAMB = R('Roast Leg of Lamb with Rosemary', ['4 lb leg of lamb', '6 cloves garlic', '2 tbsp rosemary', '2 tbsp olive oil', '1 tsp salt', '1 tsp black pepper'],
    ['Preheat the oven to 450°F.', 'Cut small slits in the lamb and push in the garlic and rosemary.', 'Rub with oil, salt and pepper.', 'Roast for 20 minutes, then lower to 350°F and roast for 1 hour 15 minutes.', 'Rest for 20 minutes, carve and serve.'], { time_minutes: 120 });
const BAKED_ZITI = R('Baked Ziti', ['1 lb ziti', '1 lb Italian sausage', '24 oz marinara', '15 oz ricotta', '2 cups mozzarella', '1/2 cup parmesan', '1 tsp salt', '1 tsp oregano'],
    ['Boil the ziti for 8 minutes.', 'Brown the sausage.', 'Mix the pasta, sauce, sausage and ricotta.', 'Top with the cheeses.', 'Bake at 375°F for 30 minutes and serve.'], { time_minutes: 55 });
const LASAGNA = R('Classic Beef Lasagna', ['12 lasagna noodles', '1 lb ground beef', '24 oz marinara', '15 oz ricotta', '2 cups mozzarella', '1 egg', '1 tsp salt'],
    ['Boil the noodles.', 'Brown the beef and add the sauce.', 'Layer noodles, ricotta, sauce and cheese.', 'Bake for 45 minutes.', 'Rest 15 minutes and serve.'], { time_minutes: 90 });
const EGGS = R('Scrambled Eggs on Toast', ['4 large eggs', '2 slices bread', '1 tbsp butter', '1/4 tsp salt', '1 pinch black pepper'],
    ['Toast the bread.', 'Whisk the eggs with the salt and pepper.', 'Cook in the butter over low heat for 2 minutes, stirring, and serve on the toast.'], { time_minutes: 10 });
const OATS = R('Overnight Oats', ['1 cup rolled oats', '1 cup milk', '1/2 cup greek yogurt', '1 tbsp maple syrup', '1/2 cup berries'],
    ['Stir the oats, milk, yogurt and syrup together in a jar.', 'Refrigerate overnight, at least 8 hours.', 'Top with the berries and serve.'], { time_minutes: 485 });
const BIG_BREAKFAST = R('Eggs Benedict with Hollandaise and Hash Browns', ['4 eggs', '2 english muffins', '4 slices canadian bacon', '3 egg yolks', '1/2 cup butter', '1 lemon', '2 potatoes', '1 onion', '1 tsp paprika', '1 tsp salt', '1/4 cup vinegar', '1 tbsp chives'],
    ['Grate the potatoes.', 'Fry the hash browns for 15 minutes.', 'Melt the butter.', 'Whisk the yolks over simmering water.', 'Stream in the butter.', 'Poach the eggs for 3 minutes.', 'Toast the muffins.', 'Warm the bacon.', 'Assemble and serve.'], { time_minutes: 50 });
const SALAD = R('Chicken Caesar Salad', ['8 oz cooked chicken', '1 head romaine', '1/4 cup caesar dressing', '1/4 cup parmesan', '1 cup croutons', '1/4 tsp black pepper'],
    ['Slice the chicken and chop the lettuce.', 'Toss with the dressing.', 'Top with the chicken, parmesan and croutons and serve.'], { time_minutes: 10 });
const CURRY = R('Chicken Tikka Masala', ['2 lb chicken thighs', '1 cup yogurt', '2 tbsp garam masala', '1 onion', '4 cloves garlic', '1 tbsp ginger', '28 oz crushed tomatoes', '1 cup cream', '1 tsp salt'],
    ['Marinate the chicken.', 'Grill it.', 'Cook the onion, garlic and ginger.', 'Add the spices and tomatoes and simmer for 20 minutes.', 'Add the cream and chicken and serve with rice.'], { time_minutes: 70 });
const STEW = R('Beef Bourguignon', ['3 lb beef chuck', '1 bottle red wine', '6 slices bacon', '1 lb mushrooms', '2 carrots', '1 onion', '3 cloves garlic', '2 tbsp tomato paste', '2 cups beef stock', '1 tsp thyme', '1 tsp salt'],
    ['Brown the bacon and beef.', 'Cook the vegetables.', 'Add the wine, stock and paste.', 'Braise in the oven at 325°F for 3 hours.', 'Add the mushrooms and serve.'], { time_minutes: 210 });
const PANCAKES = R('Buttermilk Pancakes', ['2 cups flour', '2 tbsp sugar', '2 tsp baking powder', '1/2 tsp salt', '2 cups buttermilk', '2 eggs', '3 tbsp butter'],
    ['Mix the dry ingredients.', 'Whisk the buttermilk, eggs and melted butter.', 'Combine.', 'Cook on a griddle for 3 minutes a side, in batches, about 20 minutes.', 'Serve warm.'], { time_minutes: 30 });
const YOGURT = R('Greek Yogurt Parfait', ['1 cup greek yogurt', '1/2 cup granola', '1/2 cup berries', '1 tsp honey'], ['Layer the yogurt, granola and berries in a glass.', 'Drizzle with honey and serve.'], { time_minutes: 5 });

test('obvious bad cases are rejected: lamb roast at breakfast, baked pasta and lasagna at lunch', () => {
    assert.match(PL.slotProblem(LAMB, 'breakfast'), /dinner dish|isn't a breakfast/);
    assert.match(PL.slotProblem(BAKED_ZITI, 'lunch'), /too heavy for lunch|takes about/);
    assert.match(PL.slotProblem(LASAGNA, 'lunch'), /too heavy for lunch/);
    assert.match(PL.slotProblem(CURRY, 'lunch'), /too heavy for lunch/);
    assert.match(PL.slotProblem(BIG_BREAKFAST, 'breakfast'), /takes about|steps|ingredients|too much work/);
    assert.match(PL.slotProblem(STEW, 'breakfast'), /./);
    assert.match(PL.slotProblem(STEW, 'lunch'), /./);
});

test('good fits pass: quick breakfasts, a quick lunch, and long, involved dinners', () => {
    assert.equal(PL.slotProblem(EGGS, 'breakfast'), '');
    assert.equal(PL.slotProblem(YOGURT, 'breakfast'), '');
    assert.equal(PL.slotProblem(SALAD, 'lunch'), '');
    assert.equal(PL.slotProblem(LAMB, 'dinner'), '');
    assert.equal(PL.slotProblem(STEW, 'dinner'), '');
    assert.equal(PL.slotProblem(BAKED_ZITI, 'dinner'), '');
    // Overnight oats: 8 hours of waiting in the fridge isn't 8 hours of work.
    assert.equal(PL.slotProblem(OATS, 'breakfast'), '');
    assert.equal(PL.slotProblem(Object.assign({}, OATS, { active_minutes: 5 }), 'breakfast'), '');
});

test('every recipe gets a meal type, total time and difficulty score', () => {
    const lamb = PL.recipeProfile(LAMB);
    assert.equal(lamb.mealType, 'dinner');
    assert.equal(lamb.minutes, 120);
    assert.ok(lamb.difficulty > PL.recipeProfile(YOGURT).difficulty);
    assert.ok(lamb.techniques.includes('roast'));
    const y = PL.recipeProfile(YOGURT);
    assert.equal(y.mealType, 'breakfast');
    assert.ok(y.difficulty <= 2 && !y.cooked);
    // No time given: estimated from the steps and techniques, and marked as an estimate.
    const noTime = PL.recipeProfile(Object.assign({}, STEW, { time_minutes: null }));
    assert.ok(noTime.timeEstimated && noTime.minutes >= 180, noTime.minutes);
    assert.match(PL.slotProblem(Object.assign({}, BAKED_ZITI, { name: 'Ziti with Sausage', time_minutes: null }), 'lunch'), /estimated/);
});

test('my schedule overrides the defaults and is a hard limit, weekdays and weekends apart', () => {
    const s = { sched_breakfast: '10', sched_weekend: 'on', sched_we_breakfast: 'norush', sched_lunch: 'nocook' };
    const monday = PL.slotLimits(s, 'breakfast', 0), saturday = PL.slotLimits(s, 'breakfast', 5);
    assert.equal(monday.minutes, 5);   // 10 minutes to make and eat it
    assert.match(PL.slotProblem(PANCAKES, 'breakfast', monday), /takes about|needs cooking/);   // 5 minutes to make it: no-cook only
    assert.equal(PL.slotProblem(PANCAKES, 'breakfast', saturday), '');
    assert.equal(PL.slotProblem(YOGURT, 'breakfast', monday), '');
    // "I don't cook this meal": no-cook food only.
    const lunch = PL.slotLimits(s, 'lunch', 2);
    assert.ok(lunch.noCook);
    assert.match(PL.slotProblem(R('Grilled Chicken Wrap', ['8 oz chicken', '2 tortillas', '1 cup lettuce', '1/4 tsp salt'], ['Grill the chicken for 10 minutes.', 'Wrap with the lettuce and serve.'], { time_minutes: 8 }), 'lunch', lunch), /needs cooking/);
    assert.equal(PL.slotProblem(SALAD, 'lunch', lunch), '');
    // Per day (Advanced) beats both.
    assert.equal(PL.slotLimits(Object.assign({ sched_d5_breakfast: '20' }, s), 'breakfast', 5).minutes, 15);
    // Nothing set: the defaults (breakfast 15 min, lunch 25 min, dinner no limit).
    assert.equal(PL.slotLimits({}, 'breakfast', 0).minutes, 15);
    assert.equal(PL.slotLimits({}, 'lunch', 0).minutes, 25);
    assert.equal(PL.slotLimits({}, 'dinner', 0).minutes, Infinity);
});

test('the planner never puts a misfit in a slot, even when it is the best calorie match', () => {
    const pools = { breakfast: [LAMB, BIG_BREAKFAST, EGGS, YOGURT, OATS], lunch: [BAKED_ZITI, LASAGNA, SALAD, CURRY], dinner: [LAMB, STEW, CURRY, BAKED_ZITI] };
    pools.breakfast.concat(pools.lunch, pools.dinner).forEach(r => { r.nutrition = { calories: 500, protein_g: 35, carbs_g: 40, fat_g: 18 }; });
    const plan = PL.planWeek({ pools, settings: { calorie_target: 1500, protein_target: 100 }, days: 3 });
    plan.days.forEach(d => {
        if (d.breakfast) assert.ok(['Scrambled Eggs on Toast', 'Greek Yogurt Parfait', 'Overnight Oats'].includes(d.breakfast.name), d.breakfast.name);
        if (d.lunch) assert.equal(d.lunch.name, 'Chicken Caesar Salad');
    });
    assert.ok(Object.keys(plan.rejected).some(k => /breakfast: Roast Leg of Lamb/.test(k)));
});

test("an AI-written meal that breaks the slot's rules is sent back with the reason", () => {
    const O = require('../ondevice.js');
    const lamb = Object.assign({}, LAMB, { name: 'Roast Lamb Breakfast Plate' });
    const problems = O.allProblems(lamb, 'breakfast', [], false);
    assert.ok(problems.some(p => /dinner dish|takes about|too much work/.test(p)), problems.join(' | '));
    assert.ok(!O.allProblems(YOGURT, 'breakfast', [], false).some(p => /breakfast|takes about/.test(p)));
    assert.match(O.slotRulesText('breakfast', 0), /breakfast food.*15 minutes/);
});

test('the built-in quick meals fill a slot when nothing else fits, never breaking its rules', () => {
    ['breakfast', 'lunch', 'dinner'].forEach(m => {
        const r = PL.quickMeal(m, PL.slotLimits({}, m), {});
        assert.ok(r && r.nutrition.calories > 0 && PL.slotProblem(r, m) === '', m);
    });
    const noCook = PL.slotLimits({ sched_breakfast: 'nocook' }, 'breakfast');
    for (let d = 0; d < 7; d++) assert.ok(!PL.recipeProfile(PL.quickMeal('breakfast', noCook, { d })).cooked);
    const vegan = r => (/yogurt|milk|egg|butter|cheese|honey/i.test(r.ingredients.join(' ')) ? 'dairy' : '');
    const b = PL.quickMeal('breakfast', PL.slotLimits({}, 'breakfast'), { exclude: vegan });
    assert.ok(!b || !vegan(b));
});
