
        async function checkBackend() {
            try {
                const res = await fetch('http://localhost:8000/health');
                const data = await res.json();
                if (data.status === 'ok') {
                    document.getElementById('modelIndicator').textContent = '✅ Backend connected';
                }
            } catch(e) {
                document.getElementById('modelIndicator').textContent = '❌ Backend offline - run docker-compose up';
            }
        }
        checkBackend();

        let goal = '';
        let source = 'aiChef';
        let activeModel = 'qwen2.5-coder-7b-instruct';
        let daysData = [];
        let mealIndexCounter = 0;
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
        let edamamAppId = '';
        let edamamAppKey = '';
        let tastyApiKey = '';
        let autoFetchUSDA = true;
        let showNutritionBadges = true;
        let useKB = false;
        let kbEntries = [];

        function loadSettings() {
            // AI Models
            lmStudioUrl = localStorage.getItem('lmstudio_url') || 'http://localhost:1234';
            claudeApiKey = localStorage.getItem('claude_api_key') || '';
            claudeModel = localStorage.getItem('claude_model') || 'claude-haiku-4-5';
            openaiApiKey = localStorage.getItem('openai_api_key') || '';
            openaiModel = localStorage.getItem('openai_model') || 'gpt-4o';
            ollamaUrl = localStorage.getItem('ollama_url') || 'http://localhost:11434';
            activeProvider = localStorage.getItem('active_provider') || 'lmstudio';
            
            // Recipe Sources
            themealdbEnabled = localStorage.getItem('themealdb_enabled') !== 'false';
            spoonacularApiKey = localStorage.getItem('spoonacular_api_key') || 'DEMO';
            edamamAppId = localStorage.getItem('edamam_app_id') || '';
            edamamAppKey = localStorage.getItem('edamam_app_key') || '';
            tastyApiKey = localStorage.getItem('tasty_api_key') || '';
            
            // Nutrition
            usdaApiKey = localStorage.getItem('usda_api_key') || 'DEMO_KEY';
            autoFetchUSDA = localStorage.getItem('autofetch_usda') !== 'false';
            showNutritionBadges = localStorage.getItem('show_nutrition_badges') !== 'false';
            useKB = localStorage.getItem('use_kb') === 'true';
            // Try to load KB entries from backend, fallback to localStorage
            try {
                fetch('http://localhost:8000/api/knowledge')
                    .then(r => r.json())
                    .then(data => {
                        if (data.entries && data.entries.length > 0) {
                            kbEntries = data.entries;
                            renderKBEntries();
                        }
                    })
                    .catch(() => {
                        // Fallback to localStorage
                        const kbEntriesJSON = localStorage.getItem('kb_entries');
                        kbEntries = kbEntriesJSON ? JSON.parse(kbEntriesJSON) : [];
                        renderKBEntries();
                    });
            } catch (e) {
                const kbEntriesJSON = localStorage.getItem('kb_entries');
                kbEntries = kbEntriesJSON ? JSON.parse(kbEntriesJSON) : [];
                renderKBEntries();
            }
            
            // Populate input fields
            document.getElementById('lmstudioUrlInput').value = lmStudioUrl;
            document.getElementById('claudeApiKeyInput').value = claudeApiKey;
            document.getElementById('claudeModelSelect').value = claudeModel;
            document.getElementById('openaiApiKeyInput').value = openaiApiKey;
            document.getElementById('openaiModelSelect').value = openaiModel;
            document.getElementById('ollamaUrlInput').value = ollamaUrl;
            document.getElementById('spoonacularApiKeyInput').value = spoonacularApiKey;
            document.getElementById('edamamAppIdInput').value = edamamAppId;
            document.getElementById('edamamAppKeyInput').value = edamamAppKey;
            document.getElementById('tastyApiKeyInput').value = tastyApiKey;
            document.getElementById('usdaApiKeyInput').value = usdaApiKey;
            
            // Set radio buttons and toggles
            document.getElementById('provider-' + activeProvider).checked = true;
            if (themealdbEnabled) {
                document.getElementById('themealdb-toggle').classList.add('on');
            }
            if (autoFetchUSDA) {
                document.getElementById('autofetch-toggle').classList.add('on');
            }
            if (showNutritionBadges) {
                document.getElementById('badges-toggle').classList.add('on');
            }
            if (useKB) {
                document.getElementById('use-kb-toggle').classList.add('on');
            }
            
            updateModelIndicator();
        }

        function saveSettings() {
            // AI Models
            lmStudioUrl = document.getElementById('lmstudioUrlInput').value || 'http://localhost:1234';
            claudeApiKey = document.getElementById('claudeApiKeyInput').value || '';
            claudeModel = document.getElementById('claudeModelSelect').value || 'claude-haiku-4-5';
            openaiApiKey = document.getElementById('openaiApiKeyInput').value || '';
            openaiModel = document.getElementById('openaiModelSelect').value || 'gpt-4o';
            ollamaUrl = document.getElementById('ollamaUrlInput').value || 'http://localhost:11434';
            activeProvider = document.querySelector('input[name="activeProvider"]:checked').value || 'lmstudio';
            
            // Recipe Sources
            spoonacularApiKey = document.getElementById('spoonacularApiKeyInput').value || 'DEMO';
            edamamAppId = document.getElementById('edamamAppIdInput').value || '';
            edamamAppKey = document.getElementById('edamamAppKeyInput').value || '';
            tastyApiKey = document.getElementById('tastyApiKeyInput').value || '';
            
            // Nutrition
            usdaApiKey = document.getElementById('usdaApiKeyInput').value || 'DEMO_KEY';
            
            // Save to localStorage
            localStorage.setItem('lmstudio_url', lmStudioUrl);
            localStorage.setItem('claude_api_key', claudeApiKey);
            localStorage.setItem('claude_model', claudeModel);
            localStorage.setItem('openai_api_key', openaiApiKey);
            localStorage.setItem('openai_model', openaiModel);
            localStorage.setItem('ollama_url', ollamaUrl);
            localStorage.setItem('active_provider', activeProvider);
            localStorage.setItem('themealdb_enabled', themealdbEnabled);
            localStorage.setItem('spoonacular_api_key', spoonacularApiKey);
            localStorage.setItem('edamam_app_id', edamamAppId);
            localStorage.setItem('edamam_app_key', edamamAppKey);
            localStorage.setItem('tasty_api_key', tastyApiKey);
            localStorage.setItem('usda_api_key', usdaApiKey);
            localStorage.setItem('autofetch_usda', autoFetchUSDA);
            localStorage.setItem('show_nutrition_badges', showNutritionBadges);
            
            // Show saved notification
            const savedMsg = document.getElementById('settingsSavedMsg');
            savedMsg.style.display = 'block';
            setTimeout(() => {
                savedMsg.style.display = 'none';
            }, 3000);
            
            updateModelIndicator();
        }

        function saveSettingsAuto() {
            activeProvider = document.querySelector('input[name="activeProvider"]:checked').value;
            localStorage.setItem('active_provider', activeProvider);
            updateModelIndicator();
        }

        function toggleSettings() {
            const drawer = document.getElementById('settingsDrawer');
            drawer.classList.toggle('open');
        }

        function switchSettingsTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.settings-tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.settings-tab-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Show selected tab
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }

        async function testConnection(provider) {
            const resultEl = document.getElementById(provider + '-test');
            resultEl.className = 'test-result';
            resultEl.textContent = 'Testing...';
            resultEl.style.display = 'block';
            
            try {
                let url, endpoint;
                if (provider === 'lmstudio') {
                    url = document.getElementById('lmstudioUrlInput').value || 'http://localhost:1234';
                    endpoint = '/v1/models';
                } else if (provider === 'ollama') {
                    url = document.getElementById('ollamaUrlInput').value || 'http://localhost:11434';
                    endpoint = '/api/tags';
                }
                
                const response = await fetch(url + endpoint, { timeout: 5000 });
                if (response.ok) {
                    resultEl.className = 'test-result success';
                    resultEl.textContent = '✅ Connected';
                } else {
                    resultEl.className = 'test-result error';
                    resultEl.textContent = '❌ Failed: ' + response.status;
                }
            } catch (err) {
                resultEl.className = 'test-result error';
                resultEl.textContent = '❌ Failed: ' + err.message;
            }
        }

        function toggleTheMealDB() {
            const toggle = document.getElementById('themealdb-toggle');
            themealdbEnabled = !themealdbEnabled;
            toggle.classList.toggle('on');
            localStorage.setItem('themealdb_enabled', themealdbEnabled);
        }

        function toggleAutoFetch() {
            const toggle = document.getElementById('autofetch-toggle');
            autoFetchUSDA = !autoFetchUSDA;
            toggle.classList.toggle('on');
            localStorage.setItem('autofetch_usda', autoFetchUSDA);
        }

        function toggleNutritionBadges() {
            const toggle = document.getElementById('badges-toggle');
            showNutritionBadges = !showNutritionBadges;
            toggle.classList.toggle('on');
            localStorage.setItem('show_nutrition_badges', showNutritionBadges);
        }

        function updateModelIndicator() {
            const providerNames = {
                'lmstudio': 'LM Studio',
                'claude': 'Claude',
                'openai': 'OpenAI',
                'ollama': 'Ollama'
            };
            const modelNames = {
                'lmstudio': activeModel || 'Loading...',
                'claude': claudeModel,
                'openai': openaiModel,
                'ollama': 'Ollama'
            };
            const providerName = providerNames[activeProvider] || activeProvider;
            const modelName = modelNames[activeProvider] || 'Unknown';
            document.getElementById('modelIndicator').textContent = '🤖 ' + providerName + ' • ' + modelName;
        }

        async function addKBEntry() {
            const name = document.getElementById('kbNameInput').value.trim();
            const content = document.getElementById('kbContentInput').value.trim();
            
            if (!name) {
                alert('Please enter a name for this knowledge base entry');
                return;
            }
            if (!content) {
                alert('Please enter some content');
                return;
            }
            
            try {
                const response = await fetch('http://localhost:8000/api/knowledge/add-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, content })
                });
                
                if (!response.ok) {
                    throw new Error('Failed to add knowledge base entry');
                }
                
                const result = await response.json();
                alert(`✅ Added "${name}" with ${result.chunks_created} chunks (${result.total_content_length} chars)`);
                
                document.getElementById('kbNameInput').value = '';
                document.getElementById('kbContentInput').value = '';
                await refreshKBEntries();
            } catch (err) {
                alert('Error: ' + err.message);
            }
        }

        async function uploadKBFile() {
            const fileInput = document.getElementById('kbFileInput');
            const nameInput = document.getElementById('kbNameInput');
            const file = fileInput.files[0];
            const statusEl = document.getElementById('fileUploadStatus');
            
            if (!file) {
                alert('Please select a file');
                return;
            }
            
            let name = nameInput.value.trim();
            if (!name) {
                name = file.name.split('.')[0];
                nameInput.value = name;
            }
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('name', name);
            
            try {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(255, 193, 7, 0.2)';
                statusEl.style.color = '#fff59d';
                statusEl.textContent = '⏳ Uploading and processing...';
                
                const response = await fetch('http://localhost:8000/api/knowledge/add', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    throw new Error('Failed to upload file');
                }
                
                const result = await response.json();
                statusEl.style.background = 'rgba(76, 175, 80, 0.2)';
                statusEl.style.color = '#81c784';
                statusEl.textContent = `✅ File "${name}" added with ${result.chunks_created} chunks`;
                
                fileInput.value = '';
                document.getElementById('kbContentInput').value = '';
                await refreshKBEntries();
                
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 3000);
            } catch (err) {
                statusEl.style.background = 'rgba(244, 67, 54, 0.2)';
                statusEl.style.color = '#ef5350';
                statusEl.textContent = '❌ Error: ' + err.message;
            }
        }

        async function refreshKBEntries() {
            try {
                const response = await fetch('http://localhost:8000/api/knowledge');
                if (response.ok) {
                    const result = await response.json();
                    // Update kbEntries with backend entries
                    kbEntries = result.entries.map(name => ({ name, content: '' }));
                    renderKBEntries();
                }
            } catch (err) {
                console.error('Error refreshing KB entries:', err);
            }
        }

        async function deleteKBEntry(index) {
            if (confirm('Delete this knowledge base entry?')) {
                const entryName = kbEntries[index]?.name;
                if (!entryName) return;
                
                try {
                    const response = await fetch(`http://localhost:8000/api/knowledge/${encodeURIComponent(entryName)}`, {
                        method: 'DELETE'
                    });
                    
                    if (response.ok) {
                        kbEntries.splice(index, 1);
                        renderKBEntries();
                    } else {
                        alert('Failed to delete entry');
                    }
                } catch (err) {
                    alert('Error: ' + err.message);
                }
            }
        }

        async function clearAllKBEntries() {
            if (confirm('Delete all knowledge base entries? This cannot be undone.')) {
                try {
                    // Delete all entries
                    for (const entry of kbEntries) {
                        await fetch(`http://localhost:8000/api/knowledge/${encodeURIComponent(entry.name)}`, {
                            method: 'DELETE'
                        });
                    }
                    kbEntries = [];
                    renderKBEntries();
                } catch (err) {
                    alert('Error: ' + err.message);
                }
            }
        }

        function renderKBEntries() {
            const listContainer = document.getElementById('kbEntriesList');
            
            if (kbEntries.length === 0) {
                listContainer.innerHTML = '<p style="color: #888; text-align: center; padding: 20px; margin: 0;">No knowledge base entries yet</p>';
                return;
            }
            
            listContainer.innerHTML = kbEntries.map((entry, index) => {
                const name = typeof entry === 'string' ? entry : entry.name;
                return `
                    <div style="background: #3c3c3c; padding: 12px; border-radius: 6px; border-left: 3px solid #ff6b35; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; color: #ff6b35; font-size: 0.95em;">📚 ${name}</div>
                        </div>
                        <button onclick="deleteKBEntry(${index})" style="padding: 6px 12px; border-radius: 4px; border: none; background: rgba(244, 67, 54, 0.2); color: #ef5350; font-size: 0.85em; cursor: pointer; white-space: nowrap;">Delete</button>
                    </div>
                `;
            }).join('');
        }

        function toggleUseKB() {
            const toggle = document.getElementById('use-kb-toggle');
            useKB = !useKB;
            toggle.classList.toggle('on');
            localStorage.setItem('use_kb', useKB);
        }

        function getKBContent() {
            if (!useKB || kbEntries.length === 0) return '';
            const combined = kbEntries.map(entry => entry.content).join('\n\n---\n\n');
            return combined.substring(0, 2000);
        }

        loadSettings();

        async function loadModel() {
            if (activeProvider === 'lmstudio') {
                try {
                    const res = await fetch('http://localhost:8000/api/models');
                    const data = await res.json();
                    if (data?.data?.[0]?.id) {
                        activeModel = data.data[0].id;
                    }
                } catch (e) {
                    // Silent fail for unavailable backend
                }
            }
            updateModelIndicator();
        }

        loadModel();

        function setGoal(newGoal, btn) {
            goal = newGoal;
            document.querySelectorAll('.goal-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        function setSource(newSource, btn) {
            source = newSource;
            document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        async function generateMealPlan() {
            const likes = document.getElementById('likes').value.trim();
            const hates = document.getElementById('hates').value.trim();
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const btn = document.getElementById('generateBtn');
            const controlMessages = document.querySelector('.control-messages');

            if (!goal) {
                error.textContent = 'Please select a goal (Cut, Maintain, or Gain)';
                controlMessages.style.display = 'block';
                error.style.display = 'block';
                return;
            }

            if (!likes && !hates) {
                error.textContent = 'Enter at least some food preferences';
                controlMessages.style.display = 'block';
                error.style.display = 'block';
                return;
            }

            controlMessages.style.display = 'block';
            error.style.display = 'none';
            loading.style.display = 'block';
            btn.disabled = true;

            try {
                let additionalContext = '';
                // Query knowledge base if enabled
                if (useKB) {
                    const queryResponse = await fetch('http://localhost:8000/api/knowledge/query', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: `${likes} ${hates} ${goal}`
                        })
                    });
                    if (queryResponse.ok) {
                        const queryData = await queryResponse.json();
                        additionalContext = queryData.context || '';
                    }
                }
                
                let parsedData;
                
                if (source === 'aiChef') {
                    parsedData = await generateWithAIChef(likes, hates, additionalContext);
                } else if (source === 'spoonacular') {
                    parsedData = await generateWithSpoonacular(likes, hates);
                } else if (source === 'themealdb') {
                    parsedData = await generateWithTheMealDB(likes, hates);
                }

                if (!parsedData || !parsedData.days || parsedData.days.length === 0) {
                    throw new Error('Invalid meal plan structure');
                }

                daysData = parsedData.days;
                
                renderMealPlan(daysData);
                updateRightPanel(daysData);
                controlMessages.style.display = 'none';
            } catch (err) {
                error.textContent = 'Error: ' + (err.message || 'Failed to generate meal plan');
                error.style.display = 'block';
            } finally {
                loading.style.display = 'none';
                btn.disabled = false;
            }
        }

        async function generateWithAIChef(likes, hates, additionalContext = '') {
            // Route to the appropriate AI provider
            if (activeProvider === 'claude') {
                return generateWithClaude(likes, hates, additionalContext);
            } else if (activeProvider === 'openai') {
                return generateWithOpenAI(likes, hates, additionalContext);
            } else if (activeProvider === 'ollama') {
                return generateWithOllama(likes, hates, additionalContext);
            } else {
                // Default to LM Studio
                return generateWithLMStudio(likes, hates, additionalContext);
            }
        }

        function getSystemPrompt(additionalContext = '') {
            let prompt = 'Return ONLY raw JSON. No markdown. No backticks. No code blocks. No comments like "repeat for days". Write out ALL 7 days fully and completely. Format: {"days":[{"day":1,"breakfast":{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]},"lunch":{same},"dinner":{same}}]}';
            
            if (additionalContext) {
                prompt = 'KNOWLEDGE BASE:\n' + additionalContext + '\n\n---\n\n' + prompt;
            }
            return prompt;
        }

        async function generateWithLMStudio(likes, hates, additionalContext = '') {
            const response = await fetch('http://localhost:8000/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'lmstudio',
                    model: activeModel,
                    api_key: '',
                    messages: [
                        {
                            role: 'system',
                            content: getSystemPrompt(additionalContext)
                        },
                        {
                            role: 'user',
                            content: `Goal: ${goal}. Likes: ${likes || 'any'}. Avoids: ${hates || 'none'}. Generate 7-day meal plan with exact JSON structure requested.`
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 4000
                })
            });

            if (!response.ok) throw new Error('LM Studio API error');

            const data = await response.json();
            const result = data?.choices?.[0]?.message?.content;
            if (!result) throw new Error('No content from LM Studio');

            return parseJSONResponse(result);
        }

        async function generateWithClaude(likes, hates, additionalContext = '') {
            if (!claudeApiKey) throw new Error('Add your Claude API key in Settings.');

            let userPrompt = `You are a meal planner. Return ONLY raw JSON. No markdown. No backticks. No code blocks.
Format: {"days":[{"day":1,"breakfast":{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]},"lunch":{same},"dinner":{same}}]}
Goal: ${goal}. Likes: ${likes || 'any'}. Avoids: ${hates || 'none'}. Generate 7-day meal plan.`;
            
            if (additionalContext) {
                userPrompt = 'KNOWLEDGE BASE:\n' + additionalContext + '\n\n---\n\n' + userPrompt;
            }

            const response = await fetch('http://localhost:8000/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'claude',
                    model: claudeModel,
                    api_key: claudeApiKey,
                    messages: [
                        {
                            role: 'user',
                            content: userPrompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 4000
                })
            });

            if (!response.ok) throw new Error('Claude API error');

            const data = await response.json();
            const result = data?.content?.[0]?.text;
            if (!result) throw new Error('No content from Claude');

            return parseJSONResponse(result);
        }

        async function generateWithOpenAI(likes, hates, additionalContext = '') {
            if (!openaiApiKey) throw new Error('Add your OpenAI API key in Settings.');

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
                            content: getSystemPrompt(additionalContext)
                        },
                        {
                            role: 'user',
                            content: `Goal: ${goal}. Likes: ${likes || 'any'}. Avoids: ${hates || 'none'}. Generate 7-day meal plan with exact JSON structure requested.`
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 4000
                })
            });

            if (!response.ok) throw new Error('OpenAI API error');

            const data = await response.json();
            const result = data?.choices?.[0]?.message?.content;
            if (!result) throw new Error('No content from OpenAI');

            return parseJSONResponse(result);
        }

        async function generateWithOllama(likes, hates, additionalContext = '') {
            let prompt = `You are a meal planner. Return ONLY raw JSON. No markdown. No backticks.
Format: {"days":[{"day":1,"breakfast":{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]},"lunch":{same},"dinner":{same}}]}
Goal: ${goal}. Likes: ${likes || 'any'}. Avoids: ${hates || 'none'}. Generate 7-day meal plan.`;
            
            if (additionalContext) {
                prompt = 'KNOWLEDGE BASE:\n' + additionalContext + '\n\n---\n\n' + prompt;
            }

            const response = await fetch('http://localhost:8000/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'ollama',
                    model: 'neural-chat',
                    api_key: '',
                    prompt: prompt
                })
            });

            if (!response.ok) throw new Error('Ollama API error');

            const data = await response.json();
            const result = data?.response;
            if (!result) throw new Error('No content from Ollama');

            return parseJSONResponse(result);
        }

        function parseJSONResponse(result) {
            try {
                let raw = result.trim();
                raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
                const start = raw.indexOf('{');
                const end = raw.lastIndexOf('}');
                if (start === -1 || end === -1) throw new Error('No JSON object found');
                raw = raw.substring(start, end + 1);
                raw = raw.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
                const parsedData = JSON.parse(raw);
                return parsedData;
            } catch (parseErr) {
                throw new Error('AI returned invalid JSON: ' + parseErr.message);
            }
        }

        async function generateWithSpoonacular(likes, hates) {
            // Build complex search query
            const likesList = (likes || '').split(',').map(s => s.trim()).filter(s => s);
            const hatesList = (hates || '').split(',').map(s => s.trim()).filter(s => s);
            
            const query = likesList.length > 0 ? likesList[0] : 'chicken';
            const excludeIngredients = hatesList.join(',');
            
            const response = await fetch('http://localhost:8000/api/recipes/spoonacular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: spoonacularApiKey,
                    query: query,
                    number: 21,
                    excludeIngredients: excludeIngredients
                })
            });
            if (!response.ok) throw new Error('Spoonacular API error');

            const data = await response.json();
            if (!data.results || data.results.length === 0) {
                throw new Error('No recipes found from Spoonacular');
            }

            return structureSpoonacularData(data.results);
        }

        function structureSpoonacularData(recipes) {
            const recipesPerMeal = Math.ceil(recipes.length / 21); // 7 days * 3 meals
            const days = [];

            let recipeIndex = 0;
            for (let day = 1; day <= 7; day++) {
                const dayObj = { day };
                ['breakfast', 'lunch', 'dinner'].forEach(meal => {
                    if (recipeIndex < recipes.length) {
                        const recipe = recipes[recipeIndex];
                        dayObj[meal] = {
                            name: recipe.title || 'Recipe',
                            time_minutes: recipe.readyInMinutes || 30,
                            nutrition: {
                                calories: Math.round((recipe.nutrition?.nutrients?.find(n => n.name === 'Calories')?.amount || 0) / (recipe.servings || 1)),
                                protein_g: Math.round((recipe.nutrition?.nutrients?.find(n => n.name === 'Protein')?.amount || 0) / (recipe.servings || 1)),
                                carbs_g: Math.round((recipe.nutrition?.nutrients?.find(n => n.name === 'Carbohydrates')?.amount || 0) / (recipe.servings || 1)),
                                fat_g: Math.round((recipe.nutrition?.nutrients?.find(n => n.name === 'Fat')?.amount || 0) / (recipe.servings || 1))
                            },
                            ingredients: (recipe.extendedIngredients || []).map(ing => `${ing.original}`),
                            steps: (recipe.analyzedInstructions?.[0]?.steps || []).map(s => s.step).slice(0, 10)
                        };
                        recipeIndex++;
                    }
                });
                days.push(dayObj);
            }

            return { days };
        }

        async function generateWithTheMealDB(likes, hates) {
            const likesList = (likes || '').split(',').map(s => s.trim()).filter(s => s);
            const query = likesList.length > 0 ? likesList[0] : 'Pasta';

            const response = await fetch('http://localhost:8000/api/recipes/themealdb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query
                })
            });
            if (!response.ok) throw new Error('The Meal DB API error');

            const data = await response.json();
            if (!data.meals || data.meals.length === 0) {
                throw new Error('No meals found. Try different search terms.');
            }

            return structureMealDBData(data.meals);
        }

        function structureMealDBData(meals) {
            const days = [];
            let mealIndex = 0;

            for (let day = 1; day <= 7; day++) {
                const dayObj = { day };
                ['breakfast', 'lunch', 'dinner'].forEach(meal => {
                    if (mealIndex < meals.length) {
                        const recipe = meals[mealIndex];
                        
                        // Extract ingredients
                        const ingredients = [];
                        for (let i = 1; i <= 20; i++) {
                            const ing = recipe[`strIngredient${i}`];
                            const measure = recipe[`strMeasure${i}`];
                            if (ing && ing.trim()) {
                                ingredients.push(`${measure || ''} ${ing}`.trim());
                            }
                        }

                        // Extract steps
                        const steps = (recipe.strInstructions || '').split('.')
                            .map(s => s.trim())
                            .filter(s => s.length > 10)
                            .slice(0, 10);

                        dayObj[meal] = {
                            name: recipe.strMeal || 'Recipe',
                            time_minutes: 30,
                            nutrition: {
                                calories: 2000,
                                protein_g: 50,
                                carbs_g: 250,
                                fat_g: 65
                            },
                            ingredients,
                            steps
                        };
                        mealIndex++;
                    }
                });
                days.push(dayObj);
            }

            return { days };
        }

        function renderMealPlan(days) {
            document.getElementById('mealPlanContainer').classList.add('active');
            const daysPanel = document.getElementById('daysPanel');
            daysPanel.innerHTML = '';
            
            mealIndexCounter = 0; // Reset meal index counter

            days.forEach((dayData, dayIndex) => {
                const dayCard = createDayCard(dayData, dayIndex);
                daysPanel.appendChild(dayCard);
            });

            // Expand first day by default
            if (daysPanel.children.length > 0) {
                const firstHeader = daysPanel.children[0].querySelector('.day-card-header');
                toggleDayCard(daysPanel.children[0]);
            }
            
            // Fetch USDA nutrition data in parallel if auto-fetch is enabled
            if (autoFetchUSDA) {
                fetchUSDANutrition(days);
            }
        }

        async function fetchUSDANutrition(days) {
            // Show "Updating nutrition data..." message
            const nutritionUpdate = document.getElementById('nutritionUpdate');
            nutritionUpdate.style.display = 'block';

            // Create array of all meals with their index
            const allMeals = [];
            let mealIndex = 0;
            days.forEach(day => {
                ['breakfast', 'lunch', 'dinner'].forEach(mealType => {
                    if (day[mealType]) {
                        allMeals.push({
                            mealIndex,
                            mealData: day[mealType]
                        });
                        mealIndex++;
                    }
                });
            });

            // Create array of fetch promises - run all 21 in parallel
            const fetchPromises = allMeals.map(async (meal) => {
                return fetchUSDACaloriesForMeal(meal.mealIndex, meal.mealData);
            });

            // Wait for all fetches to complete
            try {
                await Promise.all(fetchPromises);
            } catch (err) {
                console.error('Error fetching USDA nutrition data:', err);
            } finally {
                // Hide the "Updating nutrition data..." message
                nutritionUpdate.style.display = 'none';
            }
        }

        async function fetchUSDACaloriesForMeal(mealIndex, mealData) {
            try {
                if (!mealData.ingredients || mealData.ingredients.length === 0) {
                    return;
                }

                // Get the first ingredient
                const firstIngredient = mealData.ingredients[0];
                // Extract just the ingredient name (remove quantities like "1 ", "2 tbsp", etc.)
                const ingredientName = firstIngredient.replace(/^\d+(\s+|-)?[a-z]*\.?\s*/i, '').split(/\s+/)[0];

                // Fetch from backend which calls USDA API
                const response = await fetch('http://localhost:8000/api/nutrition/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: ingredientName,
                        api_key: usdaApiKey
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.foods && data.foods.length > 0) {
                        const food = data.foods[0];
                        const energyNutrient = food.foodNutrients?.find(n =>
                            n.nutrientName === 'Energy' && n.unitName === 'kcal'
                        );

                        if (energyNutrient && energyNutrient.value) {
                            const calorieValue = Math.round(energyNutrient.value);
                            // Update the calorie badge in the DOM
                            updateMealCalorieBadge(mealIndex, calorieValue);
                        }
                    }
                }
            } catch (err) {
                // Silently fail - keep the AI estimated value
                console.error(`Failed to fetch USDA data for meal ${mealIndex}:`, err);
            }
        }

        function updateMealCalorieBadge(mealIndex, calorieValue) {
            // Find the meal accordion with data-meal-index matching mealIndex
            const mealAccordion = document.querySelector(`[data-meal-index="${mealIndex}"]`);
            if (!mealAccordion) {
                return;
            }

            // Find the calorie badge (the first nutrition badge which is calories/yellow)
            const calorieBadge = mealAccordion.querySelector('.badge-yellow .badge-value');
            if (calorieBadge) {
                // Update the calorie value (keep the "kcal" unit)
                calorieBadge.innerHTML = `${calorieValue}<span style="font-size: 0.8em; margin-left: 2px;">kcal</span>`;
            }
        }

        function createDayCard(dayData, dayIndex) {
            const card = document.createElement('div');
            card.className = 'day-card';
            card.dataset.dayIndex = dayIndex;

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'day-card-header';
            header.setAttribute('aria-expanded', 'false');
            const headerLabel = document.createTextNode(`Day ${dayData.day}`);
            header.appendChild(headerLabel);
            const arrow = document.createElement('span');
            arrow.className = 'day-arrow';
            arrow.textContent = '▾';
            header.appendChild(arrow);

            header.addEventListener('click', () => toggleDayCard(card));
            header.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleDayCard(card);
                }
            });

            const content = document.createElement('div');
            content.className = 'day-card-content';

            const body = document.createElement('div');
            body.className = 'day-card-body';

            // Create meal accordions
            ['breakfast', 'lunch', 'dinner'].forEach(mealType => {
                const meal = dayData[mealType];
                if (meal) {
                    const mealAccordion = createMealAccordion(meal, mealType, mealIndexCounter);
                    mealIndexCounter++;
                    body.appendChild(mealAccordion);
                }
            });

            content.appendChild(body);
            card.appendChild(header);
            card.appendChild(content);

            return card;
        }

        function createMealAccordion(meal, mealType, mealIndex) {
            const accordion = document.createElement('div');
            accordion.className = 'meal-accordion';
            accordion.dataset.mealIndex = mealIndex;

            const mealTypeLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'meal-accordion-header';
            header.setAttribute('aria-expanded', 'false');
            const headerLabel = document.createTextNode(`${mealTypeLabel}: ${meal.name}`);
            header.appendChild(headerLabel);
            const arrow = document.createElement('span');
            arrow.className = 'meal-accordion-arrow';
            arrow.textContent = '▾';
            header.appendChild(arrow);

            header.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMealAccordion(accordion);
            });
            header.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleMealAccordion(accordion);
                }
            });

            const content = document.createElement('div');
            content.className = 'meal-accordion-content';

            const body = document.createElement('div');
            body.className = 'meal-accordion-body';

            // Meal name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'meal-name';
            nameDiv.textContent = meal.name;
            body.appendChild(nameDiv);

            // Time
            const timeDiv = document.createElement('div');
            timeDiv.className = 'meal-time';
            timeDiv.innerHTML = `⏱️ ${meal.time_minutes || 30} minutes`;
            body.appendChild(timeDiv);

            // Nutrition Badges with fixed colors
            if (meal.nutrition) {
                const nutritionSection = document.createElement('div');
                nutritionSection.className = 'nutrition-section';
                
                const nutritionItems = [
                    { label: 'Calories', key: 'calories', value: meal.nutrition.calories, unit: 'kcal', badgeClass: 'badge-yellow' },
                    { label: 'Protein', key: 'protein_g', value: meal.nutrition.protein_g, unit: 'g', badgeClass: 'badge-green' },
                    { label: 'Carbs', key: 'carbs_g', value: meal.nutrition.carbs_g, unit: 'g', badgeClass: 'badge-orange' },
                    { label: 'Fat', key: 'fat_g', value: meal.nutrition.fat_g, unit: 'g', badgeClass: 'badge-red' }
                ];
                
                nutritionItems.forEach(item => {
                    const badge = document.createElement('div');
                    badge.className = `nutrition-badge ${item.badgeClass}`;
                    badge.innerHTML = `
                        <div class="badge-label">${item.label}</div>
                        <div class="badge-value">${Math.round(item.value)}<span style="font-size: 0.8em; margin-left: 2px;">${item.unit}</span></div>
                    `;
                    nutritionSection.appendChild(badge);
                });
                
                body.appendChild(nutritionSection);
            }

            // Ingredients
            if (meal.ingredients && meal.ingredients.length > 0) {
                const ingredientsSection = document.createElement('div');
                ingredientsSection.className = 'ingredients-section';

                const ingredientsLabel = document.createElement('div');
                ingredientsLabel.className = 'section-label';
                ingredientsLabel.textContent = 'Ingredients';
                ingredientsSection.appendChild(ingredientsLabel);

                const ingredientsList = document.createElement('div');
                ingredientsList.className = 'ingredients-list';
                meal.ingredients.forEach(ing => {
                    const item = document.createElement('div');
                    item.className = 'ingredient-item';
                    item.textContent = ing;
                    ingredientsList.appendChild(item);
                });
                ingredientsSection.appendChild(ingredientsList);
                body.appendChild(ingredientsSection);
            }

            // Steps
            if (meal.steps && meal.steps.length > 0) {
                const stepsSection = document.createElement('div');
                stepsSection.className = 'instructions-section';

                const stepsLabel = document.createElement('div');
                stepsLabel.className = 'section-label';
                stepsLabel.textContent = 'Steps';
                stepsSection.appendChild(stepsLabel);

                const stepsList = document.createElement('ol');
                stepsList.className = 'instructions-list';
                meal.steps.forEach(step => {
                    const item = document.createElement('li');
                    item.className = 'instruction-item';
                    item.textContent = step;
                    stepsList.appendChild(item);
                });
                stepsSection.appendChild(stepsList);
                body.appendChild(stepsSection);
            }

            content.appendChild(body);
            accordion.appendChild(header);
            accordion.appendChild(content);

            return accordion;
        }

        function toggleDayCard(card) {
            const header = card.querySelector('.day-card-header');
            const content = card.querySelector('.day-card-content');
            const isExpanded = header.classList.toggle('expanded');
            content.classList.toggle('expanded');
            header.setAttribute('aria-expanded', String(isExpanded));
        }

        function toggleMealAccordion(accordion) {
            const header = accordion.querySelector('.meal-accordion-header');
            const content = accordion.querySelector('.meal-accordion-content');
            const isExpanded = header.classList.toggle('expanded');
            content.classList.toggle('expanded');
            header.setAttribute('aria-expanded', String(isExpanded));
        }

        function updateRightPanel(days) {
            const rightPanel = document.getElementById('rightPanel');
            rightPanel.innerHTML = '';

            // Extract all unique ingredients for grocery list
            const allIngredients = [];
            days.forEach(day => {
                ['breakfast', 'lunch', 'dinner'].forEach(mealType => {
                    const meal = day[mealType];
                    if (meal && meal.ingredients) {
                        allIngredients.push(...meal.ingredients);
                    }
                });
            });

            // Parse ingredients to extract quantity and category
            const groceryItems = parseGroceryItems(allIngredients);

            // Group by category
            const grouped = {};
            groceryItems.forEach(item => {
                const category = item.category || 'Other';
                if (!grouped[category]) grouped[category] = [];
                grouped[category].push(item);
            });

            // Grocery List Title
            const titleDiv = document.createElement('div');
            titleDiv.className = 'panel-title';
            titleDiv.textContent = '🛒 Grocery List';
            rightPanel.appendChild(titleDiv);

            // Grocery List Section
            const sortedCategories = Object.keys(grouped).sort();
            sortedCategories.forEach(category => {
                const categoryDiv = document.createElement('div');
                categoryDiv.className = 'grocery-category';

                const categoryLabel = document.createElement('div');
                categoryLabel.className = 'category-label';
                categoryLabel.textContent = category;
                categoryDiv.appendChild(categoryLabel);

                grouped[category].forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'grocery-item';
                    
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'grocery-checkbox';
                    checkbox.addEventListener('change', (e) => {
                        e.target.parentElement.classList.toggle('checked');
                    });

                    const text = document.createElement('span');
                    text.className = 'grocery-item-text';
                    text.textContent = item.name;

                    itemDiv.appendChild(checkbox);
                    itemDiv.appendChild(text);
                    categoryDiv.appendChild(itemDiv);
                });

                rightPanel.appendChild(categoryDiv);
            });
        }

        function parseGroceryItems(ingredients) {
            const items = [];
            const categories = {
                'chicken': 'Proteins', 'beef': 'Proteins', 'pork': 'Proteins', 'fish': 'Proteins', 'salmon': 'Proteins', 'shrimp': 'Proteins', 'turkey': 'Proteins', 'egg': 'Proteins', 'tofu': 'Proteins', 'lamb': 'Proteins',
                'milk': 'Dairy', 'cheese': 'Dairy', 'yogurt': 'Dairy', 'butter': 'Dairy', 'cream': 'Dairy',
                'rice': 'Grains', 'pasta': 'Grains', 'bread': 'Grains', 'oat': 'Grains', 'flour': 'Grains', 'quinoa': 'Grains',
                'tomato': 'Produce', 'onion': 'Produce', 'garlic': 'Produce', 'lettuce': 'Produce', 'spinach': 'Produce', 'broccoli': 'Produce', 'carrot': 'Produce', 'apple': 'Produce', 'banana': 'Produce', 'lemon': 'Produce', 'lime': 'Produce', 'bell pepper': 'Produce', 'mushroom': 'Produce', 'potato': 'Produce', 'zucchini': 'Produce', 'cucumber': 'Produce', 'celery': 'Produce', 'kale': 'Produce', 'cabbage': 'Produce', 'avocado': 'Produce',
                'oil': 'Pantry', 'salt': 'Pantry', 'pepper': 'Pantry', 'spice': 'Pantry', 'sauce': 'Pantry', 'vinegar': 'Pantry', 'soy': 'Pantry', 'garlic': 'Pantry'
            };

            ingredients.forEach(ing => {
                if (!ing) return;
                let category = 'Other';
                const lowerIng = ing.toLowerCase();
                for (const [key, cat] of Object.entries(categories)) {
                    if (lowerIng.includes(key)) {
                        category = cat;
                        break;
                    }
                }
                items.push({ name: ing, category: category });
            });

            return items;
        }

        let logsRefreshInterval = null;

        async function fetchLogs() {
            try {
                const response = await fetch('http://localhost:8000/api/logs');
                const data = await response.json();
                displayLogs(data.logs || []);
            } catch (err) {
                console.error('Error fetching logs:', err);
                const logsPanel = document.getElementById('logsPanel');
                logsPanel.innerHTML = '<div style="color: #ef5350;">❌ Failed to fetch logs</div>';
            }
        }

        function displayLogs(logs) {
            const logsPanel = document.getElementById('logsPanel');
            
            if (!logs || logs.length === 0) {
                logsPanel.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No logs yet</div>';
                return;
            }

            // Reverse to show newest first
            const reversedLogs = [...logs].reverse();
            
            const logLines = reversedLogs.map(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return '';
                
                let color = '#ddd';
                let icon = '•';
                
                if (trimmedLine.includes('[ERROR]')) {
                    color = '#ef5350';
                    icon = '❌';
                } else if (trimmedLine.includes('[WARNING]')) {
                    color = '#fff59d';
                    icon = '⚠️';
                } else if (trimmedLine.includes('[INFO]')) {
                    color = '#81c784';
                    icon = 'ℹ️';
                }
                
                return `<div style="color: ${color};">${icon} ${trimmedLine}</div>`;
            }).join('');
            
            logsPanel.innerHTML = logLines || '<div style="color: #888;">No log lines</div>';
            logsPanel.scrollTop = logsPanel.scrollHeight;
        }

        async function refreshLogs() {
            await fetchLogs();
        }

        async function clearLogs() {
            if (!confirm('Are you sure you want to clear all logs?')) return;
            
            try {
                const response = await fetch('http://localhost:8000/api/logs', {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    const logsPanel = document.getElementById('logsPanel');
                    logsPanel.innerHTML = '<div style="color: #81c784; text-align: center; padding: 20px;">✅ Logs cleared</div>';
                    await fetchLogs();
                } else {
                    alert('Failed to clear logs');
                }
            } catch (err) {
                alert('Error clearing logs: ' + err.message);
            }
        }

        function startLogsAutoRefresh() {
            // Fetch logs immediately
            fetchLogs();
            
            // Then refresh every 5 seconds
            if (logsRefreshInterval) clearInterval(logsRefreshInterval);
            logsRefreshInterval = setInterval(fetchLogs, 5000);
        }

        function stopLogsAutoRefresh() {
            if (logsRefreshInterval) {
                clearInterval(logsRefreshInterval);
                logsRefreshInterval = null;
            }
        }

        // Hook into settings tab switching to start/stop auto-refresh
        const originalSwitchSettingsTab = window.switchSettingsTab;
        window.switchSettingsTab = function(tabName) {
            if (tabName === 'logs') {
                startLogsAutoRefresh();
            } else {
                stopLogsAutoRefresh();
            }
            originalSwitchSettingsTab(tabName);
        };
    
