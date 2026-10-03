# Recipe sources

Nourish finds real recipes on these sites and services (the list lives in `sources.js`; to add a site, add one line there).
Every site was checked by `tools/sources-check.js` (run in GitHub Actions, see `tools/sources-report.txt`):

1. **Recipe data:** a recipe page publishes structured recipe data (schema.org Recipe, the data search engines read). Nourish reads it with the same reader as "Add a recipe from a link".
2. **robots.txt** allows reading the recipe pages and the search used.
3. **Terms of use** don't forbid automated access (robots, scrapers, crawlers, data mining).
4. **No login or paywall** for the recipes.
5. **Recipes can be found by search** (the site's own WordPress search or its recipe sitemap), so nothing is crawled.

At plan time Nourish reads only the few pages a plan needs, at most 4 at a time and 42 per plan, caches them on the device, and skips a site that fails or refuses (for a day) without bothering you.

## Used (no key needed)

| Site | Kind | Lighter cooking | Lists nutrition | Found by |
|---|---|---|---|---|
| [Skinnytaste](https://skinnytaste.com) | Healthy | yes | yes | site search |
| [Budget Bytes](https://budgetbytes.com) | Healthy |  | yes | site search |
| [Cookie and Kate](https://cookieandkate.com) | Healthy | yes | yes | site search |
| [Minimalist Baker](https://minimalistbaker.com) | Healthy | yes | yes | site search |
| [Love and Lemons](https://loveandlemons.com) | Healthy | yes | yes | site search |
| [Well Plated](https://wellplated.com) | Healthy | yes | yes | site search |
| [Ambitious Kitchen](https://ambitiouskitchen.com) | Healthy | yes | yes | site search |
| [Pinch of Yum](https://pinchofyum.com) | Healthy |  |  | site search |
| [RecipeTin Eats](https://recipetineats.com) | General |  | yes | site search |
| [Hot Thai Kitchen](https://hot-thai-kitchen.com) | World cuisines |  |  | site search |
| [Mexico in My Kitchen](https://mexicoinmykitchen.com) | World cuisines |  | yes | site search |
| [The Mediterranean Dish](https://themediterraneandish.com) | World cuisines | yes | yes | site search |
| [FeelGoodFoodie](https://feelgoodfoodie.net) | Healthy | yes | yes | recipe sitemap |
| [The Healthy Maven](https://thehealthymaven.com) | Healthy | yes | yes | site search |
| [Cafe Delites](https://cafedelites.com) | General |  | yes | site search |
| [Spend With Pennies](https://spendwithpennies.com) | General |  | yes | site search |
| [Seonkyoung Longest](https://seonkyounglongest.com) | World cuisines |  | yes | site search |
| [Isabel Eats](https://isabeleats.com) | World cuisines |  | yes | site search |
| [TheMealDB](https://www.themealdb.com) | Recipe API | | | API |
| Your recipe library | Your own files | | | folder |

## Optional (needs a free key)

| Service | What it adds | Key |
|---|---|---|
| [Spoonacular](https://spoonacular.com/food-api) | Large recipe database with nutrition, filtered by diet and allergies | free key, Settings → Advanced → Recipe sources & keys |

## Not used, and why

| Site | Kind | Why not |
|---|---|---|
| HelloFresh (hellofresh.com) | Meal kits | terms forbid robots and scrapers (section 16.7) |
| EveryPlate (everyplate.com) | Meal kits | terms forbid robots and scrapers (same terms as HelloFresh) |
| Green Chef (greenchef.com) | Meal kits | terms forbid robots and scrapers (same terms as HelloFresh) |
| Home Chef (homechef.com) | Meal kits | terms forbid robots, spiders and scrapers |
| Blue Apron (blueapron.com) | Meal kits | refuses automated requests (403), no readable recipe data |
| Marley Spoon (marleyspoon.com) | Meal kits | recipes are behind the menu/login; search only finds blog posts |
| Dinnerly (dinnerly.com) | Meal kits | recipes are behind the menu/login; search only finds blog posts |
| Gousto (gousto.co.uk) | Meal kits | no readable recipe data found |
| EatingWell (eatingwell.com) | Healthy | terms (People Inc.) forbid scrapers and robots |
| Allrecipes (allrecipes.com) | General | terms (People Inc.) forbid scrapers and robots |
| Serious Eats (seriouseats.com) | General | terms (People Inc.) forbid scrapers and robots |
| Simply Recipes (simplyrecipes.com) | General | terms (People Inc.) forbid scrapers and robots |
| Epicurious (epicurious.com) | General | terms (Condé Nast) forbid crawling and scraping |
| Delish (delish.com) | General | terms (Hearst) forbid robots and crawlers; many recipes are members-only |
| Taste of Home (tasteofhome.com) | General | terms (Trusted Media Brands) forbid data mining and robots |
| Tasty (tasty.co) | General | terms (BuzzFeed) forbid automated access |
| Downshiftology (downshiftology.com) | Healthy | terms forbid AI and automated access |
| BBC Good Food (bbcgoodfood.com) | General | search pages could not be read into recipes |
| Food Network (foodnetwork.com) | General | robots.txt refuses automated readers (403) |
| The Kitchn (thekitchn.com) | General | terms forbid robots and scraping; refuses automated requests |
| Food52 (food52.com) | General | refuses automated requests (429) |
| Just One Cookbook (justonecookbook.com) | World cuisines | refuses automated requests |
| The Woks of Life (thewoksoflife.com) | World cuisines | refuses automated requests (403) |
| Maangchi (maangchi.com) | World cuisines | refuses automated requests (403) |
| Swasthi's Recipes (indianhealthyrecipes.com) | World cuisines | refuses automated requests |
| Dassana's Veg Recipes (vegrecipesofindia.com) | World cuisines | refuses automated requests (403) |
| Eating Bird Food (eatingbirdfood.com) | Healthy | refuses automated requests (403) |
| Gimme Some Oven (gimmesomeoven.com) | General | refuses automated requests (403) |
| Sally's Baking Addiction (sallysbakingaddiction.com) | General | refuses automated requests (403); mostly baking |
| MyPlate Kitchen (USDA) (myplate.gov) | Public health | robots.txt refuses automated readers (403) |
| NHLBI Heart-Healthy Recipes (nhlbi.nih.gov) | Public health | recipe pages have no recipe data to read |
| NHS Healthier Families (nhs.uk) | Public health | recipe pages have no recipe data to read |
| American Heart Association (heart.org) | Public health | refuses automated requests (403) |
| Diabetes Food Hub (diabetesfoodhub.org) | Public health | only category pages could be found, no readable recipes |
| Mayo Clinic (mayoclinic.org) | Public health | refuses automated requests (403) |

"Refuses automated requests" means the site answered the checks with an error (403/429) from GitHub's servers and no copy could be verified; such a site can be added again if it opens up.

## Nutrition data

Ingredient nutrition comes from **USDA FoodData Central** (SR Legacy, public domain), built into the app as `nutrition-data.js` by `tools/usda-table.py`. Open Food Facts is asked only for an ingredient the table doesn't have, when online, and the answer is cached.
