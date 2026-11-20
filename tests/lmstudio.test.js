// LM Studio on the PC: each recipe is held to a JSON shape (so it always parses and fits), and a
// text that reaches its limit is caught and the meal made again.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../ondevice.js');

test('the meal schema asks for the whole recipe, with whole-number nutrition in sane ranges', () => {
    const f = O.mealSchema(2);
    assert.equal(f.type, 'json_schema');
    const s = f.json_schema.schema;
    assert.deepEqual(s.required, ['name', 'servings', 'ingredients', 'steps', 'time_minutes', 'nutrition']);
    assert.equal(s.additionalProperties, false);
    assert.deepEqual([s.properties.servings.minimum, s.properties.servings.maximum], [2, 2]);
    for (const k of ['calories', 'protein_g', 'carbs_g', 'fat_g']) {
        assert.equal(s.properties.nutrition.properties[k].type, 'integer', k);
        assert.ok(s.properties.nutrition.properties[k].maximum <= 3000, k);
    }
    assert.equal(s.properties.ingredients.minItems, 3);
    assert.equal(s.properties.steps.maxItems, O.PC_LIMITS.maxSteps);
    // The longest answer the schema allows fits in the meal's token limit (recipe text runs about
    // 2-4 characters a token; the JSON around it is a few hundred more).
    const P = O.PC_LIMITS;
    assert.ok((P.nameChars + P.maxItems * P.itemChars + P.maxSteps * P.stepChars) / 2 + 400 < O.PC_MEAL_TOKENS);
});

test('a step that ran into the length limit is flagged, so the meal is made again', () => {
    const meal = { name: 'Lemon Garlic Salmon with Rice', servings: 1, time_minutes: 25,
        ingredients: ['150 g salmon fillet', '1 lemon', '2 cloves garlic', '1/2 cup jasmine rice', '1/2 tsp salt'],
        steps: ['Cook the rice in salted water for 15 minutes.', 'Season the salmon with salt, garlic and lemon zest.', 'X'.repeat(O.PC_LIMITS.stepChars)],
        nutrition: { calories: 520, protein_g: 38, carbs_g: 50, fat_g: 18 } };
    assert.ok(O.allProblems(meal, 'dinner', [], O.PC_LIMITS).some(p => /length limit/.test(p)));
    assert.ok(!O.allProblems(meal, 'dinner', [], null).some(p => /length limit/.test(p)));
});

test('a serving no portion can bring near the meal\'s calories is a real problem', () => {
    const at = kcal => ({ nutrition: { calories: kcal } });
    assert.equal(O.kcalProblem(at(900), 900), '');
    assert.equal(O.kcalProblem(at(1300), 900), '', '¾ of it fits');
    assert.equal(O.kcalProblem(at(520), 900), '', '1½ of it fits');
    assert.match(O.kcalProblem(at(3040), 900), /about 3040 kcal a serving, far from the 900 kcal this meal needs: smaller amounts/);
    assert.match(O.kcalProblem(at(300), 900), /bigger amounts/);
    assert.equal(O.kcalProblem(at(3040), 0), '', 'no target, no check');
    assert.equal(O.kcalProblem({}, 900), '', 'no calories: another check reports that');
    assert.equal(O.hardProblems([O.kcalProblem(at(3040), 900)]).length, 1);
});

test('a "one serving" dinner with a whole lamb shoulder is made again, and a fitting one kept', async () => {
    const steps = ['Cut the lamb into cubes and rub with the cumin and salt.', 'Brown the lamb in the olive oil for 8 minutes.',
        'Add the onion and broth, cover and simmer for 40 minutes.', 'Pour boiling water over the couscous and let it stand for 5 minutes.',
        'Serve the lamb over the couscous.'];
    const dinner = (lamb, couscous) => ({ name: 'Cumin Lamb with Couscous', servings: 1, time_minutes: 60, steps,
        ingredients: [`${lamb} g boneless lamb shoulder`, '1 tsp ground cumin', '1/2 tsp salt', '1 tbsp olive oil', '1 small onion', '1/2 cup low-sodium chicken broth', `${couscous} g couscous`],
        nutrition: { calories: 900, protein_g: 50, carbs_g: 60, fat_g: 40 } });
    const answers = [dinner(800, 200), dinner(200, 60)];
    const asks = [];
    const r = await O.makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: [], kcal: 900 }, async msgs => { asks.push(msgs[1].content); return JSON.stringify(answers[asks.length - 1]); });
    assert.equal(asks.length, 2);
    assert.match(asks[1], /far from the 900 kcal this meal needs: smaller amounts/);
    assert.ok(r.meal.nutrition.calories < 900 * O.KCAL_FIT.max, String(r.meal.nutrition.calories));
    assert.deepEqual(r.problems, []);
});
