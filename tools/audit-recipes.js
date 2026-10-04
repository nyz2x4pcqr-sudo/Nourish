// The tricky recipes in the plan audit's test books (tools/make-audit-books.js), written the way
// cookbooks print them. `is` says what each one really is, so the audit can check the app's judgment:
// 'breakfast' | 'lunch' | 'dinner' | 'main' (lunch or dinner) for meals, or the kind of non-meal.
'use strict';

const EPUB = {
    title: 'The Audit Kitchen',
    author: 'Nourish Test Kitchen',
    chapters: [
        ['Starters', [
            { title: 'Whipped Feta Dip', is: 'spread', serves: 'Serves 6', time: 'Ready in 10 minutes',
                ingredients: ['8 oz feta cheese', '1/2 cup Greek yogurt', '2 tablespoons olive oil', '1 clove garlic', '1 teaspoon lemon zest', 'Pita chips, to serve'],
                steps: ['Blend the feta, yogurt, olive oil, garlic and lemon zest until smooth.', 'Spoon into a bowl, drizzle with more oil and serve with pita chips.'] },
        ]],
        ['Mains', [
            // As it was on the phone: in the mains, nothing saying it's a starter.
            { title: 'Roasted Bone Marrow with Parsley Salad', is: 'starter', serves: 'Serves 4', time: 'Prep 15 min, plus 12 to 24 hours brining · Cook 20 min',
                intro: 'Rich, wobbly marrow spread on hot toast, cut with a sharp parsley salad.',
                ingredients: ['For the brine', '1 gallon water', '1 cup kosher salt', 'For the bones', '8 beef marrow bones, cut 3 inches long (about 3 pounds)', '1 cup flat-leaf parsley leaves', '2 shallots, thinly sliced', '1 tablespoon capers', '2 tablespoons extra-virgin olive oil', '1 tablespoon lemon juice', 'Coarse sea salt', '4 thick slices crusty bread, toasted'],
                steps: ['Dissolve the salt in the water to make a brine and soak the bones in it, refrigerated, for 12 to 24 hours, changing the brine twice.', 'Heat the oven to 450°F. Drain the bones and stand them upright on a foil-lined baking sheet.', 'Roast for 15 to 20 minutes, until the marrow is soft and starting to bubble.', 'Toss the parsley, shallots and capers with the olive oil and lemon juice.', 'Scoop the marrow onto the toast, sprinkle with sea salt and top with the parsley salad.'] },
            { title: 'Crispy Bone-In Chicken Thighs with Lemon Potatoes', is: 'main', serves: 'Serves 4', time: 'Prep 10 min · Cook 45 min',
                ingredients: ['2 pounds bone-in, skin-on chicken thighs (about 6)', '1 1/2 pounds baby potatoes, halved', '1 lemon, sliced', '4 cloves garlic, smashed', '2 tablespoons olive oil', '1 teaspoon dried oregano', '1 teaspoon salt', '1/2 teaspoon black pepper', '2 cups green beans, trimmed'],
                steps: ['Heat the oven to 425°F.', 'Toss the potatoes, lemon and garlic with half the oil and spread on a sheet pan.', 'Rub the chicken with the rest of the oil, oregano, salt and pepper and set it skin-side up on the potatoes.', 'Roast for 35 minutes, add the green beans and roast 10 minutes more, until the chicken reaches 175°F.'] },
            { title: 'Sticky Oven Baby Back Ribs', is: 'dinner', serves: 'Serves 4', time: 'Prep 15 min · Cook 3 hours',
                ingredients: ['2 racks baby back pork ribs (about 4 pounds)', '2 tablespoons brown sugar', '1 tablespoon smoked paprika', '1 teaspoon garlic powder', '1 teaspoon salt', '1 cup barbecue sauce', '4 cups coleslaw mix', '2 tablespoons mayonnaise', '1 tablespoon cider vinegar'],
                steps: ['Heat the oven to 275°F. Mix the sugar, paprika, garlic powder and salt and rub it over the ribs.', 'Wrap the ribs in foil and bake for 2 1/2 hours until tender.', 'Unwrap, brush with barbecue sauce and bake 20 minutes more until sticky.', 'Toss the coleslaw mix with the mayonnaise and vinegar and serve with the ribs.'] },
            { title: 'Brined Pork Chops with Apples', is: 'dinner', serves: 'Serves 4', time: 'Prep 15 min, plus 4 hours brining · Cook 25 min',
                ingredients: ['Brine:', '8 cups water', '1/2 cup kosher salt', '1/4 cup sugar', 'Pork:', '4 bone-in pork chops, 1 inch thick (about 2 1/2 pounds)', '2 tablespoons olive oil', '2 apples, cored and sliced', '1 onion, sliced', '1 cup chicken stock', '1 teaspoon fresh thyme', '1 pound broccoli florets'],
                steps: ['Stir the salt and sugar into the water until dissolved. Add the chops and refrigerate for 4 hours.', 'Remove the chops from the brine, discard the brine and pat dry.', 'Sear the chops in the oil for 4 minutes a side, then set aside.', 'Cook the apples and onion in the same pan for 5 minutes, add the stock and thyme and return the chops for 8 minutes.', 'Steam the broccoli and serve with the chops and apples.'] },
            { title: 'Southern Fried Chicken', is: 'dinner', serves: 'Serves 6', time: 'Prep 20 min, plus overnight soaking · Cook 30 min',
                ingredients: ['3 pounds bone-in chicken pieces (drumsticks and thighs)', '2 cups buttermilk', '2 cups all-purpose flour', '1 tablespoon paprika', '2 teaspoons salt', '1 teaspoon black pepper', '6 cups vegetable oil, for deep frying', '6 cups mixed salad leaves', '2 cups corn kernels'],
                steps: ['Soak the chicken in the buttermilk overnight in the fridge.', 'Mix the flour, paprika, salt and pepper. Lift the chicken out of the buttermilk and dredge it in the flour.', 'Heat the oil to 350°F in a deep pot and fry the chicken in batches for 12 to 15 minutes, until golden and cooked through.', 'Drain on a rack and serve with the salad and corn.'] },
            { title: 'Turkey and Bean Chili', is: 'main', serves: 'Serves 6', time: 'Ready in 45 minutes',
                ingredients: ['1 1/2 pounds ground turkey', '1 tablespoon olive oil', '1 onion, chopped', '2 cloves garlic, minced', '2 tablespoons chili powder', '1 teaspoon ground cumin', '2 cans (15 oz) kidney beans, drained', '1 can (28 oz) crushed tomatoes', '1 cup chicken broth', '1 cup brown rice, cooked'],
                steps: ['Brown the turkey in the oil with the onion and garlic.', 'Stir in the chili powder and cumin, then the beans, tomatoes and broth.', 'Simmer for 30 minutes and serve over the rice.'] },
            { title: 'Greek Chicken Grain Bowls', is: 'main', serves: 'Serves 4', time: 'Ready in 30 minutes',
                ingredients: ['1 1/2 pounds boneless skinless chicken breast', '1 cup quinoa', '2 cups water', '1 cucumber, diced', '1 cup cherry tomatoes, halved', '1/2 cup red onion, diced', '1/2 cup feta cheese', '1/2 cup hummus', '2 tablespoons olive oil', '1 tablespoon lemon juice', '1 teaspoon dried oregano'],
                steps: ['Cook the quinoa in the water for 15 minutes.', 'Season the chicken with oregano and grill for 6 minutes a side, then slice.', 'Fill bowls with quinoa, chicken, cucumber, tomatoes, onion and feta, and top with hummus, oil and lemon juice.'] },
            // A title the book printed over two lines: the reader must join it or mark it for review.
            { title: 'Lemony Kale Salad', splitTitle: ['Lemony Kale Salad', 'with Tahini and Roasted Chickpeas'], is: 'main', serves: 'Serves 2', time: 'Ready in 30 minutes',
                ingredients: ['1 bunch kale, stems removed', '1 can (15 oz) chickpeas, drained', '1 tablespoon olive oil', '3 tablespoons tahini', '2 tablespoons lemon juice', '1 cup cooked farro', '2 hard-boiled eggs', '1/4 cup feta cheese'],
                steps: ['Roast the chickpeas in the oil at 400°F for 20 minutes.', 'Massage the kale with the tahini and lemon juice.', 'Top with the farro, chickpeas, sliced eggs and feta.'] },
            { title: 'Shakshuka with Chickpeas', is: 'breakfast', serves: 'Serves 2', time: 'Ready in 20 minutes',
                ingredients: ['1 tablespoon olive oil', '1 onion, chopped', '1 red bell pepper, chopped', '1 can (14 oz) chopped tomatoes', '1/2 can (15 oz) chickpeas, drained', '1 teaspoon cumin', '4 large eggs', '2 slices whole wheat bread'],
                steps: ['Soften the onion and pepper in the oil for 5 minutes.', 'Add the tomatoes, chickpeas and cumin and simmer for 5 minutes.', 'Make four wells, crack in the eggs, cover and cook for 6 minutes. Serve with the bread.'] },
        ]],
        ['Sides and Sauces', [
            { title: 'Garlicky Green Beans', is: 'side', serves: 'Serves 4 as a side', time: 'Ready in 10 minutes',
                ingredients: ['1 pound green beans, trimmed', '1 tablespoon butter', '2 cloves garlic, sliced', '1/4 teaspoon salt'],
                steps: ['Boil the beans for 4 minutes and drain.', 'Melt the butter, add the garlic and toss the beans in it for 2 minutes.'] },
            { title: 'Chimichurri', is: 'sauce', serves: 'Makes about 1 cup', time: 'Ready in 10 minutes',
                ingredients: ['1 cup flat-leaf parsley, finely chopped', '3 cloves garlic, minced', '1/2 cup olive oil', '2 tablespoons red wine vinegar', '1/2 teaspoon red pepper flakes', '1/2 teaspoon salt'],
                steps: ['Mix everything together and leave for 20 minutes before serving with grilled meat.'] },
        ]],
        ['Drinks and Desserts', [
            { title: 'Mango Lassi', is: 'drink', serves: 'Serves 2', time: 'Ready in 5 minutes',
                ingredients: ['1 cup mango pulp', '1 cup plain yogurt', '1/2 cup milk', '2 teaspoons sugar', 'Pinch of cardamom'],
                steps: ['Blend everything until smooth and serve cold.'] },
            { title: 'Molten Chocolate Lava Cakes', is: 'dessert', serves: 'Serves 4', time: 'Prep 15 min · Bake 12 min',
                ingredients: ['4 oz dark chocolate', '1/2 cup butter', '2 eggs', '2 egg yolks', '1/4 cup sugar', '2 tablespoons flour'],
                steps: ['Melt the chocolate and butter together.', 'Whisk the eggs, yolks and sugar, then fold in the chocolate and flour.', 'Bake in buttered ramekins at 425°F for 12 minutes and turn out warm.'] },
        ]],
    ],
};

const TEXT_PDF = {
    title: 'Weeknight Classics',
    author: 'Nourish Test Kitchen',
    recipes: [
        { title: 'Beef and Broccoli Stir-Fry', is: 'main', serves: 'Serves 4', time: 'Ready in 25 minutes',
            ingredients: ['1 pound flank steak, thinly sliced', '4 cups broccoli florets', '3 tablespoons soy sauce', '1 tablespoon cornstarch', '1 tablespoon sesame oil', '2 cloves garlic', '1 tablespoon fresh ginger', '2 cups cooked jasmine rice'],
            steps: ['1. Toss the beef with the cornstarch and 1 tablespoon soy sauce.', '2. Stir-fry the beef in the oil for 3 minutes and set aside.', '3. Stir-fry the broccoli, garlic and ginger for 4 minutes, return the beef with the rest of the soy sauce and serve over rice.'] },
        { title: 'Garlic Butter Shrimp Boil', is: 'main', serves: 'Serves 4', time: 'Ready in 35 minutes',
            ingredients: ['2 pounds shell-on large shrimp', '1 pound baby potatoes', '3 ears corn, cut in thirds', '12 oz smoked sausage, sliced', '4 tablespoons butter', '4 cloves garlic', '2 tablespoons Old Bay seasoning', '1 lemon'],
            steps: ['1. Boil the potatoes in salted water for 12 minutes.', '2. Add the corn and sausage and boil 5 minutes, then the shrimp for 3 minutes.', '3. Drain and toss with the butter melted with garlic, Old Bay and lemon.'] },
        { title: 'Beer-Battered Fish and Chips', is: 'dinner', serves: 'Serves 4', time: 'Ready in 50 minutes',
            ingredients: ['1 1/2 pounds cod fillets', '1 cup all-purpose flour', '1 cup cold beer', '1 teaspoon baking powder', '2 pounds russet potatoes, cut into chips', 'Vegetable oil for deep-frying', '1 cup frozen peas', '1/2 teaspoon salt'],
            steps: ['1. Fry the chips in the hot oil at 325°F for 6 minutes, then drain.', '2. Whisk the flour, beer and baking powder into a batter and dip the fish.', '3. Fry the fish at 375°F for 5 minutes and the chips again until crisp. Serve with the peas.'] },
        { title: 'Red Lentil and Spinach Soup', is: 'main', serves: 'Serves 4', time: 'Ready in 35 minutes',
            ingredients: ['1 1/2 cups red lentils', '1 onion, chopped', '2 carrots, diced', '1 tablespoon olive oil', '1 teaspoon cumin', '6 cups vegetable broth', '4 cups baby spinach', '1/2 cup Greek yogurt'],
            steps: ['1. Soften the onion and carrot in the oil.', '2. Add the lentils, cumin and broth and simmer for 20 minutes.', '3. Stir in the spinach and serve with a spoon of yogurt.'] },
        { title: 'Banana Oat Protein Pancakes', is: 'breakfast', serves: 'Serves 2', time: 'Ready in 15 minutes',
            ingredients: ['1 cup rolled oats', '2 bananas', '2 eggs', '1 cup cottage cheese', '1 teaspoon baking powder', '1 teaspoon butter', '1/2 cup blueberries'],
            steps: ['1. Blend the oats, bananas, eggs, cottage cheese and baking powder.', '2. Cook small pancakes in the butter for 2 minutes a side and top with blueberries.'] },
        { title: 'Classic Creamy Coleslaw', is: 'side', serves: 'Serves 6 as a side', time: 'Ready in 10 minutes',
            ingredients: ['6 cups shredded cabbage', '1 carrot, grated', '1/2 cup mayonnaise', '1 tablespoon cider vinegar', '1 teaspoon sugar'],
            steps: ['1. Mix the mayonnaise, vinegar and sugar.', '2. Toss with the cabbage and carrot and chill.'] },
        { title: 'Smooth Hummus', is: 'spread', serves: 'Makes 2 cups', time: 'Ready in 10 minutes',
            ingredients: ['1 can (15 oz) chickpeas, drained', '1/3 cup tahini', '3 tablespoons lemon juice', '1 clove garlic', '3 tablespoons olive oil', '1/2 teaspoon salt'],
            steps: ['1. Blend everything until very smooth, adding a splash of water.'] },
    ],
};

const SCANNED_PDF = {
    title: 'Grandma\'s Recipe Cards',
    author: '',
    recipes: [
        { title: 'Oxtail Stew', is: 'dinner', serves: 'Serves 4', time: 'Cook 3 hours',
            ingredients: ['3 lb oxtail pieces', '2 tbsp oil', '1 onion, chopped', '2 carrots, sliced', '1 can (14 oz) tomatoes', '2 cups beef broth', '1 can (15 oz) butter beans', '2 cups cooked white rice'],
            steps: ['1. Brown the oxtail in the oil.', '2. Add the onion, carrots, tomatoes and broth and simmer covered for 3 hours.', '3. Add the beans for the last 20 minutes. Serve over rice.'] },
        { title: 'Tostones', is: 'side', serves: 'Serves 4 as a side', time: 'Ready in 20 minutes',
            ingredients: ['2 green plantains', 'Oil for frying', '1 tsp salt'],
            steps: ['1. Fry plantain slices in the oil for 3 minutes.', '2. Flatten, fry again until golden and salt.'] },
        { title: 'Flan de Leche', is: 'dessert', serves: 'Serves 8', time: 'Bake 1 hour',
            ingredients: ['1 cup sugar', '5 eggs', '1 can (14 oz) condensed milk', '1 can (12 oz) evaporated milk', '1 tsp vanilla'],
            steps: ['1. Melt the sugar into caramel and pour into a mold.', '2. Blend the rest, pour over and bake in a water bath at 350F for 1 hour.'] },
        { title: 'Pernil (Roast Pork Shoulder)', is: 'dinner', serves: 'Serves 10', time: 'Marinate overnight · Roast 6 hours',
            ingredients: ['8 lb bone-in pork shoulder', '10 cloves garlic', '2 tbsp oregano', '2 tbsp salt', '1/4 cup olive oil', '2 tbsp vinegar', '5 cups cooked rice with pigeon peas'],
            steps: ['1. Mash the garlic, oregano, salt, oil and vinegar and rub it into cuts in the pork.', '2. Marinate overnight.', '3. Roast at 325F for 6 hours. Serve with the rice.'] },
    ],
};

const ALL = [...EPUB.chapters.flatMap(([, list]) => list).map(r => Object.assign({ book: EPUB.title }, r)),
    ...TEXT_PDF.recipes.map(r => Object.assign({ book: TEXT_PDF.title }, r)),
    ...SCANNED_PDF.recipes.map(r => Object.assign({ book: SCANNED_PDF.title }, r))];

module.exports = { EPUB, TEXT_PDF, SCANNED_PDF, ALL };
