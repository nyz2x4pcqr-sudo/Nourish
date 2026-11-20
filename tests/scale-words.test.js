// A portion of one reads in the singular ("½ cucumber"), but never turns into another food or a
// non-word: the 0.1.15 plan audit found "red chilly", "bay leave" and "½ sugar snap pea" (read as
// sugar), each counted as a changed recipe.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');

const oneOf = line => PL.scaleRecipe({ name: 'x', servings: 4, ingredients: [line], steps: ['Cook.'] }, 1, 1).ingredients[0];
const foods = lines => PL.ingredientFoods({ ingredients: lines });

test('a share of one is still the same food, in a real word', () => {
    const cases = {
        '3 bay leaves': '1 bay leaf',
        '2 red chillies, finely chopped': '½ red chillies, finely chopped',
        '2 sugar snap peas': '½ sugar snap peas',
        '2 snow peas or sugar snap peas': '½ snow peas or sugar snap peas',
        '4 cherries': '1 cherry',
        '2 tomatoes': '½ tomato',
        '4 cloves garlic': '1 clove garlic',
    };
    for (const [line, want] of Object.entries(cases)) {
        const got = oneOf(line);
        assert.equal(got, want, line);
        assert.deepEqual(foods([got]), foods([line]), `${line} → ${got} must be the same food`);
    }
});
