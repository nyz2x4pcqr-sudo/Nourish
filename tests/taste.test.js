// The app learns the person (taste.js): a profile from what they do, used to score recipes and
// guide the AI, which they can see, correct and reset.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../taste.js');

const R = (name, ingredients, extra = {}) => Object.assign({ name, ingredients, steps: ['Prep.', 'Cook for 10 minutes.', 'Serve.'], servings: 2, nutrition: { calories: 500, protein_g: 35, carbs_g: 40, fat_g: 20 } }, extra);
const SALMON = R('Lemon Garlic Salmon', ['1 lb salmon', '2 cloves garlic', '1 lemon', '1 tbsp olive oil', '1/2 tsp salt', '1 tsp dill']);
const SALMON2 = R('Salmon Rice Bowl', ['8 oz salmon', '1 cup rice', '1 lemon', '1 cucumber', '1 tbsp soy sauce']);
const MUSHROOM = R('Creamy Mushroom Pasta', ['8 oz pasta', '1 lb mushrooms', '1 cup cream', '2 cloves garlic', '1/2 tsp salt']);
const MUSH2 = R('Mushroom Risotto', ['1 cup arborio rice', '1 lb mushrooms', '4 cups broth', '1/4 cup parmesan', '1/2 tsp salt']);
const CURRY = R('Fiery Thai Red Curry', ['1 lb chicken thighs', '3 tbsp red curry paste', '2 thai chilies', '1 tsp chili flakes', '1 can coconut milk', '1 tbsp fish sauce']);
const DAY = 86400000;

test('likes and dislikes are learned from saves, ratings, swaps and skips', () => {
    const s = T.empty();
    const now = Date.now();
    T.record(s, 'save', SALMON, {}, now);
    T.record(s, 'rate', SALMON, { key: 'd1-dinner', rating: 'up', tags: ['loved'] }, now);
    T.record(s, 'eaten', SALMON2, { slot: 'dinner', hour: 19 }, now);
    T.record(s, 'swap', MUSHROOM, {}, now);
    T.record(s, 'rate', MUSH2, { key: 'd2-dinner', rating: 'down' }, now);
    const p = T.profile(s, now);
    assert.ok(p.likes.includes('salmon'), p.likes.join(','));
    assert.ok(p.dislikes.includes('mushroom'), p.dislikes.join(','));
    assert.ok(T.score(p, R('Grilled Salmon with Lemon', ['1 lb salmon', '1 lemon', '1/2 tsp salt'])) > T.score(p, R('Mushroom Soup', ['1 lb mushrooms', '4 cups broth', '1/2 tsp salt'])));
    assert.match(T.guidance(p), /salmon/);
    assert.match(T.guidance(p), /Avoid if you can: .*mushroom/);
});

test('a new rating for the same meal replaces the old one, and old signals fade', () => {
    const s = T.empty();
    const now = Date.now();
    T.record(s, 'rate', MUSHROOM, { key: 'k', rating: 'down' }, now);
    T.record(s, 'rate', MUSHROOM, { key: 'k', rating: 'up' }, now);
    assert.equal(s.events.filter(e => e.type === 'rate').length, 1);
    const old = T.empty();
    T.record(old, 'save', SALMON, {}, now - 400 * DAY);
    T.record(old, 'save', SALMON2, {}, now - 400 * DAY);
    assert.ok(!T.profile(old, now).likes.includes('salmon'), 'a year-old save still counts in full');
});

test('spice, effort and portions are learned from "too bland", "too much work" and "too small"', () => {
    const s = T.empty();
    const now = Date.now();
    for (let i = 0; i < 3; i++) T.record(s, 'rate', SALMON, { key: `b${i}`, rating: 'down', tags: ['too_bland'] }, now);
    T.record(s, 'rate', CURRY, { key: 'c', rating: 'up', tags: ['loved'] }, now);
    const hard = R('Beef Wellington', ['2 lb beef tenderloin', '1 lb puff pastry', '8 oz mushrooms', '4 slices prosciutto', '2 egg yolks', '2 tbsp mustard', '1 tsp salt', '1 tsp thyme'],
        { steps: ['Sear the beef.', 'Make the duxelles.', 'Wrap in prosciutto.', 'Wrap in the pastry dough.', 'Chill 30 minutes.', 'Brush with yolk.', 'Bake 40 minutes.', 'Rest and serve.'] });
    T.record(s, 'rate', hard, { key: 'w', rating: 'down', tags: ['too_much_work'] }, now);
    T.record(s, 'rate', SALMON2, { key: 's1', rating: 'up', tags: ['too_small'] }, now);
    T.record(s, 'rate', SALMON, { key: 's2', rating: 'up', tags: ['too_small'] }, now);
    const p = T.profile(s, now);
    assert.equal(p.spice, 'hot');
    assert.ok(p.maxEffort < 10 && p.effort !== 'involved', `${p.effort} ${p.maxEffort}`);
    assert.equal(p.filling, 'more');
    assert.ok(T.score(p, hard) < T.score(p, SALMON2));
});

test('what they tell the chef counts: "I love salmon", "no more mushrooms", "too spicy"', () => {
    const s = T.empty();
    T.fromChat(s, 'I love salmon and shrimp, but no more mushrooms please. Last night was too spicy.');
    const p = T.profile(s);
    assert.ok(p.likes.includes('salmon') && p.likes.includes('shrimp'), p.likes.join(','));
    assert.ok(p.dislikes.includes('mushroom'), p.dislikes.join(','));
    assert.ok(!p.likes.some(w => /mushroom/.test(w)), `"no more mushrooms" read as a like: ${p.likes}`);
    assert.equal(p.spice, 'mild');
    const t = T.empty();
    T.fromChat(t, 'More salmon please! I really like thai food.');
    assert.ok(T.profile(t).likes.includes('salmon') && T.profile(t).likes.includes('thai'), T.profile(t).likes.join(','));
});

test('corrections win, forgetting removes, reset clears, and switching learning off stops recording', () => {
    const s = T.empty();
    T.record(s, 'swap', MUSHROOM);
    T.record(s, 'swap', MUSH2);
    s.overrides.ingredients.mushroom = 'like';
    assert.ok(T.profile(s).likes.includes('mushroom'));
    s.overrides.ingredients.mushroom = 'forget';
    const p = T.profile(s);
    assert.ok(!p.likes.includes('mushroom') && !p.dislikes.includes('mushroom'));
    s.overrides.spice = 'mild';
    assert.equal(T.profile(s).spice, 'mild');
    const e = T.record(s, 'save', SALMON);
    T.forget(s, e.t);
    assert.ok(!s.events.some(x => x.t === e.t && x.type === 'save'));
    s.on = false;
    assert.equal(T.record(s, 'save', SALMON), null);
    assert.equal(T.score(T.profile(s), SALMON), 0);
    const fresh = T.clean(null);
    assert.equal(fresh.events.length, 0);
    assert.equal(T.guidance(T.profile(fresh)), '');
});

test('the usual meal times are learned from when meals are marked eaten', () => {
    const s = T.empty();
    [7.5, 8, 8.5, 8].forEach((hour, i) => T.record(s, 'eaten', SALMON2, { slot: 'breakfast', hour }, Date.now() - i * DAY));
    assert.equal(T.profile(s).mealTimes.breakfast, 8);
    assert.equal(T.profile(s).mealTimes.dinner, null);
});
