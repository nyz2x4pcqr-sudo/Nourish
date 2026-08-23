// === STATE ===
let goal = '';
let source = 'aiChef';
let activeModel = 'qwen2.5-coder-7b-instruct';
let daysData = [];
let selectedDay = 0;
let lmStudioUrl = 'http://localhost:1234';
let usdaApiKey = 'DEMO_KEY';
let spoonacularApiKey = 'DEMO';
let activeProvider = 'lmstudio';
let claudeApiKey = '';
let claudeModel = 'claude-haiku-4-5';
let openaiApiKey = '';
let openaiModel = 'gpt-4o';
let ollamaUrl = 'http://localhost:11434';
let themealdbEnabled = true;
let autoFetchUSDA = true;
let showNutritionBadges = true;
let useKB = false;
let kbEntries = [];
let groceryItems = {};

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadSettings();
    loadModel();
    checkBackend();
});

// === TAB NAVIGATION ===
function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });
    switchTab('today');
}

function switchTab(tabName) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    
    // Show selected screen
    const screenMap = {
        'today': 'screenToday',
        'plan': 'screenPlan',
        'grocery': 'screenGrocery',
        'settings': 'screenSettings'
    };
    
    const screenId = screenMap[tabName];
    if (screenId) {
        document.getElementById(screenId).classList.add('active');
    }
    
    // Highlight tab
    const tab = document.querySelector(`[data-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
}

// === BACKEND & SETTINGS ===
async function checkBackend() {
    try {
        const res = await fetch('http://localhost:8000/health');
        const data = await res.json();
    } catch(e) {
        console.log('Backend offline');
    }
}

function loadSettings() {
    lmStudioUrl = localStorage.getItem('lmstudio_url') || 'http://localhost:1234';
    claudeApiKey = localStorage.getItem('claude_api_key') || '';
    claudeModel = localStorage.getItem('claude_model') || 'claude-haiku-4-5';
    openaiApiKey = localStorage.getItem('openai_api_key') || '';
    openaiModel = localStorage.getItem('openai_model') || 'gpt-4o';
    ollamaUrl = localStorage.getItem('ollama_url') || 'http://localhost:11434';
    activeProvider = localStorage.getItem('active_provider') || 'lmstudio';
    themealdbEnabled = localStorage.getItem('themealdb_enabled') !== 'false';
    spoonacularApiKey = localStorage.getItem('spoonacular_api_key') || 'DEMO';
    usdaApiKey = localStorage.getItem('usda_api_key') || 'DEMO_KEY';
    autoFetchUSDA = localStorage.getItem('autofetch_usda') !== 'false';
    showNutritionBadges = localStorage.getItem('show_nutrition_badges') !== 'false';
    useKB = localStorage.getItem('use_kb') === 'true';
    
    const savedGoal = localStorage.getItem('saved_goal');
    const savedLikes = localStorage.getItem('saved_likes');
    const savedHates = localStorage.getItem('saved_hates');
    const savedSource = localStorage.getItem('saved_source');
    if (savedGoal) goal = savedGoal;
    if (savedLikes) document.getElementById('inputLikes').value = savedLikes;
    if (savedHates) document.getElementById('inputHates').value = savedHates;
    if (savedSource) source = savedSource;
}

function saveSettings() {
    localStorage.setItem('lmstudio_url', lmStudioUrl);
    localStorage.setItem('claude_api_key', claudeApiKey);
    localStorage.setItem('claude_model', claudeModel);
    localStorage.setItem('openai_api_key', openaiApiKey);
    localStorage.setItem('openai_model', openaiModel);
    localStorage.setItem('ollama_url', ollamaUrl);
    localStorage.setItem('active_provider', activeProvider);
}

async function loadModel() {
    if (activeProvider === 'lmstudio') {
        try {
            const res = await fetch('http://localhost:8000/api/models');
            const data = await res.json();
            if (data?.data?.[0]?.id) {
                activeModel = data.data[0].id;
            }
        } catch (e) {
            // Silent fail
        }
    }
}

// === GENERATE SHEET ===
function showGenerateSheet() {
    const sheet = document.getElementById('generateSheet');
    sheet.classList.add('active');
    
    setupGenerateSheetListeners();
}

function closeGenerateSheet() {
    const sheet = document.getElementById('generateSheet');
    sheet.classList.remove('active');
}

function setupGenerateSheetListeners() {
    const backdrop = document.getElementById('generateSheetBackdrop');
    backdrop.onclick = closeGenerateSheet;
    
    // Goal segments
    document.querySelectorAll('.segment-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            goal = btn.dataset.goal;
            localStorage.setItem('saved_goal', goal);
        };
    });
    
    // Source buttons
    document.querySelectorAll('.source-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            source = btn.dataset.source;
            localStorage.setItem('saved_source', source);
        };
    });
}

// === TODAY SCREEN ===
function updateTodayScreen() {
    if (!daysData || daysData.length === 0) {
        document.getElementById('emptyState').style.display = 'block';
        document.getElementById('calorieSection').style.display = 'none';
        document.getElementById('mealCards').style.display = 'none';
        return;
    }
    
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('calorieSection').style.display = 'block';
    document.getElementById('mealCards').style.display = 'block';
    
    // Update day strip
    const dayStrip = document.getElementById('dayStrip');
    dayStrip.querySelectorAll('.day-pill').forEach((pill, idx) => {
        if (idx === selectedDay) pill.classList.add('active');
        else pill.classList.remove('active');
        
        pill.onclick = () => {
            selectedDay = idx;
            updateTodayScreen();
        };
    });
    
    const dayData = daysData[selectedDay];
    if (!dayData) return;
    
    // Update title
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    document.getElementById('todayTitle').textContent = `${days[selectedDay]}, ${new Date().toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;
    
    // Update calorie ring
    const totalCal = (dayData.breakfast?.nutrition?.calories || 0) + 
                     (dayData.lunch?.nutrition?.calories || 0) + 
                     (dayData.dinner?.nutrition?.calories || 0);
    document.getElementById('calorieValue').textContent = totalCal.toLocaleString();
    updateCalorieRing(totalCal, 2400);
    
    // Update macro bars
    const totalProtein = (dayData.breakfast?.nutrition?.protein_g || 0) + 
                        (dayData.lunch?.nutrition?.protein_g || 0) + 
                        (dayData.dinner?.nutrition?.protein_g || 0);
    const totalCarbs = (dayData.breakfast?.nutrition?.carbs_g || 0) + 
                      (dayData.lunch?.nutrition?.carbs_g || 0) + 
                      (dayData.dinner?.nutrition?.carbs_g || 0);
    const totalFat = (dayData.breakfast?.nutrition?.fat_g || 0) + 
                    (dayData.lunch?.nutrition?.fat_g || 0) + 
                    (dayData.dinner?.nutrition?.fat_g || 0);
    
    document.getElementById('proteinValue').textContent = Math.round(totalProtein) + 'g';
    document.getElementById('carbsValue').textContent = Math.round(totalCarbs) + 'g';
    document.getElementById('fatValue').textContent = Math.round(totalFat) + 'g';
    
    // Update macro bar widths
    const macroBars = document.querySelectorAll('.macro-fill');
    macroBars[0].style.width = (totalProtein / 200 * 100) + '%';
    macroBars[1].style.width = (totalCarbs / 400 * 100) + '%';
    macroBars[2].style.width = (totalFat / 120 * 100) + '%';
    
    // Update meal cards
    updateMealCard('breakfast', dayData.breakfast);
    updateMealCard('lunch', dayData.lunch);
    updateMealCard('dinner', dayData.dinner);
}

function updateMealCard(mealType, meal) {
    if (!meal) return;
    const card = document.querySelector(`[data-meal="${mealType}"]`);
    if (!card) return;
    
    card.querySelector('.meal-name').textContent = meal.name;
    const badges = card.querySelector('.meal-badges');
    badges.innerHTML = `
        <span class="meal-badge">⏱ ${meal.time_minutes} min</span>
        <span class="meal-badge">${Math.round(meal.nutrition?.calories || 0)} cal</span>
    `;
    
    card.onclick = () => openRecipeSheet(mealType, meal);
}

function updateCalorieRing(consumed, goal) {
    const progress = document.getElementById('calorieProgress');
    const circumference = 2 * Math.PI * 70;
    const percentage = Math.min(consumed / goal, 1);
    const dasharray = circumference * percentage;
    progress.style.strokeDasharray = `${dasharray} ${circumference}`;
}

// === RECIPE SHEET ===
function openRecipeSheet(mealType, meal) {
    const sheet = document.getElementById('recipeSheet');
    const content = document.getElementById('recipeSheetContent');
    
    const emojis = { breakfast: '🍳', lunch: '🥗', dinner: '🍝' };
    const emoji = emojis[mealType] || '🍽️';
    
    let ingredientsHTML = '';
    if (meal.ingredients && meal.ingredients.length > 0) {
        ingredientsHTML = `
            <div class="recipe-section">
                <div class="recipe-section-title">Ingredients</div>
                <div class="recipe-ingredients">
                    ${meal.ingredients.map(ing => `<div class="recipe-ingredient">${ing}</div>`).join('')}
                </div>
            </div>
        `;
    }
    
    let stepsHTML = '';
    if (meal.steps && meal.steps.length > 0) {
        stepsHTML = `
            <div class="recipe-section">
                <div class="recipe-section-title">Instructions</div>
                <div class="recipe-steps">
                    ${meal.steps.map((step, idx) => `
                        <div class="recipe-step">
                            <div class="recipe-step-number">${idx + 1}</div>
                            <div class="recipe-step-text">${step}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    content.innerHTML = `
        <div class="recipe-sheet-handle"></div>
        <div class="recipe-hero">
            <div class="recipe-emoji">${emoji}</div>
        </div>
        <div class="recipe-header">
            <div class="recipe-name">${meal.name}</div>
            <div class="recipe-meta">
                <div class="recipe-chip">⏱ ${meal.time_minutes} min</div>
                <div class="recipe-chip">${Math.round(meal.nutrition?.calories || 0)} cal</div>
                <div class="recipe-chip">P: ${Math.round(meal.nutrition?.protein_g || 0)}g</div>
                <div class="recipe-chip">C: ${Math.round(meal.nutrition?.carbs_g || 0)}g</div>
                <div class="recipe-chip">F: ${Math.round(meal.nutrition?.fat_g || 0)}g</div>
            </div>
        </div>
        ${ingredientsHTML}
        ${stepsHTML}
    `;
    
    sheet.classList.add('active');
    
    const backdrop = document.getElementById('recipeSheetBackdrop');
    backdrop.onclick = closeRecipeSheet;
}

function closeRecipeSheet() {
    const sheet = document.getElementById('recipeSheet');
    sheet.classList.remove('active');
}

// === PLAN SCREEN ===
function updatePlanScreen() {
    const container = document.getElementById('planAccordions');
    container.innerHTML = '';
    
    if (!daysData || daysData.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-faint);">No meal plan yet</div>';
        return;
    }
    
    daysData.forEach((dayData, idx) => {
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const totalCal = (dayData.breakfast?.nutrition?.calories || 0) + 
                        (dayData.lunch?.nutrition?.calories || 0) + 
                        (dayData.dinner?.nutrition?.calories || 0);
        
        const accordion = document.createElement('div');
        accordion.className = 'accordion';
        
        const header = document.createElement('button');
        header.className = 'accordion-header';
        header.type = 'button';
        header.setAttribute('aria-expanded', 'false');
        header.innerHTML = `
            <span>Day ${dayData.day} - ${dayNames[(dayData.day - 1) % 7]}</span>
            <span style="margin-left:auto;color:var(--text-dim);">${Math.round(totalCal)} cal</span>
            <span class="accordion-arrow">▾</span>
        `;
        
        header.addEventListener('click', () => {
            const isOpen = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', !isOpen);
            content.style.display = isOpen ? 'none' : 'block';
        });
        
        const content = document.createElement('div');
        content.className = 'accordion-content';
        content.style.display = 'none';
        content.innerHTML = `
            ${renderPlanMeal(dayData.breakfast, 'breakfast')}
            ${renderPlanMeal(dayData.lunch, 'lunch')}
            ${renderPlanMeal(dayData.dinner, 'dinner')}
        `;
        
        accordion.appendChild(header);
        accordion.appendChild(content);
        container.appendChild(accordion);
    });
}

function renderPlanMeal(meal, type) {
    if (!meal) return '';
    const icons = { breakfast: '🍳', lunch: '🥗', dinner: '🍝' };
    const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
    return `
        <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:12px;cursor:pointer;" onclick="openRecipeSheet('${type}', ${JSON.stringify(meal).replace(/"/g, '&quot;')})">
            <div style="font-size:24px;">${icons[type]}</div>
            <div style="flex:1;">
                <div style="font-size:13px;color:var(--text-dim);">${labels[type]}</div>
                <div style="font-size:16px;font-weight:600;">${meal.name}</div>
                <div style="font-size:11px;color:var(--text-faint);margin-top:4px;">⏱ ${meal.time_minutes} min • ${Math.round(meal.nutrition?.calories || 0)} cal</div>
            </div>
        </div>
    `;
}

// === GROCERY SCREEN ===
function updateGroceryScreen() {
    const container = document.getElementById('groceryContainer');
    container.innerHTML = '';
    
    if (!daysData || daysData.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-faint);">No grocery list yet</div>';
        return;
    }
    
    const items = {};
    daysData.forEach(day => {
        ['breakfast', 'lunch', 'dinner'].forEach(meal => {
            if (day[meal] && day[meal].ingredients) {
                day[meal].ingredients.forEach(ing => {
                    const category = categorizeIngredient(ing);
                    if (!items[category]) items[category] = [];
                    if (!items[category].includes(ing)) items[category].push(ing);
                });
            }
        });
    });
    
    const totalItems = Object.values(items).reduce((sum, arr) => sum + arr.length, 0);
    
    const progressHTML = `
        <div style="margin-bottom:20px;">
            <div class="progress-label">0 of ${totalItems} items</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%;"></div>
            </div>
        </div>
    `;
    container.innerHTML = progressHTML;
    
    Object.keys(items).sort().forEach(category => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'grocery-category';
        categoryDiv.innerHTML = `
            <div class="category-header">${category}</div>
            ${items[category].map((item, idx) => `
                <div class="grocery-item">
                    <input type="checkbox" data-item="${item}" onchange="updateProgress()"/>
                    <span class="grocery-item-text">${item}</span>
                </div>
            `).join('')}
        `;
        container.appendChild(categoryDiv);
    });
}

function categorizeIngredient(ing) {
    const lower = ing.toLowerCase();
    if (['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'turkey', 'egg', 'tofu'].some(p => lower.includes(p))) return 'Proteins';
    if (['milk', 'cheese', 'yogurt', 'butter', 'cream'].some(p => lower.includes(p))) return 'Dairy';
    if (['rice', 'pasta', 'bread', 'oat', 'flour', 'quinoa'].some(p => lower.includes(p))) return 'Grains';
    if (['tomato', 'onion', 'garlic', 'lettuce', 'spinach', 'broccoli', 'carrot', 'apple', 'banana', 'lemon', 'lime', 'bell pepper', 'mushroom', 'potato', 'zucchini', 'cucumber', 'celery', 'kale', 'cabbage', 'avocado'].some(p => lower.includes(p))) return 'Produce';
    if (['oil', 'salt', 'pepper', 'spice', 'sauce', 'vinegar', 'soy'].some(p => lower.includes(p))) return 'Pantry';
    return 'Other';
}

function updateProgress() {
    const checkboxes = document.querySelectorAll('.grocery-item input[type="checkbox"]');
    const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
    const total = checkboxes.length;
    document.querySelector('.progress-label').textContent = `${checked} of ${total} items`;
    document.getElementById('progressFill').style.width = (checked / total * 100) + '%';
    
    checkboxes.forEach(cb => {
        const item = cb.parentElement;
        if (cb.checked) item.classList.add('checked');
        else item.classList.remove('checked');
    });
}

// === GENERATE MEAL PLAN ===
async function generateMealPlan() {
    const likes = document.getElementById('inputLikes').value.trim();
    const hates = document.getElementById('inputHates').value.trim();
    
    if (!goal) {
        alert('Please select a goal');
        return;
    }
    
    if (!likes && !hates) {
        alert('Enter at least some preferences');
        return;
    }
    
    localStorage.setItem('saved_likes', likes);
    localStorage.setItem('saved_hates', hates);
    
    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = 'Cooking...';
    
    try {
        let parsedData;
        
        if (source === 'aiChef') {
            parsedData = await generateWithAIChef(likes, hates);
        } else if (source === 'themealdb') {
            parsedData = await generateWithTheMealDB(likes, hates);
        } else if (source === 'spoonacular') {
            parsedData = await generateWithSpoonacular(likes, hates);
        }
        
        if (!parsedData || !parsedData.days) {
            throw new Error('Invalid response');
        }
        
        daysData = parsedData.days;
        closeGenerateSheet();
        updateTodayScreen();
        updatePlanScreen();
        updateGroceryScreen();
        switchTab('today');
        
        if (autoFetchUSDA) {
            await fetchUSDANutrition();
        }
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Plan';
    }
}

async function generateWithAIChef(likes, hates) {
    if (activeProvider === 'claude') return generateWithClaude(likes, hates);
    if (activeProvider === 'openai') return generateWithOpenAI(likes, hates);
    if (activeProvider === 'ollama') return generateWithOllama(likes, hates);
    return generateWithLMStudio(likes, hates);
}

async function generateWithLMStudio(likes, hates) {
    const response = await fetch('http://localhost:8000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'lmstudio',
            model: activeModel,
            messages: [
                {
                    role: 'system',
                    content: 'Return ONLY raw JSON. No markdown. Format: {"days":[{"day":1,"breakfast":{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]},"lunch":{same},"dinner":{same}}]}'
                },
                {
                    role: 'user',
                    content: `Goal: ${goal}. Likes: ${likes || 'any'}. Avoids: ${hates || 'none'}. Generate 7-day meal plan.`
                }
            ],
            temperature: 0.7,
            max_tokens: 4000
        })
    });
    
    const data = await response.json();
    return parseJSONResponse(data?.choices?.[0]?.message?.content);
}

async function generateWithClaude(likes, hates) {
    if (!claudeApiKey) throw new Error('Add Claude API key in Settings');
    
    const response = await fetch('http://localhost:8000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'claude',
            model: claudeModel,
            api_key: claudeApiKey,
            messages: [{
                role: 'user',
                content: `Return ONLY raw JSON for a 7-day meal plan. Goal: ${goal}. Likes: ${likes}. Avoids: ${hates}`
            }],
            temperature: 0.7,
            max_tokens: 4000
        })
    });
    
    const data = await response.json();
    return parseJSONResponse(data?.content?.[0]?.text);
}

async function generateWithOpenAI(likes, hates) {
    if (!openaiApiKey) throw new Error('Add OpenAI API key in Settings');
    
    const response = await fetch('http://localhost:8000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'openai',
            model: openaiModel,
            api_key: openaiApiKey,
            messages: [
                {
                    role: 'system',
                    content: 'Return ONLY raw JSON for a 7-day meal plan'
                },
                {
                    role: 'user',
                    content: `Goal: ${goal}. Likes: ${likes}. Avoids: ${hates}`
                }
            ],
            temperature: 0.7,
            max_tokens: 4000
        })
    });
    
    const data = await response.json();
    return parseJSONResponse(data?.choices?.[0]?.message?.content);
}

async function generateWithOllama(likes, hates) {
    const response = await fetch('http://localhost:8000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'ollama',
            model: 'neural-chat',
            prompt: `Return ONLY raw JSON for 7-day meal plan. Goal: ${goal}. Likes: ${likes}. Avoids: ${hates}`
        })
    });
    
    const data = await response.json();
    return parseJSONResponse(data?.response);
}

async function generateWithTheMealDB(likes, hates) {
    const response = await fetch('http://localhost:8000/api/recipes/themealdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: likes.split(',')[0] || 'Pasta' })
    });
    
    const data = await response.json();
    if (!data.meals || data.meals.length === 0) throw new Error('No meals found');
    
    const days = [];
    let mealIdx = 0;
    for (let day = 1; day <= 7; day++) {
        const dayObj = { day };
        ['breakfast', 'lunch', 'dinner'].forEach(meal => {
            if (mealIdx < data.meals.length) {
                const recipe = data.meals[mealIdx];
                const ingredients = [];
                for (let i = 1; i <= 20; i++) {
                    const ing = recipe[`strIngredient${i}`];
                    if (ing && ing.trim()) {
                        ingredients.push(`${recipe[`strMeasure${i}`] || ''} ${ing}`.trim());
                    }
                }
                const steps = (recipe.strInstructions || '').split('.').map(s => s.trim()).filter(s => s.length > 10).slice(0, 10);
                
                dayObj[meal] = {
                    name: recipe.strMeal,
                    time_minutes: 30,
                    nutrition: { calories: 2000, protein_g: 50, carbs_g: 250, fat_g: 65 },
                    ingredients,
                    steps
                };
                mealIdx++;
            }
        });
        days.push(dayObj);
    }
    return { days };
}

async function generateWithSpoonacular(likes, hates) {
    const response = await fetch('http://localhost:8000/api/recipes/spoonacular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: spoonacularApiKey,
            query: likes.split(',')[0] || 'chicken',
            number: 21,
            excludeIngredients: hates
        })
    });
    
    const data = await response.json();
    if (!data.results || data.results.length === 0) throw new Error('No recipes found');
    
    const days = [];
    let recipeIdx = 0;
    for (let day = 1; day <= 7; day++) {
        const dayObj = { day };
        ['breakfast', 'lunch', 'dinner'].forEach(meal => {
            if (recipeIdx < data.results.length) {
                const recipe = data.results[recipeIdx];
                dayObj[meal] = {
                    name: recipe.title,
                    time_minutes: recipe.readyInMinutes || 30,
                    nutrition: {
                        calories: 2000,
                        protein_g: 50,
                        carbs_g: 250,
                        fat_g: 65
                    },
                    ingredients: (recipe.extendedIngredients || []).map(i => i.original),
                    steps: (recipe.analyzedInstructions?.[0]?.steps || []).map(s => s.step).slice(0, 10)
                };
                recipeIdx++;
            }
        });
        days.push(dayObj);
    }
    return { days };
}

function parseJSONResponse(result) {
    if (!result) throw new Error('No response');
    let raw = result.trim();
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found');
    raw = raw.substring(start, end + 1);
    raw = raw.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(raw);
}

async function fetchUSDANutrition() {
    // Placeholder for USDA integration
}
