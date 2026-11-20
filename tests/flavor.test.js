// 0.1.17: tasty first. Recipes are ranked by a flavor score (real seasoning), how familiar the dish
// is, and the site's star rating weighted by how many people rated it. Plain recipes get
// near-zero-calorie flavor boosts, and a thumbs down keeps a dish out of plans.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const PL = require('../planner.js');
const T = require('../taste.js');
const S = require('../sources.js');
const O = require('../ondevice.js');

const mk = (name, ingredients, extra = {}) => N.settle(Object.assign({ name, servings: 2, steps: ['Cook it.', 'Serve.'], ingredients }, extra));

test('the flavor score counts kinds of seasoning, not lines', () => {
    const plain = mk('Baked Chicken Breast', ['2 chicken breasts', '1 tbsp olive oil', 'salt and pepper to taste']);
    const tasty = mk('Chicken Fajitas', ['2 chicken breasts', '1 onion', '2 cloves garlic', '1 tsp cumin', '1 tsp smoked paprika', '1 lime', '2 tbsp chopped cilantro', '1 jalapeno', '1/2 tsp salt', '1 tbsp olive oil']);
    assert.ok(PL.flavorScore(plain).score < PL.BLAND_BELOW, `plain scored ${PL.flavorScore(plain).score}`);
    assert.ok(PL.flavorScore(tasty).score >= 8, `fajitas scored ${PL.flavorScore(tasty).score}`);
    assert.deepEqual(PL.flavorScore(plain).missing.slice(0, 2), ['aromatics', 'sauce']);
    // A sweet breakfast is scored on its own flavors (fruit, cinnamon, vanilla), not on garlic.
    const oats = mk('Apple Cinnamon Overnight Oats', ['1/2 cup rolled oats', '1/2 cup milk', '1 apple', '1/2 tsp cinnamon', '1/4 tsp vanilla extract', '1 tbsp chopped walnuts']);
    assert.equal(PL.flavorScore(oats).savory, false);
    assert.ok(PL.flavorScore(oats).score >= 6);
});

test('familiar dishes come first; odd combinations need many good ratings', () => {
    assert.equal(PL.familiarity({ name: 'Turkey Chili', ingredients: ['1 lb ground turkey'] }), 1);
    assert.ok(PL.familiarity({ name: 'Chicken Lollipop', ingredients: ['8 chicken wings'] }) < 0.3);
    assert.ok(PL.familiarity({ name: 'Sour cream porridge with rhubarb compote', ingredients: ['1 cup oats'] }) < 1);
    assert.ok(PL.familiarity({ name: 'Chocolate Chicken Bites', ingredients: ['1 chicken breast', '2 tbsp cocoa'] }) < 0.5);
    // Hundreds of people loved it: familiar enough, whatever it's called.
    assert.ok(PL.familiarity({ name: 'Chicken Lollipop', ingredients: ['8 chicken wings'], rating: { value: 4.8, count: 400 } }) >= 0.9);
});

test('stars count for more with more reviews', () => {
    const one = PL.ratingScore({ value: 5, count: 1 });
    const many = PL.ratingScore({ value: 4.8, count: 900 });
    assert.ok(many > one * 3, `${many} vs ${one}`);
    assert.ok(PL.ratingScore({ value: 3.2, count: 200 }) < 0);
    assert.equal(PL.ratingScore(null), 0);
});

test('a tasty, well-rated recipe from a trusted site beats a plain one that fits as well', () => {
    const base = ['1 lb chicken breast', '1 cup brown rice', '2 cups broccoli', '1 tbsp olive oil'];
    const plain = mk('Chicken and Rice', base.concat(['1/2 tsp salt']), { source_id: 'x', source_url: 'https://a.example/plain' });
    const tasty = mk('Garlic Ginger Chicken Stir Fry', base.concat(['1/2 tsp salt', '3 cloves garlic', '1 tbsp grated ginger', '2 tbsp low-sodium soy sauce', '1 lime', '2 green onions', '1/2 tsp red pepper flakes']),
        { source_id: 'y', source_url: 'https://b.example/tasty', source_tier: 'trusted', rating: { value: 4.8, count: 350 } });
    assert.ok(PL.quality(tasty) > PL.quality(plain) + 0.3);
    const res = PL.planWeek({ pools: { breakfast: [], lunch: [], dinner: [plain, tasty] }, settings: { calorie_target: 2000, meal_slots: 'dinner' }, days: 1, people: 1 });
    assert.equal(res.days[0].dinner.name, tasty.name);
});

test('plain recipes get near-zero-calorie boosts that suit them; tasty ones get none', () => {
    const plain = mk('Scrambled Eggs', ['4 large eggs', '1 tsp butter', 'salt to taste']);
    const boosts = PL.flavorBoosts(plain);
    assert.ok(boosts.length >= 2 && boosts.length <= 3);
    boosts.forEach(b => assert.ok(N.calculate([b.line], 2).nutrition.calories <= 15, `${b.line} is not near zero calories`));
    assert.ok(!boosts.some(b => /egg|butter/i.test(b.line)));
    const tasty = mk('Chicken Fajitas', ['2 chicken breasts', '1 onion', '2 cloves garlic', '1 tsp cumin', '1 tsp smoked paprika', '1 lime', '2 tbsp chopped cilantro', '1 jalapeno', '1/2 tsp salt']);
    assert.deepEqual(PL.flavorBoosts(tasty), []);
});

test('a thumbs down keeps a dish out of plans; a thumbs up brings it back', () => {
    const a = mk('Turkey Chili', ['1 lb ground turkey', '1 can kidney beans', '1 can diced tomatoes', '1 onion', '1 tbsp chili powder', '1 tsp salt', '1 tsp cumin']);
    const b = mk('Beef Chili', ['1 lb lean ground beef', '1 can kidney beans', '1 can diced tomatoes', '1 onion', '1 tbsp chili powder', '1 tsp salt', '1 tsp cumin']);
    const state = T.empty();
    T.record(state, 'rate', a, { key: 'dish|turkey chili', rating: 'down', tags: [] });
    const prof = T.profile(state);
    assert.equal(T.verdictOf(prof, a), 'down');
    assert.equal(T.score(prof, a), -1);
    const taste = r => T.score(prof, r);
    taste.verdict = r => T.verdictOf(prof, r);
    const pools = { breakfast: [], lunch: [], dinner: [a, b] };
    const res = PL.planWeek({ pools, settings: { calorie_target: 2000, meal_slots: 'dinner' }, days: 1, people: 1, taste });
    assert.equal(res.days[0].dinner.name, 'Beef Chili');
    // Taking it back: the latest rating counts.
    T.record(state, 'rate', a, { key: 'dish|turkey chili', rating: 'up', tags: [] });
    assert.equal(T.verdictOf(T.profile(state), a), 'up');
});

test('sources: trusted sites are tiered; sites whose rules forbid automated reading stay out', () => {
    const ids = S.usable().map(s => s.id);
    ['thehealthymaven', 'skinnytaste', 'wellplated'].forEach(id => assert.ok(!ids.includes(id), id));
    assert.ok(S.usable().filter(s => s.tier === 'trusted').length >= 8);
    S.SITES.filter(s => s.status === 'dropped').forEach(s => assert.ok(s.why, `${s.id} has no reason`));
});

test('the AI is told to write familiar, full-flavored dishes, and a bland one is made again', () => {
    const rules = O.recipeRules(1);
    assert.match(rules, /well-known/);
    assert.match(rules, /FULL of flavor/);
    assert.ok(!/lamb/i.test(rules), 'an example dish in the rules is copied by the model');
    const bland = { name: 'Baked Chicken and Rice', servings: 1, time_minutes: 30, ingredients: ['6 oz chicken breast', '1/2 cup rice', '1 tsp olive oil', '1/4 tsp salt'], steps: ['Bake the chicken at 400°F for 25 minutes.', 'Cook the rice.', 'Serve the chicken over the rice.'], nutrition: { calories: 520, protein_g: 45, carbs_g: 45, fat_g: 12 } };
    const problems = O.allProblems(bland, 'dinner', [], null);
    const p = problems.find(x => /taste bland/.test(x));
    assert.ok(p, problems.join('; '));
    assert.deepEqual(O.hardProblems([p]), [p]);
});

test('a recipe keeps its own photo (https only), and a description never starts with stray punctuation', () => {
    const F = require('../finder.js');
    const I = require('../importer.js');
    const base = { name: 'Chicken Fajitas', servings: 2, ingredients: ['2 chicken breasts', '1 onion', '1 red bell pepper', '2 tsp fajita seasoning', '1 tbsp olive oil', '4 small tortillas'], steps: ['Slice the chicken, onion and pepper.', 'Fry with the seasoning for 10 minutes.', 'Serve in warm tortillas.'], source_url: 'https://example.com/fajitas' };
    assert.equal(F.tidy(Object.assign({ image: 'https://example.com/fajitas.jpg' }, base), { id: 'x', name: 'X' }).image, 'https://example.com/fajitas.jpg');
    assert.equal(F.tidy(Object.assign({ image: 'http://example.com/fajitas.jpg' }, base), { id: 'x', name: 'X' }).image, undefined);
    assert.equal(F.tidy(Object.assign({ image: 'javascript:alert(1)' }, base), { id: 'x', name: 'X' }).image, undefined);
    assert.equal(I.wholeSentences('). I use bottled sauce. It works.'), 'I use bottled sauce. It works.');
});
