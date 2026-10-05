// Free recipe APIs as sources (finder.js): FatSecret's recipes read from its answers, used for the
// plan only (never kept in the library), and the same rules as every other recipe.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finder.js');

const fsRecipe = {
    recipe_id: '91', recipe_name: 'Turkey Taco Lettuce Wraps', recipe_description: 'Lean turkey tacos in crisp lettuce cups.', number_of_servings: '4',
    preparation_time_min: '10', cooking_time_min: '15', recipe_url: 'https://www.fatsecret.com/recipes/turkey-taco-lettuce-wraps/Default.aspx',
    ingredients: { ingredient: [{ ingredient_description: '1 lb lean ground turkey' }, { ingredient_description: '1 tbsp chili powder' }, { ingredient_description: '1 head butter lettuce' }, { ingredient_description: '1 cup salsa' }, { ingredient_description: '1/2 cup shredded cheddar' }] },
    directions: { direction: [{ direction_number: '2', direction_description: 'Spoon into lettuce cups and top with salsa and cheese.' }, { direction_number: '1', direction_description: 'Brown the turkey with the chili powder.' }] },
    serving_sizes: { serving: { calories: '290', protein: '28', carbohydrate: '7', fat: '16' } },
    recipe_types: { recipe_type: ['Main Dish', 'Lunch'] },
};

test('FatSecret recipes are read in full, with their own numbers, and marked for this plan only', () => {
    const r = F.fromFatSecret(fsRecipe);
    assert.equal(r.servings, 4);
    assert.equal(r.time_minutes, 25);
    assert.deepEqual(r.steps, ['Brown the turkey with the chili powder.', 'Spoon into lettuce cups and top with salsa and cheese.']);
    assert.equal(r.nutrition.calories, 290);
    assert.equal(r.source_id, 'fatsecret');
    assert.ok(r.no_store);
});

test('a FatSecret search asks for protein-rich recipes of the meal\'s type, and falls back when v3 isn\'t on the free plan', async () => {
    const asked = [];
    const service = async (svc, req) => {
        asked.push(req.query);
        if (req.query.method === 'recipes.search.v3') return { status: 200, body: JSON.stringify({ error: { code: 12, message: 'User is not authorized to access this method' } }) };
        if (req.query.method === 'recipes.search') return { status: 200, body: JSON.stringify({ recipes: { recipe: [{ recipe_id: '91' }] } }) };
        return { status: 200, body: JSON.stringify({ recipe: fsRecipe }) };
    };
    const list = await F.fatsecretRecipes({ service }, 'lunch', 'turkey wrap', { proteinShare: 30, maxKcal: 600, minKcal: 280 }, null);
    assert.equal(list.length, 1);
    assert.equal(asked[0]['protein_percentage.from'], '30');
    assert.equal(asked[0].recipe_types, 'Lunch');
    assert.equal(asked[1].method, 'recipes.search');
    assert.equal(asked[2].method, 'recipe.get.v2');
});
