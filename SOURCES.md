# Recipe sources

Nourish finds real recipes on these sites and services (the list lives in `sources.js`; to add a site, add one line there).
Every site was checked by `tools/sources-check.js` (run in GitHub Actions, see `tools/sources-report.txt`):

1. **Recipe data:** a recipe page publishes structured recipe data (schema.org Recipe, the data search engines read). Nourish reads it with the same reader as "Add a recipe from a link".
2. **robots.txt** allows reading the recipe pages and the search used.
3. **Terms of use** don't forbid automated access (robots, scrapers, crawlers, data mining).
4. **No login or paywall** for the recipes.
5. **Recipes can be found** by the site's own search, its recipe category pages, its recipe sitemap or its feed, so nothing is crawled.

At plan time Nourish reads only the few pages a plan needs, at most 4 at a time and 42 per plan, caches them on the device, and skips a site that fails or refuses (for a day) without bothering you.

## Used (no key needed)

Since 0.1.17 each site has a **tier**. Trusted sites are popular, free, well-tested and flavour-focused: they are searched first, get twice the pages, and their recipes count for more in plans. Plain sites (public-health sites cook without salt and have no ratings; SBS Food and TheMealDB are a random mix) are searched last. Within any site, recipes with many high star ratings, real seasoning and familiar dishes come first (planner.js `quality`).

| Site | Kind | Tier | Lighter cooking | Lists nutrition | Found by |
|---|---|---|---|---|---|
| [Minimalist Baker](https://minimalistbaker.com) | Healthy | **Trusted** (searched first) | yes | yes | site search |
| [Love and Lemons](https://loveandlemons.com) | Healthy | **Trusted** (searched first) | yes | yes | site search |
| [RecipeTin Eats](https://recipetineats.com) | General | **Trusted** (searched first) |  | yes | site search |
| [Cafe Delites](https://cafedelites.com) | General | **Trusted** (searched first) |  | yes | site search |
| [Seonkyoung Longest](https://seonkyounglongest.com) | World cuisines | **Trusted** (searched first) |  | yes | site search |
| [Swasthi's Indian Healthy Recipes](https://indianhealthyrecipes.com) | World cuisines | **Trusted** (searched first) | yes | yes | category pages |
| [BBC Good Food](https://bbcgoodfood.com) | General | **Trusted** (searched first) | yes | yes | category pages, feed |
| [Jamie Oliver](https://jamieoliver.com) | General | **Trusted** (searched first) |  |  | category pages |
| [Kalyn's Kitchen](https://kalynskitchen.com) | Healthy | **Trusted** (searched first) | yes | yes | site search |
| [iFoodReal](https://ifoodreal.com) | Healthy | **Trusted** (searched first) | yes | yes | recipe sitemap |
| [Chef Savvy](https://chefsavvy.com) | General | **Trusted** (searched first) |  | yes | recipe sitemap |
| [olive magazine](https://olivemagazine.com) | General | Standard |  |  | category pages, feed |
| [BBC Food](https://bbc.co.uk) | General | Standard |  |  | recipe sitemap |
| [The Girl on Bloor](https://thegirlonbloor.com) | Healthy | Standard | yes | yes | site search |
| [Running on Real Food](https://runningonrealfood.com) | Healthy | Standard | yes | yes | site search |
| [Gimme Delicious](https://gimmedelicious.com) | General | Standard |  | yes | site search |
| [Pickled Plum](https://pickledplum.com) | World cuisines | Standard |  |  | recipe sitemap |
| [SBS Food](https://sbs.com.au) | World cuisines | Plain (searched last) |  |  | category pages |
| [British Heart Foundation](https://bhf.org.uk) | Public health | Plain (searched last) | yes | yes | recipe sitemap |
| [Diabetes UK](https://diabetes.org.uk) | Public health | Plain (searched last) | yes | yes | category pages |
| [Diabetes Food Hub](https://diabetesfoodhub.org) | Public health | Plain (searched last) | yes | yes | category pages |
| [TheMealDB](https://www.themealdb.com) | Recipe API | Plain (searched last) | | | API |
| Your recipe library | Your own files and books | | | | folder |

## Optional (needs a free key)

| Service | What it adds | Key |
|---|---|---|
| [Spoonacular](https://spoonacular.com/food-api) | Large recipe database with nutrition, filtered by diet and allergies | free key, Settings → Recipe and nutrition services |

## Not used, and why

The app lists these too, in Settings → Recipe sites → "Sites Nourish doesn't use". Nourish never tries to get around a site's rules.

| Site | Kind | Why not |
|---|---|---|
| Skinnytaste (skinnytaste.com) | Healthy | its legal page (checked November 2026) says its content may not be used for automated aggregation without permission |
| Budget Bytes (budgetbytes.com) | Healthy | refuses the app's searches and recipe pages (403), on phones and servers |
| Cookie and Kate (cookieandkate.com) | Healthy | refuses the app's searches and recipe pages (403), on phones and servers |
| Well Plated (wellplated.com) | Healthy | its terms (checked November 2026) forbid using its recipes with AI, and the chef in Nourish can read a planned recipe |
| Ambitious Kitchen (ambitiouskitchen.com) | Healthy | refuses the app's recipe pages (403) |
| Pinch of Yum (pinchofyum.com) | Healthy | refuses the app's recipe pages (405, a bot check) |
| Hot Thai Kitchen (hot-thai-kitchen.com) | World cuisines | refuses the app's searches and recipe pages (403) |
| Mexico in My Kitchen (mexicoinmykitchen.com) | World cuisines | refuses the app's recipe pages (403) |
| The Mediterranean Dish (themediterraneandish.com) | World cuisines | refuses the app's recipe pages (403) |
| FeelGoodFoodie (feelgoodfoodie.net) | Healthy | refuses the app's recipe pages (403); its 1.7 MB sitemap was downloaded on every plan for nothing |
| The Healthy Maven (thehealthymaven.com) | Healthy | its policy (checked November 2026) says robots and data-gathering tools are expressly prohibited |
| Spend With Pennies (spendwithpennies.com) | General | its robots.txt now asks robots not to read its pages (checked October 2026) |
| Isabel Eats (isabeleats.com) | World cuisines | refuses the app's recipe pages (403) |
| Gousto (gousto.co.uk) | Meal kits | its recipe lists are drawn by scripts in the browser: the pages have no recipe links to follow |
| Heart & Stroke Foundation (heartandstroke.ca) | Public health | recipe category pages are missing (404) or have no recipe links |
| Canada's Food Guide (food-guide.canada.ca) | Public health | its sitemap lists no recipe pages, and its recipe lists are drawn by scripts |
| Once Upon a Chef (onceuponachef.com) | General | its policy forbids scraping and data extraction |
| Primavera Kitchen (primaverakitchen.com) | Healthy | its terms forbid scraping and data harvesting |
| Kimchimari (kimchimari.com) | World cuisines | its terms forbid automated systems using its content |
| Eatwell101 (eatwell101.com) | General | its terms restrict automated access and scraping |
| Natasha's Kitchen (natashaskitchen.com) | General | refuses automated requests (403) |
| Damn Delicious (damndelicious.net) | General | refuses automated requests (403) |
| Sweet Peas and Saffron (sweetpeasandsaffron.com) | Healthy | refuses automated requests (403) |
| Rasa Malaysia (rasamalaysia.com) | World cuisines | refuses automated requests (403) |
| Feasting at Home (feastingathome.com) | Healthy | refuses automated requests (403) |
| Two Peas & Their Pod (twopeasandtheirpod.com) | General | refuses the app's recipe pages (403) |
| Nora Cooks (noracooks.com) | Healthy | refuses the app's recipe pages (403) |
| HelloFresh (hellofresh.com) | Meal kits | terms forbid robots and scrapers (section 16.7) |
| EveryPlate (everyplate.com) | Meal kits | terms forbid robots and scrapers (same terms as HelloFresh) |
| Green Chef (greenchef.com) | Meal kits | terms forbid robots and scrapers (same terms as HelloFresh) |
| Home Chef (homechef.com) | Meal kits | terms forbid robots, spiders and scrapers |
| Blue Apron (blueapron.com) | Meal kits | refuses automated requests (403), no readable recipe data |
| Marley Spoon (marleyspoon.com) | Meal kits | recipes are behind the menu/login; search only finds blog posts |
| Dinnerly (dinnerly.com) | Meal kits | recipes are behind the menu/login; search only finds blog posts |
| EatingWell (eatingwell.com) | Healthy | terms (People Inc.) forbid scrapers and robots |
| Allrecipes (allrecipes.com) | General | terms (People Inc.) forbid scrapers and robots |
| Serious Eats (seriouseats.com) | General | terms (People Inc.) forbid scrapers and robots |
| Simply Recipes (simplyrecipes.com) | General | terms (People Inc.) forbid scrapers and robots |
| Epicurious (epicurious.com) | General | terms (Condé Nast) forbid crawling and scraping |
| Delish (delish.com) | General | terms (Hearst) forbid robots and crawlers; many recipes are members-only |
| Taste of Home (tasteofhome.com) | General | terms (Trusted Media Brands) forbid data mining and robots |
| Tasty (tasty.co) | General | terms (BuzzFeed) forbid automated access |
| Downshiftology (downshiftology.com) | Healthy | terms forbid AI and automated access |
| Food Network (foodnetwork.com) | General | robots.txt refuses automated readers (403) |
| The Kitchn (thekitchn.com) | General | terms forbid robots and scraping; refuses automated requests |
| Food52 (food52.com) | General | refuses automated requests (429) |
| Just One Cookbook (justonecookbook.com) | World cuisines | refuses automated requests |
| The Woks of Life (thewoksoflife.com) | World cuisines | refuses automated requests (403) |
| Maangchi (maangchi.com) | World cuisines | refuses automated requests (403) |
| Dassana's Veg Recipes (vegrecipesofindia.com) | World cuisines | refuses automated requests (403) |
| Eating Bird Food (eatingbirdfood.com) | Healthy | refuses automated requests (403) |
| Gimme Some Oven (gimmesomeoven.com) | General | refuses automated requests (403) |
| Sally's Baking Addiction (sallysbakingaddiction.com) | General | refuses automated requests (403); mostly baking |
| MyPlate Kitchen (USDA) (myplate.gov) | Public health | robots.txt refuses automated readers (403) |
| NHLBI Heart-Healthy Recipes (nhlbi.nih.gov) | Public health | recipe pages have no recipe data to read |
| NHS Healthier Families (nhs.uk) | Public health | recipe pages carry no recipe data the app can read (checked again for 0.2) |
| American Heart Association (heart.org) | Public health | refuses automated requests (403) |
| Mayo Clinic (mayoclinic.org) | Public health | refuses automated requests (403) |

"Refuses automated requests" means the site answered the checks with an error (403/429) from GitHub's servers and no copy could be verified; such a site can be added again if it opens up.

## Nutrition data

Ingredient nutrition comes from **USDA FoodData Central** (SR Legacy, public domain), built into the app as `nutrition-data.js` by `tools/usda-table.py`. Open Food Facts is asked only for an ingredient the table doesn't have, when online, and the answer is cached.

## Free recipe and nutrition services (0.1.14)

All optional, all free, each enabled with a free key in Settings → Recipe and nutrition services.
Nourish works with none of them. Only recipe and ingredient text is sent. Keys stay in the iPhone
Keychain, the Android Keystore, or encrypted on the PC (`.nourish-key` next to the data file), and are
never logged.

| Service | Used for | Free limit | What its terms ask, and how Nourish follows them |
|---|---|---|---|
| Edamam Nutrition Analysis (Developer plan) | A second opinion on each recipe's nutrition, per ingredient | about 400 recipes a month, 10 a minute | Attribution next to the nutrition facts ("Nutrition analysis by Edamam", linked). Caching is limited: Nourish keeps only its own conclusion and the four main numbers (calories, protein, fat, carbs) per recipe, and shows Edamam's per-ingredient breakdown only in the session it was fetched. Not for commercial use on the free plan. |
| FatSecret Platform (Basic) | Per-ingredient food lookups as another check, and FatSecret's own recipes | about 5,000 calls a day, US foods | "Powered by fatsecret" attribution. Only ids (food_id, recipe_id) may be kept beyond 24 hours: food data is kept 24 hours at most, and FatSecret recipes are used for the plan only. OAuth 1.0 signing, so no IP address has to be registered. |
| USDA FoodData Central | Per-ingredient food lookups as another check | 1,000 an hour with a free key; the public DEMO_KEY (about 30 an hour) without one | Public domain (CC0): cached freely. Credited as USDA FoodData Central. |
| Spoonacular (free) | Recipe search with protein and calorie filters | 50 points a day | Data may be cached for 1 hour: Spoonacular recipes are used for the plan only, never kept in the library. Points are counted (from its quota header on the PC, estimated on a phone) and searches stop before the limit. Attribution under its recipes. |
| TheMealDB | Recipes, no key | | Its free test key is for development and education; TheMealDB asks publicly released apps to become a supporter (paid). Kept as before; noted here. |

Looked at and skipped: Edamam Recipe Search (paid), Nutritionix (no public free plan any more),
API Ninjas / CalorieNinjas (the free tier leaves out calories and protein, and doesn't allow commercial
use), unofficial scrapers presented as APIs (python-allrecipes and similar).
