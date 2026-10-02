"""Builds nutrition-data.js: a compact offline nutrition table from USDA FoodData Central (SR Legacy,
public domain). For each common ingredient: kcal, protein, carbs, fat per 100 g, and the gram weight
of a cup, tablespoon, teaspoon and a typical piece, from USDA's own portion data.

Run (needs internet): python3 tools/usda-table.py > nutrition-data.js
"""
import csv, difflib, io, json, re, sys, urllib.request, zipfile

URL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"

# key: (USDA description to match, extra names people write in recipes)
FOODS = {
    # poultry, meat, fish
    "chicken breast": ("Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw", ["chicken breasts", "boneless skinless chicken breast", "chicken breast fillet"]),
    "chicken thigh": ("Chicken, broilers or fryers, dark meat, thigh, meat only, raw", ["chicken thighs", "boneless chicken thigh"]),
    "chicken": ("Chicken, broilers or fryers, meat and skin, raw", ["whole chicken", "chicken pieces", "chicken drumsticks", "chicken wings"]),
    "ground chicken": ("Chicken, ground, raw", ["minced chicken"]),
    "turkey breast": ("Turkey, whole, breast, meat only, raw", ["turkey"]),
    "ground turkey": ("Turkey, ground, raw", ["minced turkey", "lean ground turkey"]),
    "ground beef": ("Beef, ground, 85% lean meat / 15% fat, raw", ["minced beef", "beef mince", "hamburger"]),
    "lean ground beef": ("Beef, ground, 93% lean meat / 7% fat, raw", ["extra lean ground beef"]),
    "beef steak": ("Beef, top sirloin, steak, separable lean and fat, trimmed to 1/8\" fat, choice, raw", ["sirloin", "steak", "sirloin steak", "flank steak", "skirt steak", "ribeye", "beef"]),
    "beef stew meat": ("Beef, chuck, arm pot roast, separable lean and fat, trimmed to 1/8\" fat, all grades, raw", ["chuck", "stewing beef", "beef chuck", "brisket"]),
    "pork tenderloin": ("Pork, fresh, loin, tenderloin, separable lean and fat, raw", ["pork loin"]),
    "pork chop": ("Pork, fresh, loin, center loin (chops), bone-in, separable lean and fat, raw", ["pork chops"]),
    "ground pork": ("Pork, fresh, ground, raw", ["minced pork", "pork mince"]),
    "pork shoulder": ("Pork, fresh, shoulder, whole, separable lean and fat, raw", ["pork butt"]),
    "bacon": ("Pork, cured, bacon, unprepared", ["streaky bacon", "rashers"]),
    "ham": ("Ham, sliced, regular (approximately 11% fat)", ["deli ham"]),
    "sausage": ("Sausage, Italian, pork, raw", ["sausages", "italian sausage"]),
    "chorizo": ("Sausage, pork, chorizo, link or ground, raw", []),
    "lamb": ("Lamb, domestic, leg, whole (shank and sirloin), separable lean and fat, trimmed to 1/4\" fat, choice, raw", ["leg of lamb", "lamb leg"]),
    "lamb chop": ("Lamb, domestic, loin, separable lean and fat, trimmed to 1/4\" fat, choice, raw", ["lamb chops", "lamb loin"]),
    "ground lamb": ("Lamb, ground, raw", ["minced lamb", "lamb mince"]),
    "salmon": ("Fish, salmon, Atlantic, farmed, raw", ["salmon fillet", "salmon fillets"]),
    "smoked salmon": ("Fish, salmon, chinook, smoked", ["lox"]),
    "tuna": ("Fish, tuna, light, canned in water, drained solids", ["canned tuna", "tuna in water"]),
    "tuna steak": ("Fish, tuna, fresh, yellowfin, raw", ["ahi tuna"]),
    "cod": ("Fish, cod, Atlantic, raw", ["cod fillet", "white fish", "haddock", "pollock"]),
    "tilapia": ("Fish, tilapia, raw", []),
    "shrimp": ("Crustaceans, shrimp, raw (not previously frozen)", ["prawns", "prawn", "shrimps"]),
    "scallops": ("Mollusks, scallop, mixed species, raw", ["scallop"]),
    "mussels": ("Mollusks, mussel, blue, raw", []),
    "crab": ("Crustaceans, crab, blue, raw", ["crab meat"]),
    "sardines": ("Fish, sardine, Atlantic, canned in oil, drained solids with bone", []),
    "anchovies": ("Fish, anchovy, european, canned in oil, drained solids", ["anchovy"]),
    "egg": ("Egg, whole, raw, fresh", ["eggs", "large egg", "large eggs"]),
    "egg white": ("Egg, white, raw, fresh", ["egg whites"]),
    "egg yolk": ("Egg, yolk, raw, fresh", ["egg yolks"]),
    "tofu": ("Tofu, raw, firm, prepared with calcium sulfate", ["firm tofu", "extra firm tofu"]),
    "tempeh": ("Tempeh", []),
    # dairy
    "milk": ("Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", ["2% milk"]),
    "whole milk": ("Milk, whole, 3.25% milkfat, with added vitamin D", []),
    "skim milk": ("Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)", ["nonfat milk", "fat free milk"]),
    "almond milk": ("Beverages, almond milk, unsweetened, shelf stable", ["unsweetened almond milk"]),
    "oat milk": ("(manual)", []),
    "soy milk": ("Soymilk, original and vanilla, unfortified", []),
    "coconut milk": ("Nuts, coconut milk, canned (liquid expressed from grated meat and water)", ["canned coconut milk"]),
    "light coconut milk": ("Beverages, coconut milk, sweetened, fortified with calcium, vitamins A, B12, D2", []),
    "heavy cream": ("Cream, fluid, heavy whipping", ["double cream", "whipping cream", "cream"]),
    "half and half": ("Cream, fluid, half and half", []),
    "sour cream": ("Cream, sour, cultured", []),
    "greek yogurt": ("Yogurt, Greek, plain, nonfat", ["nonfat greek yogurt", "plain greek yogurt", "0% greek yogurt"]),
    "yogurt": ("Yogurt, plain, low fat", ["plain yogurt", "natural yogurt"]),
    "butter": ("Butter, salted", ["unsalted butter"]),
    "ghee": ("Butter oil, anhydrous", ["clarified butter"]),
    "cheddar": ("Cheese, cheddar", ["cheddar cheese", "shredded cheddar", "cheese"]),
    "mozzarella": ("Cheese, mozzarella, part skim milk", ["mozzarella cheese", "part-skim mozzarella"]),
    "parmesan": ("Cheese, parmesan, grated", ["parmesan cheese", "parmigiano reggiano", "grated parmesan"]),
    "feta": ("Cheese, feta", ["feta cheese"]),
    "goat cheese": ("Cheese, goat, soft type", ["chevre"]),
    "cottage cheese": ("Cheese, cottage, lowfat, 2% milkfat", []),
    "ricotta": ("Cheese, ricotta, part skim milk", ["ricotta cheese"]),
    "cream cheese": ("Cheese, cream", []),
    "swiss cheese": ("Cheese, swiss", ["gruyere"]),
    "monterey jack": ("Cheese, monterey", ["pepper jack", "mexican cheese blend"]),
    "halloumi": ("Cheese, mozzarella, whole milk", []),
    # grains, bread, pasta
    "rice": ("Rice, white, long-grain, regular, raw, enriched", ["white rice", "long grain rice", "jasmine rice", "basmati rice", "uncooked rice"]),
    "cooked rice": ("Rice, white, long-grain, regular, enriched, cooked", ["cooked white rice", "steamed rice"]),
    "brown rice": ("Rice, brown, long-grain, raw", ["uncooked brown rice"]),
    "cooked brown rice": ("Rice, brown, long-grain, cooked", []),
    "quinoa": ("Quinoa, uncooked", ["uncooked quinoa"]),
    "cooked quinoa": ("Quinoa, cooked", []),
    "oats": ("Cereals, oats, regular and quick, not fortified, dry", ["rolled oats", "old fashioned oats", "oatmeal", "quick oats", "steel cut oats"]),
    "pasta": ("Pasta, dry, enriched", ["spaghetti", "penne", "linguine", "fettuccine", "macaroni", "fusilli", "rigatoni", "orzo", "noodles"]),
    "whole wheat pasta": ("Pasta, whole-wheat, dry", ["whole grain pasta", "whole wheat spaghetti"]),
    "cooked pasta": ("Pasta, cooked, enriched, without added salt", []),
    "egg noodles": ("Noodles, egg, dry, enriched", []),
    "rice noodles": ("Noodles, chinese, cellophane or long rice (mung beans), dehydrated", ["vermicelli", "glass noodles", "rice vermicelli"]),
    "soba": ("Noodles, japanese, soba, dry", ["soba noodles"]),
    "udon": ("Noodles, japanese, somen, dry", ["ramen noodles", "udon noodles"]),
    "couscous": ("Couscous, dry", []),
    "bulgur": ("Bulgur, dry", []),
    "farro": ("Wheat, durum", ["barley", "pearl barley"]),
    "flour": ("Wheat flour, white, all-purpose, enriched, bleached", ["all-purpose flour", "plain flour", "all purpose flour"]),
    "whole wheat flour": ("Wheat flour, whole-grain", []),
    "almond flour": ("Nuts, almonds, blanched", ["almond meal"]),
    "cornstarch": ("Cornstarch", ["corn starch", "cornflour"]),
    "cornmeal": ("Cornmeal, whole-grain, yellow", ["polenta"]),
    "breadcrumbs": ("Bread, crumbs, dry, grated, plain", ["panko", "bread crumbs", "panko breadcrumbs"]),
    "bread": ("Bread, whole-wheat, commercially prepared", ["whole wheat bread", "whole grain bread", "toast", "slice of bread", "sourdough"]),
    "white bread": ("Bread, white, commercially prepared (includes soft bread crumbs)", []),
    "tortilla": ("Tortillas, ready-to-bake or -fry, flour, refrigerated", ["flour tortilla", "flour tortillas", "tortillas", "wrap", "wraps"]),
    "corn tortilla": ("Tortillas, ready-to-bake or -fry, corn", ["corn tortillas"]),
    "pita": ("Bread, pita, whole-wheat", ["pita bread", "flatbread", "naan"]),
    "english muffin": ("Muffins, English, whole-wheat", []),
    "bagel": ("Bagels, plain, enriched, with calcium propionate (includes onion, poppy, sesame)", []),
    "granola": ("Cereals ready-to-eat, granola, homemade", []),
    # legumes
    "chickpeas": ("Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water", ["garbanzo beans", "canned chickpeas", "chickpea"]),
    "black beans": ("Beans, black turtle, mature seeds, canned", ["canned black beans"]),
    "kidney beans": ("Beans, kidney, red, mature seeds, canned, drained solids", ["red kidney beans"]),
    "white beans": ("Beans, white, mature seeds, canned", ["cannellini beans", "navy beans", "great northern beans", "butter beans"]),
    "pinto beans": ("Beans, pinto, mature seeds, canned, solids and liquids", ["refried beans"]),
    "lentils": ("Lentils, raw", ["red lentils", "green lentils", "brown lentils", "dried lentils"]),
    "cooked lentils": ("Lentils, mature seeds, cooked, boiled, without salt", []),
    "edamame": ("Edamame, frozen, prepared", []),
    "peas": ("Peas, green, frozen, unprepared", ["green peas", "frozen peas"]),
    "hummus": ("Hummus, commercial", []),
    # vegetables
    "onion": ("Onions, raw", ["onions", "yellow onion", "white onion", "red onion", "brown onion"]),
    "shallot": ("Shallots, raw", ["shallots"]),
    "green onion": ("Onions, spring or scallions (includes tops and bulb), raw", ["scallions", "scallion", "spring onions", "green onions", "spring onion"]),
    "garlic": ("Garlic, raw", ["garlic cloves", "clove garlic", "cloves garlic", "minced garlic"]),
    "ginger": ("Ginger root, raw", ["fresh ginger", "ginger root"]),
    "tomato": ("Tomatoes, red, ripe, raw, year round average", ["tomatoes", "roma tomatoes", "plum tomatoes"]),
    "cherry tomatoes": ("Tomatoes, red, ripe, raw, year round average", ["grape tomatoes"]),
    "canned tomatoes": ("Tomatoes, red, ripe, canned, packed in tomato juice", ["diced tomatoes", "crushed tomatoes", "chopped tomatoes", "tinned tomatoes", "whole peeled tomatoes"]),
    "tomato paste": ("Tomato products, canned, paste, without salt added", ["tomato puree"]),
    "tomato sauce": ("Tomato products, canned, sauce", ["passata", "marinara", "marinara sauce", "pasta sauce"]),
    "bell pepper": ("Peppers, sweet, red, raw", ["red bell pepper", "green bell pepper", "yellow bell pepper", "bell peppers", "capsicum", "red pepper", "peppers"]),
    "jalapeno": ("Peppers, jalapeno, raw", ["jalapenos", "chili pepper", "chilli", "green chili", "serrano", "fresh chili", "red chili", "thai chili"]),
    "carrot": ("Carrots, raw", ["carrots"]),
    "celery": ("Celery, raw", ["celery stalks", "celery stalk"]),
    "cucumber": ("Cucumber, with peel, raw", ["cucumbers", "english cucumber"]),
    "zucchini": ("Squash, summer, zucchini, includes skin, raw", ["courgette", "courgettes", "summer squash"]),
    "eggplant": ("Eggplant, raw", ["aubergine"]),
    "broccoli": ("Broccoli, raw", ["broccoli florets"]),
    "cauliflower": ("Cauliflower, raw", ["cauliflower florets", "riced cauliflower", "cauliflower rice"]),
    "spinach": ("Spinach, raw", ["baby spinach", "fresh spinach"]),
    "kale": ("Kale, raw", ["lacinato kale", "tuscan kale"]),
    "lettuce": ("Lettuce, cos or romaine, raw", ["romaine", "romaine lettuce", "mixed greens", "salad greens", "iceberg lettuce", "arugula", "rocket", "spring mix"]),
    "cabbage": ("Cabbage, raw", ["red cabbage", "napa cabbage", "coleslaw mix"]),
    "brussels sprouts": ("Brussels sprouts, raw", []),
    "bok choy": ("Cabbage, chinese (pak-choi), raw", ["pak choi", "baby bok choy"]),
    "asparagus": ("Asparagus, raw", []),
    "green beans": ("Beans, snap, green, raw", ["string beans", "haricots verts"]),
    "mushrooms": ("Mushrooms, white, raw", ["mushroom", "cremini mushrooms", "button mushrooms", "shiitake", "portobello"]),
    "corn": ("Corn, sweet, yellow, raw", ["sweetcorn", "corn kernels", "frozen corn"]),
    "potato": ("Potatoes, flesh and skin, raw", ["potatoes", "russet potatoes", "yukon gold potatoes", "baby potatoes", "red potatoes"]),
    "sweet potato": ("Sweet potato, raw, unprepared", ["sweet potatoes", "yam"]),
    "butternut squash": ("Squash, winter, butternut, raw", ["pumpkin", "winter squash"]),
    "beet": ("Beets, raw", ["beets", "beetroot"]),
    "radish": ("Radishes, raw", ["radishes"]),
    "avocado": ("Avocados, raw, all commercial varieties", ["avocados"]),
    "olives": ("Olives, ripe, canned (small-extra large)", ["kalamata olives", "black olives", "green olives"]),
    "artichoke": ("Artichokes, (globe or french), raw", ["artichoke hearts"]),
    "leek": ("Leeks, (bulb and lower leaf-portion), raw", ["leeks"]),
    "fennel": ("Fennel, bulb, raw", []),
    "snow peas": ("Peas, edible-podded, raw", ["snap peas", "sugar snap peas", "mangetout"]),
    "pickles": ("Pickles, cucumber, dill or kosher dill", ["pickle", "gherkins", "dill pickles"]),
    "sauerkraut": ("Sauerkraut, canned, solids and liquids", ["kimchi"]),
    # fruit
    "banana": ("Bananas, raw", ["bananas"]),
    "apple": ("Apples, raw, with skin", ["apples"]),
    "pear": ("Pears, raw", []),
    "orange": ("Oranges, raw, all commercial varieties", ["oranges"]),
    "lemon": ("Lemons, raw, without peel", ["lemons"]),
    "lime": ("Limes, raw", ["limes"]),
    "lemon juice": ("Lemon juice, raw", ["juice of 1 lemon", "fresh lemon juice"]),
    "lime juice": ("Lime juice, raw", ["fresh lime juice"]),
    "berries": ("Blueberries, raw", ["blueberries", "mixed berries", "frozen berries"]),
    "strawberries": ("Strawberries, raw", ["strawberry"]),
    "raspberries": ("Raspberries, raw", []),
    "mango": ("Mangos, raw", ["mangoes"]),
    "pineapple": ("Pineapple, raw, all varieties", []),
    "grapes": ("Grapes, red or green (European type, such as Thompson seedless), raw", []),
    "peach": ("Peaches, yellow, raw", ["peaches", "nectarine"]),
    "raisins": ("Raisins, seedless", ["dried cranberries", "currants"]),
    "dates": ("Dates, medjool", ["medjool dates"]),
    "dried apricots": ("Apricots, dried, sulfured, uncooked", []),
    "pomegranate": ("Pomegranates, raw", ["pomegranate seeds"]),
    # nuts, seeds
    "almonds": ("Nuts, almonds", ["sliced almonds", "slivered almonds"]),
    "walnuts": ("Nuts, walnuts, english", []),
    "pecans": ("Nuts, pecans", []),
    "cashews": ("Nuts, cashew nuts, raw", []),
    "peanuts": ("Peanuts, all types, raw", []),
    "pistachios": ("Nuts, pistachio nuts, raw", []),
    "peanut butter": ("Peanut butter, smooth style, without salt", ["natural peanut butter"]),
    "almond butter": ("Nuts, almond butter, plain, without salt added", []),
    "tahini": ("Seeds, sesame butter, tahini, from roasted and toasted kernels (most common type)", []),
    "chia seeds": ("Seeds, chia seeds, dried", ["chia"]),
    "flax seeds": ("Seeds, flaxseed", ["ground flaxseed", "flaxseed", "linseed"]),
    "sesame seeds": ("Seeds, sesame seeds, whole, dried", []),
    "pumpkin seeds": ("Seeds, pumpkin and squash seed kernels, dried", ["pepitas"]),
    "sunflower seeds": ("Seeds, sunflower seed kernels, dried", []),
    "coconut": ("Nuts, coconut meat, dried (desiccated), not sweetened", ["shredded coconut", "desiccated coconut"]),
    # fats, oils
    "olive oil": ("Oil, olive, salad or cooking", ["extra virgin olive oil", "extra-virgin olive oil", "evoo"]),
    "vegetable oil": ("Oil, canola", ["canola oil", "oil", "cooking oil", "sunflower oil", "neutral oil", "avocado oil", "rapeseed oil"]),
    "sesame oil": ("Oil, sesame, salad or cooking", ["toasted sesame oil"]),
    "coconut oil": ("Oil, coconut", []),
    "cooking spray": ("Oil, olive, salad or cooking", ["nonstick spray", "oil spray"]),
    "mayonnaise": ("Salad dressing, mayonnaise, regular", ["mayo"]),
    "light mayonnaise": ("Salad dressing, mayonnaise, light", []),
    # sweeteners
    "sugar": ("Sugars, granulated", ["granulated sugar", "white sugar", "caster sugar"]),
    "brown sugar": ("Sugars, brown", ["light brown sugar", "dark brown sugar"]),
    "honey": ("Honey", []),
    "maple syrup": ("Syrups, maple", ["pure maple syrup"]),
    "powdered sugar": ("Sugars, powdered", ["icing sugar", "confectioners sugar"]),
    "dark chocolate": ("Chocolate, dark, 70-85% cacao solids", ["chocolate chips", "chocolate", "semisweet chocolate"]),
    "cocoa powder": ("Cocoa, dry powder, unsweetened", ["cocoa", "unsweetened cocoa powder"]),
    "jam": ("Jams and preserves", ["jelly", "preserves"]),
    # sauces, condiments, liquids
    "soy sauce": ("Soy sauce made from soy and wheat (shoyu)", ["low-sodium soy sauce", "tamari", "light soy sauce", "dark soy sauce"]),
    "fish sauce": ("Sauce, fish, ready-to-serve", []),
    "oyster sauce": ("Sauce, oyster, ready-to-serve", ["hoisin sauce", "hoisin"]),
    "sriracha": ("Sauce, hot chile, sriracha", ["hot sauce", "chili sauce", "chili garlic sauce", "sambal"]),
    "gochujang": ("Sauce, hot chile, sriracha", ["chili paste"]),
    "curry paste": ("Sauce, hot chile, sriracha", ["red curry paste", "green curry paste", "thai curry paste"]),
    "salsa": ("Sauce, salsa, ready-to-serve", ["pico de gallo"]),
    "ketchup": ("Catsup", ["tomato ketchup"]),
    "mustard": ("Mustard, prepared, yellow", ["dijon mustard", "dijon", "whole grain mustard"]),
    "vinegar": ("Vinegar, distilled", ["white vinegar", "rice vinegar", "apple cider vinegar", "red wine vinegar", "white wine vinegar", "sherry vinegar"]),
    "balsamic vinegar": ("Vinegar, balsamic", ["balsamic"]),
    "worcestershire sauce": ("Sauce, worcestershire", ["worcestershire"]),
    "pesto": ("Sauce, pesto, ready-to-serve, refrigerated", []),
    "barbecue sauce": ("Sauce, barbecue", ["bbq sauce"]),
    "miso": ("Miso", ["white miso", "miso paste"]),
    "chicken broth": ("Soup, chicken broth, ready-to-serve", ["chicken stock", "low-sodium chicken broth", "broth", "stock"]),
    "vegetable broth": ("Soup, vegetable broth, ready to serve", ["vegetable stock", "veggie broth"]),
    "beef broth": ("Soup, beef broth or bouillon canned, ready-to-serve", ["beef stock"]),
    "water": ("Beverages, water, tap, drinking", ["cold water", "hot water", "warm water", "ice", "boiling water"]),
    "white wine": ("Alcoholic beverage, wine, table, white", ["dry white wine"]),
    "red wine": ("Alcoholic beverage, wine, table, red", []),
    "orange juice": ("Orange juice, raw", []),
    "coffee": ("Beverages, coffee, brewed, prepared with tap water", ["espresso", "brewed coffee"]),
    "protein powder": ("Beverages, Protein powder whey based", ["whey protein", "vanilla protein powder"]),
    # herbs and spices (close to zero calories; listed so they count as matched)
    "salt": ("Salt, table", ["kosher salt", "sea salt", "flaky salt", "salt and pepper"]),
    "black pepper": ("Spices, pepper, black", ["pepper", "ground black pepper", "freshly ground black pepper", "cracked pepper", "white pepper"]),
    "cumin": ("Spices, cumin seed", ["ground cumin", "cumin seeds"]),
    "paprika": ("Spices, paprika", ["smoked paprika", "sweet paprika"]),
    "chili powder": ("Spices, chili powder", ["chilli powder", "cayenne", "cayenne pepper", "red pepper flakes", "chili flakes", "crushed red pepper", "chipotle powder", "aleppo pepper", "kashmiri chili powder"]),
    "turmeric": ("Spices, turmeric, ground", ["ground turmeric"]),
    "coriander": ("Spices, coriander seed", ["ground coriander", "coriander seeds"]),
    "cinnamon": ("Spices, cinnamon, ground", ["ground cinnamon", "cinnamon stick"]),
    "garam masala": ("Spices, curry powder", ["curry powder", "curry", "chinese five spice", "five spice", "ras el hanout", "za'atar", "zaatar", "berbere", "cajun seasoning", "taco seasoning", "italian seasoning", "herbes de provence", "everything bagel seasoning", "seasoning"]),
    "oregano": ("Spices, oregano, dried", ["dried oregano"]),
    "basil": ("Basil, fresh", ["fresh basil", "basil leaves", "thai basil"]),
    "dried basil": ("Spices, basil, dried", []),
    "thyme": ("Spices, thyme, dried", ["dried thyme", "fresh thyme", "thyme sprigs"]),
    "rosemary": ("Spices, rosemary, dried", ["fresh rosemary"]),
    "parsley": ("Parsley, fresh", ["fresh parsley", "flat-leaf parsley", "italian parsley"]),
    "cilantro": ("Coriander (cilantro) leaves, raw", ["fresh cilantro", "coriander leaves", "fresh coriander"]),
    "dill": ("Dill weed, fresh", ["fresh dill"]),
    "mint": ("Spearmint, fresh", ["fresh mint", "mint leaves"]),
    "chives": ("Chives, raw", []),
    "bay leaf": ("Spices, bay leaf", ["bay leaves"]),
    "garlic powder": ("Spices, garlic powder", ["granulated garlic"]),
    "onion powder": ("Spices, onion powder", []),
    "ginger powder": ("Spices, ginger, ground", ["ground ginger"]),
    "nutmeg": ("Spices, nutmeg, ground", ["ground nutmeg", "allspice", "cloves", "cardamom", "ground cloves", "star anise"]),
    "vanilla": ("Vanilla extract", ["vanilla extract", "pure vanilla extract"]),
    "baking powder": ("Leavening agents, baking powder, double-acting, sodium aluminum sulfate", ["baking soda"]),
    "yeast": ("Leavening agents, yeast, baker's, active dry", ["instant yeast", "active dry yeast"]),
    "nutritional yeast": ("Leavening agents, yeast, baker's, active dry", []),
    "lemon zest": ("Lemon peel, raw", ["zest", "lime zest", "orange zest"]),
}

PORTION_WORDS = ("cup", "tbsp", "tablespoon", "tsp", "teaspoon", "large", "medium", "small", "slice", "clove", "piece", "stalk", "leaf", "sprig", "can", "fillet", "breast", "thigh", "chop", "link", "egg", "whole", "fruit", "pepper", "head", "bunch", "oz")

def main():
    sys.stderr.write("Downloading SR Legacy...\n")
    data = urllib.request.urlopen(URL, timeout=300).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    def read(name):
        path = next(n for n in z.namelist() if n.endswith("/" + name) or n == name)
        return list(csv.DictReader(io.TextIOWrapper(z.open(path), encoding="utf-8")))
    foods = read("food.csv")
    by_desc = {f["description"].strip().lower(): f["fdc_id"] for f in foods}
    nutrients = {}
    WANT = {"1008": "kcal", "1003": "p", "1004": "f", "1005": "c", "1079": "fiber", "2000": "sugar", "1093": "na"}
    for row in read("food_nutrient.csv"):
        key = WANT.get(row["nutrient_id"])
        if key:
            nutrients.setdefault(row["fdc_id"], {})[key] = float(row["amount"] or 0)
    units = {r["id"]: r["name"] for r in read("measure_unit.csv")}
    portions = {}
    for r in read("food_portion.csv"):
        desc = " ".join(x for x in (units.get(r["measure_unit_id"], ""), r.get("portion_description", ""), r.get("modifier", "")) if x and x != "undetermined").strip()
        try:
            amount, grams = float(r["amount"] or 1), float(r["gram_weight"])
        except ValueError:
            continue
        portions.setdefault(r["fdc_id"], []).append([amount, desc.lower(), grams])

    out, missing = {}, []
    for key, (desc, aliases) in FOODS.items():
        want = desc.lower()
        fid = by_desc.get(want)
        if not fid:   # many names end in "(Includes foods for USDA's Food Distribution Program)"
            pre = sorted((len(d), d, i) for d, i in by_desc.items() if d.startswith(want))
            if pre:
                fid = pre[0][2]
        if not fid:
            head = want.split(",")[0].rstrip("s")
            stem = lambda w: w[:-1] if len(w) > 4 and w.endswith("s") else w
            words = [stem(w) for w in re.split(r"[^a-z0-9%]+", want) if w and w not in ("or", "and", "with", "the")]
            # Most of the description's words present, then closest wording, then shortest.
            cands = [(sum(w in d for w in words) / len(words), difflib.SequenceMatcher(None, want, d).ratio(), -len(d), d, i)
                     for d, i in by_desc.items() if d.startswith(head)]
            if cands:
                best = max(cands)
                fid = best[4]
                sys.stderr.write(f"approx {key!r}: {desc!r} -> {best[3]!r} ({best[0]:.2f})\n")
        if not fid:
            missing.append(key)
            continue
        n = nutrients.get(fid, {})
        ps = []
        for amount, d, g in portions.get(fid, []):
            if any(w in d for w in PORTION_WORDS) and amount > 0:
                ps.append([round(g / amount, 1), d[:40]])
        out[key] = {"n": [round(n.get("kcal", 0)), round(n.get("p", 0), 1), round(n.get("c", 0), 1), round(n.get("f", 0), 1)], "a": aliases, "u": ps[:8], "id": int(fid)}
    # Not in SR Legacy: from USDA's Branded Foods averages for unsweetened oat milk.
    if "oat milk" in missing:
        out["oat milk"] = {"n": [46, 0.4, 7.5, 1.5], "a": [], "u": [[240.0, "cup"]], "id": 0}
        missing.remove("oat milk")
    if missing:
        sys.stderr.write("MISSING: " + ", ".join(missing) + "\n")
    print("// Generated by tools/usda-table.py from USDA FoodData Central (SR Legacy, public domain).")
    print("// Per 100 g: [kcal, protein g, carbs g, fat g]; a: other names; u: [grams per unit, USDA portion]; id: FDC id.")
    print("(function (root) { 'use strict';")
    print("const FOODS = " + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";")
    print("if (typeof module !== 'undefined' && module.exports) module.exports = FOODS; root.NourishFoods = FOODS;")
    print("})(typeof window !== 'undefined' ? window : globalThis);")

main()
