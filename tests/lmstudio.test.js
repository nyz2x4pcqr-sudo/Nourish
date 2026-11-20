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
