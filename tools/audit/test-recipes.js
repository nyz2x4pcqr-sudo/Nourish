// The recipes in the plan audit's test cookbooks (tools/audit/make-test-books.js). Written for
// Nourish's tests: original text, not copied from any book. Each one is here because it's tricky
// for a meal planner:
// - not a meal: an appetizer (roasted bone marrow), a side, a sauce, a spread, a drink, a dessert;
// - bone-in or shell-on: chicken pieces, ribs, short ribs, pork chops, shrimp (only the edible part counts);
// - discarded ingredients: brines, soaking water, frying oil (only what's eaten counts);
// - a title that wraps onto two lines, a page with two recipes, running heads and page numbers;
// - a luxury ingredient (lobster) and a pricey one (rack of lamb);
// - and ordinary meals for every slot.
// Each recipe: { title, chapter, serves, time, groups: [[heading, [ingredient lines]]], steps, wrapTitle }.
'use strict';

const BUTCHER = {
    title: "The Butcher's Table",
    author: 'Sam Ortega',
    chapters: [
        ['Small Plates', [
            {
                title: 'Roasted Bone Marrow with Parsley Salad', serves: 4, time: 'Prep 15 min, plus overnight soaking · Cook 20 min',
                groups: [
                    ['For the bones', ['4 pounds beef marrow bones, cut lengthwise', '1 gallon cold water', '1 cup kosher salt']],
                    ['For the salad', ['1 cup flat-leaf parsley leaves', '1 shallot, thinly sliced', '2 tsp capers, drained', '1 tbsp fresh lemon juice', '1 tbsp extra virgin olive oil']],
                    ['To serve', ['8 slices crusty bread, toasted', 'Coarse sea salt']],
                ],
                steps: [
                    'Dissolve the salt in the water in a large container, add the marrow bones and refrigerate for 12 to 24 hours, changing the salted water twice.',
                    'Drain the bones, discard the brine and pat them dry.',
                    'Heat the oven to 450°F. Stand the bones cut side up in a roasting pan and roast for 15 to 20 minutes, until the marrow is soft and just beginning to bubble.',
                    'Toss the parsley, shallot and capers with the lemon juice and olive oil.',
                    'Serve the bones hot with the toast and the salad, and a sprinkle of sea salt. Scoop the marrow out and spread it on the toast.',
                ],
            },
            {
                title: 'Crispy Smashed Potatoes', serves: 4, time: 'Prep 10 min · Cook 45 min',
                groups: [['', ['2 pounds baby potatoes', '3 tbsp olive oil', '1 tsp flaky salt', '1/2 tsp black pepper', '2 tbsp chopped chives']]],
                steps: [
                    'Boil the potatoes in salted water for 20 minutes until tender, then drain.',
                    'Heat the oven to 425°F. Smash each potato flat on an oiled baking sheet.',
                    'Drizzle with the oil, season with the salt and pepper and roast for 25 minutes until crisp.',
                    'Scatter with chives and serve as a side.',
                ],
            },
        ]],
        ['Weeknight Mains', [
            {
                title: 'Lemon-Herb Chicken Thighs with Potatoes', serves: 4, time: 'Prep 10 min · Cook 40 min',
                groups: [['', ['2 pounds bone-in, skin-on chicken thighs (about 8)', '1 1/2 pounds baby potatoes, halved', '1 lemon, sliced', '4 garlic cloves, smashed', '2 tbsp olive oil', '1 tbsp fresh thyme leaves', '1 tsp salt', '1/2 tsp black pepper']]],
                steps: [
                    'Heat the oven to 425°F.',
                    'Toss the chicken, potatoes, lemon and garlic with the oil, thyme, salt and pepper in a roasting pan.',
                    'Arrange the chicken skin side up and roast for 40 minutes, until the skin is golden and the chicken reaches 165°F.',
                    'Spoon the pan juices over and serve.',
                ],
            },
            {
                title: 'Brined Pork Chops with Apples', serves: 2, time: 'Prep 10 min, plus 1 hour brining · Cook 20 min',
                groups: [
                    ['For the brine', ['4 cups water', '1/4 cup kosher salt', '2 tbsp brown sugar']],
                    ['For the chops', ['2 bone-in pork chops, about 1 inch thick (1 1/2 pounds total)', '1 tbsp olive oil', '2 apples, cored and sliced', '1 small onion, sliced', '1/2 cup chicken broth', '1 tsp Dijon mustard', '1/2 tsp dried sage', '1/4 tsp black pepper']],
                ],
                steps: [
                    'Stir the salt and sugar into the water until dissolved. Add the chops and refrigerate for 1 hour.',
                    'Remove the chops, discard the brine and pat dry. Season with the pepper and sage.',
                    'Heat the oil in a skillet over medium-high heat and sear the chops for 4 minutes a side. Set aside.',
                    'Cook the apples and onion in the same pan for 5 minutes, then stir in the broth and mustard.',
                    'Return the chops to the pan and simmer for 4 minutes until cooked through. Serve with the apples.',
                ],
            },
            {
                title: 'Weeknight Beef Chili', serves: 6, time: 'Prep 10 min · Cook 35 min',
                groups: [['', ['1 pound lean ground beef', '1 tbsp vegetable oil', '1 onion, chopped', '3 garlic cloves, minced', '1 (15 oz) can kidney beans, drained', '1 (15 oz) can black beans, drained', '1 (28 oz) can crushed tomatoes', '2 tbsp chili powder', '1 tsp ground cumin', '1 tsp salt']]],
                steps: [
                    'Heat the oil in a large pot and brown the beef with the onion for 8 minutes.',
                    'Add the garlic, chili powder and cumin and cook for 1 minute.',
                    'Stir in the beans, tomatoes and salt, bring to a simmer and cook for 25 minutes.',
                    'Taste for salt and serve hot.',
                ],
            },
            {
                title: 'Garlic Butter Shrimp with Rice', serves: 2, time: 'Prep 10 min · Cook 20 min',
                groups: [['', ['1 pound large shell-on shrimp', '1 cup long-grain white rice', '2 cups water', '2 tbsp butter', '4 garlic cloves, minced', '1/4 tsp red pepper flakes', '1 tbsp lemon juice', '2 tbsp chopped parsley', '1/2 tsp salt']]],
                steps: [
                    'Cook the rice in the water with a pinch of the salt, covered, for 18 minutes.',
                    'Peel and devein the shrimp, discarding the shells.',
                    'Melt the butter in a skillet, add the garlic and pepper flakes and cook for 1 minute.',
                    'Add the shrimp and the rest of the salt and cook for 2 minutes a side until pink. Stir in the lemon juice and parsley.',
                    'Serve the shrimp and their sauce over the rice.',
                ],
            },
        ]],
        ['Weekend Projects', [
            {
                title: 'Buttermilk Fried Chicken', serves: 4, time: 'Prep 20 min, plus 4 hours brining · Cook 30 min',
                groups: [
                    ['For the brine', ['2 quarts water', '1/2 cup kosher salt', '1/4 cup sugar']],
                    ['For the chicken', ['3 1/2 pounds bone-in, skin-on chicken pieces (thighs and drumsticks)', '2 cups buttermilk', '2 cups all-purpose flour', '1 tbsp paprika', '2 tsp garlic powder', '1 tsp cayenne pepper', '1 tsp salt', '2 quarts vegetable oil, for deep frying']],
                ],
                steps: [
                    'Stir the salt and sugar into the water until dissolved, add the chicken and refrigerate for 4 hours.',
                    'Drain the chicken, discard the brine and pat dry. Soak the chicken in the buttermilk for 30 minutes.',
                    'Mix the flour, paprika, garlic powder, cayenne and salt in a wide dish.',
                    'Heat the oil in a deep, heavy pot to 350°F.',
                    'Lift the chicken from the buttermilk, dredge it in the flour and deep-fry in batches for 12 to 15 minutes, until golden and 165°F inside.',
                    'Drain on a rack and serve hot.',
                ],
            },
            {
                title: 'Sticky Oven-Baked Pork Ribs', serves: 4, time: 'Prep 15 min · Cook 2 hours 30 min',
                groups: [['', ['2 racks baby back pork ribs (about 4 pounds)', '2 tbsp brown sugar', '1 tbsp smoked paprika', '2 tsp garlic powder', '2 tsp salt', '1 tsp black pepper', '1 cup barbecue sauce', '2 tbsp apple cider vinegar']]],
                steps: [
                    'Heat the oven to 300°F. Mix the sugar, paprika, garlic powder, salt and pepper and rub it all over the ribs.',
                    'Wrap the ribs tightly in foil and bake for 2 hours, until tender.',
                    'Mix the barbecue sauce with the vinegar. Unwrap the ribs, brush with the sauce and bake uncovered at 425°F for 20 minutes, brushing again halfway.',
                    'Rest for 5 minutes, cut between the bones and serve.',
                ],
            },
        ]],
        ['Sauces', [
            {
                title: 'Chimichurri', serves: 8, time: 'Prep 10 min',
                groups: [['', ['1 cup flat-leaf parsley, finely chopped', '1/2 cup olive oil', '3 tbsp red wine vinegar', '4 garlic cloves, minced', '1 tsp dried oregano', '1/2 tsp red pepper flakes', '1/2 tsp salt']]],
                steps: ['Stir everything together in a bowl.', 'Leave for 20 minutes for the flavours to blend, then spoon over grilled meat.'],
            },
        ]],
    ],
};

// Pages of a text PDF. Each page: the running head and page number are added by the generator.
const WEEKNIGHT = {
    title: 'Weeknight Kitchen',
    author: 'Jordan Park',
    runningHead: 'WEEKNIGHT KITCHEN',
    pages: [
        [{
            title: 'Spinach and Feta Omelette', serves: 1, time: 'Ready in 10 minutes',
            groups: [['', ['3 large eggs', '1 cup baby spinach', '1/4 cup crumbled feta', '1 tsp olive oil', '1/8 tsp salt', '1 pinch black pepper']]],
            steps: ['Whisk the eggs with the salt and pepper.', 'Heat the oil in a small nonstick pan and wilt the spinach for 1 minute.', 'Pour in the eggs, cook for 2 minutes, scatter the feta over, fold and serve.'],
        }],
        [{
            title: 'Peanut Butter Overnight Oats', serves: 1, time: 'Prep 5 minutes, plus overnight',
            groups: [['', ['1/2 cup rolled oats', '1/2 cup milk', '1/2 cup Greek yogurt', '1 tbsp peanut butter', '1 tsp maple syrup', '1/2 banana, sliced']]],
            steps: ['The night before, stir the oats, milk, yogurt, peanut butter and syrup together in a jar and refrigerate overnight.', 'In the morning, top with the banana and eat cold.'],
        }],
        [{
            title: 'Chicken and Broccoli Stir-Fry', serves: 4, time: 'Ready in 25 minutes',
            groups: [['', ['1 1/2 pounds boneless, skinless chicken breast, sliced', '4 cups broccoli florets', '1 red bell pepper, sliced', '3 tbsp low-sodium soy sauce', '1 tbsp honey', '1 tbsp grated fresh ginger', '3 garlic cloves, minced', '1 tbsp vegetable oil', '2 cups cooked brown rice']]],
            steps: ['Mix the soy sauce, honey, ginger and garlic.', 'Heat the oil in a wok over high heat and stir-fry the chicken for 5 minutes.', 'Add the broccoli and pepper and stir-fry for 4 minutes.', 'Pour in the sauce, toss for 1 minute and serve over the rice.'],
        }],
        [{
            title: 'Red Lentil and Spinach Soup', serves: 4, time: 'Ready in 30 minutes',
            groups: [['', ['1 cup red lentils, rinsed', '1 tbsp olive oil', '1 onion, chopped', '2 carrots, diced', '2 garlic cloves, minced', '1 tsp ground cumin', '4 cups vegetable broth', '1 (15 oz) can diced tomatoes', '3 cups baby spinach', '1 tbsp lemon juice', '3/4 tsp salt']]],
            steps: ['Heat the oil in a pot and cook the onion and carrots for 5 minutes.', 'Add the garlic and cumin for 1 minute.', 'Add the lentils, broth and tomatoes and simmer for 20 minutes until the lentils are soft.', 'Stir in the spinach, lemon juice and salt and serve.'],
        }],
        [{
            title: 'Turkey Taco Lettuce Wraps', serves: 4, time: 'Ready in 20 minutes',
            groups: [['', ['1 pound lean ground turkey', '1 tbsp olive oil', '1 small onion, diced', '1 tbsp chili powder', '1 tsp ground cumin', '1/2 tsp salt', '1/2 cup salsa', '1 head butter lettuce, leaves separated', '1/2 cup shredded cheddar', '1 avocado, diced']]],
            steps: ['Heat the oil in a skillet and cook the onion for 3 minutes.', 'Add the turkey, chili powder, cumin and salt and cook for 8 minutes, breaking it up.', 'Stir in the salsa and warm through.', 'Spoon into the lettuce leaves and top with the cheese and avocado.'],
        }],
        [{
            title: 'Baked Salmon with Dill Yogurt Sauce', serves: 2, time: 'Ready in 25 minutes',
            groups: [['', ['2 salmon fillets (6 oz each)', '1 tbsp olive oil', '1/2 tsp salt', '1/4 tsp black pepper', '1/2 cup Greek yogurt', '1 tbsp chopped fresh dill', '1 tsp lemon juice', '1 cup quinoa', '2 cups water', '2 cups green beans']]],
            steps: ['Heat the oven to 400°F. Cook the quinoa in the water for 15 minutes.', 'Rub the salmon with the oil, salt and pepper and bake for 12 minutes with the green beans alongside.', 'Stir the yogurt, dill and lemon juice together.', 'Serve the salmon on the quinoa with the beans and the sauce.'],
        }],
        [{
            title: 'Sheet-Pan Sausage and Peppers with Crispy Potatoes', wrapTitle: true, serves: 4, time: 'Ready in 40 minutes',
            groups: [['', ['1 pound chicken sausages, sliced', '2 bell peppers, sliced', '1 red onion, cut into wedges', '1 1/2 pounds Yukon Gold potatoes, cubed', '2 tbsp olive oil', '1 tsp dried oregano', '1 tsp smoked paprika', '3/4 tsp salt']]],
            steps: ['Heat the oven to 425°F.', 'Toss the potatoes with half the oil and roast for 15 minutes.', 'Add the sausages, peppers and onion, the rest of the oil, the oregano, paprika and salt, and roast for 20 minutes more.', 'Serve straight from the pan.'],
        }],
        [{
            title: 'Garlic Roasted Green Beans', chapterNote: 'SIDES', serves: 4, time: 'Ready in 20 minutes',
            groups: [['', ['1 pound green beans, trimmed', '1 tbsp olive oil', '3 garlic cloves, sliced', '1/2 tsp salt', '1 tbsp lemon zest']]],
            steps: ['Heat the oven to 425°F.', 'Toss the beans with the oil, garlic and salt and roast for 15 minutes.', 'Sprinkle with the lemon zest and serve as a side dish.'],
        }],
        [{
            title: 'Beer-Battered Fish', serves: 4, time: 'Ready in 30 minutes',
            groups: [['', ['1 1/2 pounds cod fillets, cut into pieces', '1 cup all-purpose flour', '1 cup cold beer', '1 tsp baking powder', '1 tsp salt', '1/2 tsp paprika', 'Vegetable oil for deep frying (about 2 quarts)', '1 lemon, cut into wedges', '2 cups coleslaw mix', '2 tbsp mayonnaise', '1 tsp cider vinegar']]],
            steps: ['Heat the oil in a deep pot to 375°F.', 'Whisk the flour, baking powder, salt, paprika and beer into a smooth batter.', 'Toss the coleslaw mix with the mayonnaise and vinegar.', 'Dip the fish in the batter and deep-fry for 4 to 5 minutes until golden. Drain on paper towels.', 'Serve with the lemon wedges and the slaw.'],
        }],
        [{
            title: 'Greek Chicken Pita', serves: 2, time: 'Ready in 15 minutes',
            groups: [['', ['8 oz cooked chicken breast, sliced', '2 whole wheat pitas', '1/2 cup tzatziki', '1 tomato, sliced', '1/4 red onion, sliced', '1 cup romaine lettuce', '1/4 cup crumbled feta', '1/2 tsp dried oregano', '1/4 tsp salt']]],
            steps: ['Warm the pitas in a dry pan for 1 minute a side.', 'Spread with the tzatziki and fill with the chicken, tomato, onion, lettuce and feta.', 'Sprinkle with the oregano and salt, fold and serve.'],
        }, {
            title: 'Lemon Vinaigrette', serves: 6, time: 'Ready in 5 minutes',
            groups: [['', ['1/3 cup olive oil', '3 tbsp lemon juice', '1 tsp Dijon mustard', '1 tsp honey', '1/4 tsp salt']]],
            steps: ['Shake everything together in a jar until creamy.', 'Keep in the fridge for up to a week.'],
        }],
        [{
            title: 'Watermelon Mint Cooler', serves: 4, time: 'Ready in 10 minutes',
            groups: [['', ['6 cups watermelon chunks', '1/4 cup fresh mint leaves', '2 tbsp lime juice', '2 cups sparkling water', 'Ice']]],
            steps: ['Blend the watermelon, mint and lime juice until smooth.', 'Strain into a pitcher, top with the sparkling water and pour over ice.'],
        }],
        [{
            title: 'Chocolate Lava Cakes', serves: 4, time: 'Ready in 25 minutes',
            groups: [['', ['4 oz bittersweet chocolate', '1/2 cup butter', '2 large eggs', '2 egg yolks', '1/4 cup sugar', '2 tbsp all-purpose flour', '1 pinch salt']]],
            steps: ['Heat the oven to 425°F and butter four ramekins.', 'Melt the chocolate and butter together.', 'Whisk the eggs, yolks and sugar until thick, then fold in the chocolate, flour and salt.', 'Divide between the ramekins and bake for 12 minutes. Turn out and serve warm.'],
        }],
        [{
            title: 'Lobster Mac and Cheese', serves: 4, time: 'Ready in 45 minutes',
            groups: [['', ['2 cooked lobster tails (about 12 oz meat), chopped', '12 oz elbow macaroni', '3 tbsp butter', '3 tbsp all-purpose flour', '3 cups whole milk', '2 cups shredded Gruyere', '1 cup shredded sharp cheddar', '1/2 tsp salt', '1/4 tsp cayenne pepper', '1/2 cup panko']]],
            steps: ['Cook the macaroni for 6 minutes and drain.', 'Melt the butter, whisk in the flour and cook for 1 minute, then whisk in the milk and simmer for 5 minutes until thick.', 'Stir in the cheeses, salt and cayenne, then the macaroni and lobster.', 'Spoon into a baking dish, top with the panko and bake at 375°F for 20 minutes.'],
        }],
        [{
            title: 'Herb-Crusted Rack of Lamb', serves: 4, time: 'Ready in 40 minutes',
            groups: [['', ['2 racks of lamb (about 1 1/2 pounds each), frenched', '2 tbsp Dijon mustard', '1/2 cup panko', '2 tbsp chopped fresh rosemary', '2 garlic cloves, minced', '2 tbsp olive oil', '1 tsp salt', '1/2 tsp black pepper', '1 pound baby carrots']]],
            steps: ['Heat the oven to 425°F. Season the lamb with the salt and pepper and sear it fat side down for 4 minutes.', 'Brush with the mustard and press on the panko mixed with the rosemary, garlic and oil.', 'Roast with the carrots for 20 minutes for medium-rare, rest for 10 minutes and slice between the bones.'],
        }],
    ],
};

// The scanned book: pages are pictures (no text inside the PDF). On a PC there's no text
// recognition, so none of its recipes can be read there; the audit can simulate the iPhone's
// reading with this text (as if recognised perfectly).
const SUNDAY = {
    title: 'Sunday Suppers',
    author: 'Ada Brennan',
    pages: [
        [{
            title: 'Braised Beef Short Ribs', serves: 4, time: 'Prep 20 min · Cook 3 hours',
            groups: [['', ['4 pounds bone-in beef short ribs', '1 tsp salt', '1/2 tsp black pepper', '2 tbsp olive oil', '1 onion, chopped', '2 carrots, chopped', '2 celery stalks, chopped', '3 garlic cloves', '2 tbsp tomato paste', '2 cups red wine', '2 cups beef broth', '2 sprigs fresh thyme', '1 bay leaf']]],
            steps: ['Season the ribs with the salt and pepper and brown them in the oil in a heavy pot, 8 minutes. Set aside.', 'Cook the onion, carrots and celery for 6 minutes, then the garlic and tomato paste for 1 minute.', 'Add the wine and simmer for 5 minutes, then the broth, thyme and bay leaf.', 'Return the ribs, cover and braise in a 325°F oven for 2 1/2 hours until tender.', 'Skim off the fat and serve the ribs with the sauce.'],
        }],
        [{
            title: 'Classic Pot Roast with Vegetables', serves: 6, time: 'Prep 20 min · Cook 3 hours',
            groups: [['', ['3 pounds boneless beef chuck roast', '1 1/2 tsp salt', '1/2 tsp black pepper', '2 tbsp vegetable oil', '1 onion, quartered', '4 carrots, cut into chunks', '1 1/2 pounds Yukon Gold potatoes, quartered', '3 garlic cloves', '2 cups beef broth', '1 tbsp Worcestershire sauce', '2 sprigs fresh rosemary']]],
            steps: ['Season the beef with the salt and pepper and brown it on all sides in the oil, 10 minutes.', 'Add the onion, garlic, broth, Worcestershire sauce and rosemary.', 'Cover and cook in a 300°F oven for 2 hours.', 'Add the carrots and potatoes and cook for 1 hour more until everything is tender.', 'Slice the beef and serve with the vegetables and juices.'],
        }],
        [{
            title: 'Buttermilk Pancakes', serves: 4, time: 'Ready in 20 minutes',
            groups: [['', ['2 cups all-purpose flour', '2 tbsp sugar', '2 tsp baking powder', '1/2 tsp baking soda', '1/2 tsp salt', '2 cups buttermilk', '2 large eggs', '3 tbsp melted butter']]],
            steps: ['Whisk the flour, sugar, baking powder, baking soda and salt.', 'Whisk the buttermilk, eggs and butter, then stir into the flour until just combined.', 'Cook 1/4 cup at a time on a hot greased griddle for 2 minutes a side.'],
        }, {
            title: 'Classic Hummus', serves: 8, time: 'Ready in 10 minutes',
            groups: [['', ['1 (15 oz) can chickpeas, drained', '1/4 cup tahini', '3 tbsp lemon juice', '1 garlic clove', '2 tbsp olive oil', '1/2 tsp salt', '3 tbsp cold water']]],
            steps: ['Blend everything until very smooth, about 3 minutes.', 'Spread in a bowl, drizzle with oil and serve as a dip.'],
        }],
        [{
            title: 'Southern Sweet Tea', serves: 8, time: 'Ready in 15 minutes, plus chilling',
            groups: [['', ['8 cups water', '6 black tea bags', '3/4 cup sugar', '1 lemon, sliced']]],
            steps: ['Bring 4 cups of the water to a boil, add the tea bags and steep for 5 minutes.', 'Remove the bags, stir in the sugar, then the rest of the water.', 'Chill and serve over ice with the lemon.'],
        }],
        [{
            title: 'Chicken and Dumplings', serves: 6, time: 'Prep 20 min · Cook 50 min',
            groups: [['', ['2 pounds boneless, skinless chicken thighs', '2 tbsp butter', '1 onion, diced', '2 carrots, diced', '2 celery stalks, diced', '6 cups chicken broth', '1 tsp dried thyme', '1 tsp salt', '1 1/2 cups all-purpose flour', '2 tsp baking powder', '3/4 cup milk', '1 cup frozen peas']]],
            steps: ['Melt the butter in a pot and cook the onion, carrots and celery for 5 minutes.', 'Add the chicken, broth, thyme and salt and simmer for 25 minutes. Shred the chicken.', 'Mix the flour, baking powder and milk into a soft dough.', 'Drop spoonfuls into the simmering soup with the peas, cover and cook for 15 minutes.', 'Serve hot in bowls.'],
        }],
    ],
};

module.exports = { BUTCHER, WEEKNIGHT, SUNDAY };
