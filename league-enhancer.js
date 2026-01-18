(function(){
2  'use strict';
3  
4  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
5  let isEnhancing = false;
6  let lastEnhancedUrl = '';
7  
8  // Detect if on mobile
9  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
10  
11  async function enhanceLeagueStats() {
12    if (!location.href.includes('league_instance')) return;
13    if (isEnhancing) return;
14    
15    const currentUrl = location.href;
16    if (currentUrl === lastEnhancedUrl) return;
17    
18    isEnhancing = true;
19    console.log('Stats Enhancer: Starting on-demand enhancement (Mobile: ' + isMobile + ')');
20    
21    const seasonMatch = location.href.match(/subseason=(\d+)/);
22    if (!seasonMatch) {
23      isEnhancing = false;
24      return;
25    }
26    
27    const season = seasonMatch[1];
28    
29    console.log('Waiting for tables to load...');
30    await waitForTables();
31    console.log('Tables loaded');
32    
33    // Find all tables that need enhancement
34    const tables = [];
35    document.querySelectorAll('table').forEach(table => {
36      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
37      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
38        tables.push(table);
39      }
40    });
41    
42    // Filter out-of-state teams only from stats tables
43    tables.forEach(table => filterOutOfStateTeams(table));
44    
45    if (tables.length === 0) {
46      console.log('No tables found to enhance');
47      isEnhancing = false;
48      return;
49    }
50    
51    console.log(`Found ${tables.length} tables to enhance`);
52    
53    // Collect all unique team IDs from visible players
54    const teamIds = new Set();
55    tables.forEach(table => {
56      table.querySelectorAll('tbody tr').forEach(row => {
57        if (row.style.display === 'none') return; // Skip hidden out-of-state rows
58        
59        const teamCell = Array.from(row.querySelectorAll('td')).find(cell => 
60          cell.querySelector('a[href*="/page/show/"]')
61        );
62        
63        if (teamCell) {
64          const teamLink = teamCell.querySelector('a[href*="/page/show/"]');
65          const teamIdMatch = teamLink?.href?.match(/page\/show\/(\d+)/);
66          if (teamIdMatch) {
67            teamIds.add(teamIdMatch[1]);
68          }
69        }
70      });
71    });
72    
73    console.log(`Found ${teamIds.size} unique teams on this page`);
74    
75    if (teamIds.size === 0) {
76      console.log('No teams found');
77      isEnhancing = false;
78      return;
79    }
80    
81    // Show loading indicator
82    showLoadingIndicator(`Loading data for ${teamIds.size} teams...`);
83    
84    // Fetch roster data for only these teams
85    const playerData = {};
86    let loadedCount = 0;
87    let failedCount = 0;
88    
89    for (const teamId of teamIds) {
90      try {
91        const cacheKey = `team_${teamId}_${season}`;
92        let teamRoster = null;
93        
94        // Try cache first
95        const cached = localStorage.getItem(cacheKey);
96        if (cached) {
97          const parsedCache = JSON.parse(cached);
98          if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
99            teamRoster = parsedCache.data;
100            console.log(`Using cached data for team ${teamId}`);
101          }
102        }
103        
104        // Fetch if not cached
105        if (!teamRoster) {
106          console.log(`Fetching roster for team ${teamId}`);
107          teamRoster = await fetchTeamRoster(teamId, season);
108          
109          // Cache it
110          try {
111            localStorage.setItem(cacheKey, JSON.stringify({
112              data: teamRoster,
113              timestamp: Date.now()
114            }));
115          } catch (e) {
116            console.warn('Could not cache team data:', e.message);
117          }
118          
119          // Small delay between fetches to avoid overwhelming mobile connections
120          await new Promise(resolve => setTimeout(resolve, isMobile ? 150 : 50));
121        }
122        
123        Object.assign(playerData, teamRoster);
124        loadedCount++;
125        
126        // Update progress
127        if (loadedCount % 3 === 0 || loadedCount === teamIds.size) {
128          showLoadingIndicator(`Loading data... ${loadedCount}/${teamIds.size} teams`);
129        }
130      } catch (error) {
131        console.error(`Failed to fetch team ${teamId}:`, error.message);
132        failedCount++;
133      }
134    }
135    
136    hideLoadingIndicator();
137    
138    console.log(`Loaded ${loadedCount} teams, failed ${failedCount}, total ${Object.keys(playerData).length} players`);
139    
140    // Even if some teams failed, enhance with what we have
141    if (Object.keys(playerData).length > 0) {
142      tables.forEach(table => {
143        enhanceTable(table, playerData);
144      });
145      console.log(`Enhanced ${tables.length} tables`);
146    } else {
147      console.log('No player data available to enhance tables');
148      showErrorMessage('Could not load any team data');
149    }
150    
151    lastEnhancedUrl = currentUrl;
152    isEnhancing = false;
153  }
154  
155  function filterOutOfStateTeams(table) {
156    let hiddenCount = 0;
157    table.querySelectorAll('tbody tr').forEach(row => {
158      const cells = row.querySelectorAll('td');
159      if (cells.length === 0) return;
160      
161      let shouldHide = false;
162      cells.forEach(cell => {
163        const teamLink = cell.querySelector('a[href*="/page/show/"]');
164        if (teamLink) {
165          const teamName = teamLink.textContent.trim();
166          const fullTeamName = teamLink.getAttribute('title') || '';
167          
168          const outOfStateIndicators = [
169            '(Wis.)', '(N.D.)', '(Ontario)', 
170            'Wisconsin', 'North Dakota', 'Canada'
171          ];
172          
173          const isOutOfState = outOfStateIndicators.some(indicator => 
174            teamName.includes(indicator) || fullTeamName.includes(indicator)
175          );
176          
177          if (isOutOfState) {
178            shouldHide = true;
179          }
180        }
181      });
182      
183      if (shouldHide) {
184        row.style.display = 'none';
185        hiddenCount++;
186      }
187    });
188    if (hiddenCount > 0) {
189      console.log(`Filtered out ${hiddenCount} out-of-state team rows from stats table`);
190    }
191  }
192  
193  async function waitForTables() {
194    let attempts = 0;
195    const maxAttempts = 40;
196    
197    while (attempts < maxAttempts) {
198      const tables = document.querySelectorAll('table');
199      let hasPlayerLinks = false;
200      let linkCount = 0;
201      
202      tables.forEach(table => {
203        const rows = table.querySelectorAll('tbody tr');
204        rows.forEach(row => {
205          const nameCell = row.querySelector('td a[href*="roster_players"]');
206          if (nameCell) {
207            hasPlayerLinks = true;
208            linkCount++;
209          }
210        });
211      });
212      
213      if (hasPlayerLinks && linkCount >= 10) {
214        console.log(`Found ${linkCount} player links, waiting 800ms more...`);
215        await new Promise(resolve => setTimeout(resolve, 800));
216        return;
217      }
218      
219      await new Promise(resolve => setTimeout(resolve, 150));
220      attempts++;
221    }
222    console.log('Timed out waiting for tables');
223  }
224  
225  function showLoadingIndicator(message) {
226    let indicator = document.getElementById('roster-loading-indicator');
227    
228    if (!indicator) {
229      indicator = document.createElement('div');
230      indicator.id = 'roster-loading-indicator';
231      indicator.style.cssText = `
232        position: fixed;
233        top: 20px;
234        ${isMobile ? 'left: 50%; transform: translateX(-50%);' : 'right: 20px;'}
235        background: #2c3e50;
236        color: white;
237        padding: ${isMobile ? '12px 20px' : '15px 25px'};
238        border-radius: 6px;
239        font-size: ${isMobile ? '13px' : '14px'};
240        font-weight: 600;
241        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
242        z-index: 99999;
243        max-width: ${isMobile ? '90%' : '300px'};
244      `;
245      
246      const style = document.createElement('style');
247      style.textContent = `
248        @keyframes spin {
249          0% { transform: rotate(0deg); }
250          100% { transform: rotate(360deg); }
251        }
252      `;
253      document.head.appendChild(style);
254      document.body.appendChild(indicator);
255    }
256    
257    const showSpinner = !message.includes('⚠️') && !message.includes('Could not');
258    indicator.innerHTML = `
259      <div style="display: flex; align-items: center; gap: 10px;">
260        ${showSpinner ? '<div style="width: 18px; height: 18px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; flex-shrink: 0;"></div>' : ''}
261        <span style="font-size: ${isMobile ? '12px' : '14px'};">${message}</span>
262      </div>
263    `;
264  }
265  
266  function showErrorMessage(message) {
267    showLoadingIndicator('⚠️ ' + message);
268    setTimeout(hideLoadingIndicator, 5000);
269  }
270  
271  function hideLoadingIndicator() {
272    const indicator = document.getElementById('roster-loading-indicator');
273    if (indicator) {
274      indicator.style.transition = 'opacity 0.3s';
275      indicator.style.opacity = '0';
276      setTimeout(() => indicator.remove(), 300);
277    }
278  }
279  
280  async function fetchTeamRoster(teamId, season) {
281    const url = `https://www.legacy.hockey/roster/show/${teamId}?subseason=${season}`;
282    
283    const controller = new AbortController();
284    const timeout = setTimeout(() => controller.abort(), isMobile ? 10000 : 5000);
285    
286    try {
287      const response = await fetch(url, { signal: controller.signal });
288      clearTimeout(timeout);
289      
290      if (!response.ok) {
291        throw new Error(`HTTP ${response.status}`);
292      }
293      
294      const html = await response.text();
295      const doc = new DOMParser().parseFromString(html, 'text/html');
296      const playerMap = {};
297      
298      // Extract team name from the page (school name only, no mascot)
299      let teamName = '';
300      const titleElement = doc.querySelector('h1.page-title, h1, .team-name');
301      if (titleElement) {
302        teamName = titleElement.textContent.trim();
303        // Remove "Roster" or year info if present
304        teamName = teamName.replace(/\s*Roster\s*/i, '').replace(/\s*\d{4}-\d{4}\s*/, '').trim();
305        
306        // Extract just the school name (first word or first two words before mascot)
307        // Common patterns: "Edina Hornets", "Minnetonka Skippers", "Eden Prairie Eagles"
308        // We want just "Edina", "Minnetonka", "Eden Prairie"
309        
310        // List of common mascot names to remove
311        const mascots = [
312          'Hornets', 'Skippers', 'Eagles', 'Hawks', 'Huskies', 'Panthers', 'Trojans',
313          'Crimson', 'Knights', 'Royals', 'Bengals', 'Cougars', 'Spartans', 'Wildcats',
314          'Tigers', 'Lions', 'Warriors', 'Saints', 'Rangers', 'Pirates', 'Bobcats',
315          'Jaguars', 'Mustangs', 'Bulldogs', 'Cardinals', 'Raiders', 'Grizzlies', 'Bears',
316          'Sabers', 'Sabres', 'Minutemen', 'Thunder', 'Storm', 'Lightning', 'Bolts',
317          'Greyhounds', 'Ponies', 'Flyers', 'Rovers', 'Orioles', 'Blue Jags', 'Blaze'
318        ];
319        
320        // Try to remove mascot name
321        for (const mascot of mascots) {
322          const regex = new RegExp('\\s+' + mascot + '\\b.*$', 'i');
323          if (regex.test(teamName)) {
324            teamName = teamName.replace(regex, '').trim();
325            break;
326          }
327        }
328        
329        // Also remove any grade/level indicators like "Bantam AA", "Peewee A", etc.
330        teamName = teamName.replace(/\s+(Bantam|Peewee|Squirt|Midget|U\d+|Varsity|JV)\s+[A-Z]+\s*$/i, '').trim();
331        teamName = teamName.replace(/\s+(Bantam|Peewee|Squirt|Midget|U\d+|Varsity|JV)\s*$/i, '').trim();
332      }
333      
334      doc.querySelectorAll('table tbody tr').forEach(row => {
335        const cells = row.querySelectorAll('td');
336        if (cells.length >= 5) {
337          const number = cells[0]?.textContent?.trim();
338          const nameLink = cells[2]?.querySelector('a');
339          const playerIdMatch = nameLink?.href?.match(/roster_players\/(\d+)/);
340          const position = cells[3]?.textContent?.trim();
341          const grade = cells[4]?.textContent?.trim();
342          
343          if (playerIdMatch && number !== 'MGR') {
344            playerMap[playerIdMatch[1]] = {
345              number: number,
346              position: position || '',
347              grade: grade || '',
348              teamName: teamName,
349              teamId: teamId
350            };
351          }
352        }
353      });
354      
355      return playerMap;
356    } catch (error) {
357      clearTimeout(timeout);
358      if (error.name === 'AbortError') {
359        throw new Error('Request timeout');
360      }
361      throw error;
362    }
363  }
364  
365  function enhanceTable(table, playerData) {
366    const headerRow = table.querySelector('thead tr');
367    const bodyRows = table.querySelectorAll('tbody tr');
368    
369    if (!headerRow || bodyRows.length === 0) return;
370    
371    const headers = headerRow.querySelectorAll('th');
372    let nameIndex = -1;
373    let teamIndex = -1;
374    
375    headers.forEach((header, index) => {
376      const headerText = header.textContent.trim();
377      if (headerText === 'Name') {
378        nameIndex = index;
379      }
380      if (headerText === 'Team') {
381        teamIndex = index;
382      }
383    });
384    
385    if (nameIndex === -1) return;
386    
387    const headerTexts = Array.from(headers).map(h => h.textContent.trim());
388    if (headerTexts.includes('Pos') || headerTexts.includes('Grade')) {
389      console.log('Table already enhanced, skipping');
390      return;
391    }
392    
393    const sampleHeader = headers[0];
394    const isGoalieTable = headerTexts.includes('GAA') && headerTexts.includes('SV %');
395    console.log(`Enhancing ${isGoalieTable ? 'Goalie' : 'Skater'} table`);
396    
397    if (!isGoalieTable) {
398      const posHeader = document.createElement('th');
399      posHeader.textContent = 'Pos';
400      posHeader.className = sampleHeader.className;
401      posHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
402      posHeader.title = 'Sort by Position (sorts current page only)';
403      posHeader.onclick = () => sortTable(table, nameIndex + 1);
404      headers[nameIndex].after(posHeader);
405    }
406    
407    const gradeHeader = document.createElement('th');
408    gradeHeader.textContent = 'Grade';
409    gradeHeader.className = sampleHeader.className;
410    gradeHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
411    gradeHeader.title = 'Sort by Grade (sorts current page only)';
412    const gradeColumnIndex = isGoalieTable ? nameIndex + 1 : nameIndex + 2;
413    gradeHeader.onclick = () => sortTable(table, gradeColumnIndex);
414    
415    if (isGoalieTable) {
416      headers[nameIndex].after(gradeHeader);
417    } else {
418      const posHeader = headers[nameIndex].nextElementSibling;
419      posHeader.after(gradeHeader);
420    }
421    
422    let matchedCount = 0;
423    let teamNamesReplaced = 0;
424    
425    bodyRows.forEach(row => {
426      const cells = row.querySelectorAll('td');
427      if (cells.length === 0) return;
428      
429      const nameCell = cells[nameIndex];
430      const playerLink = nameCell?.querySelector('a');
431      const playerIdMatch = playerLink?.href?.match(/roster_players\/(\d+)/);
432      
433      let position = '';
434      let grade = '';
435      let teamName = '';
436      
437      if (playerIdMatch) {
438        const playerId = playerIdMatch[1];
439        const info = playerData[playerId];
440        if (info) {
441          position = info.position;
442          grade = info.grade;
443          teamName = info.teamName;
444          matchedCount++;
445        }
446      }
447      
448      // Replace team abbreviation with full name if we have it
449      if (teamIndex !== -1 && teamName) {
450        const teamCell = cells[teamIndex];
451        const teamLink = teamCell?.querySelector('a');
452        
453        if (teamLink) {
454          const currentText = teamLink.textContent.trim();
455          // Only replace if current text looks like an abbreviation (short)
456          if (currentText.length <= 10) {
457            // Truncate long team names
458            const maxLength = isMobile ? 20 : 30;
459            const displayName = teamName.length > maxLength 
460              ? teamName.substring(0, maxLength - 3) + '...'
461              : teamName;
462            
463            teamLink.textContent = displayName;
464            teamLink.title = teamName; // Show full name on hover
465            teamNamesReplaced++;
466          }
467        }
468      }
469      
470      if (!isGoalieTable) {
471        const posCell = document.createElement('td');
472        posCell.textContent = position;
473        posCell.className = cells[0].className;
474        posCell.style.cssText = 'text-align: center; font-weight: 600;';
475        cells[nameIndex].after(posCell);
476      }
477      
478      const gradeCell = document.createElement('td');
479      gradeCell.textContent = grade;
480      gradeCell.className = cells[0].className;
481      gradeCell.style.textAlign = 'center';
482      
483      if (isGoalieTable) {
484        cells[nameIndex].after(gradeCell);
485      } else {
486        const posCell = cells[nameIndex].nextElementSibling;
487        posCell.after(gradeCell);
488      }
489    });
490    
491    console.log(`Table enhanced (${isGoalieTable ? 'Goalie' : 'Skater'}): ${matchedCount}/${bodyRows.length} players matched, ${teamNamesReplaced} team names replaced`);
492  }
493  
494  function sortTable(table, columnIndex) {
495    const tbody = table.querySelector('tbody');
496    const rows = Array.from(tbody.querySelectorAll('tr'));
497    
498    const currentDir = table.dataset[`sort${columnIndex}`];
499    const direction = currentDir === 'asc' ? 'desc' : 'asc';
500    table.dataset[`sort${columnIndex}`] = direction;
501    
502    rows.sort((a, b) => {
503      const aVal = a.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
504      const bVal = b.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
505      
506      if (direction === 'asc') {
507        return aVal.localeCompare(bVal);
508      } else {
509        return bVal.localeCompare(aVal);
510      }
511    });
512    
513    rows.forEach(row => tbody.appendChild(row));
514  }
515  
516  function init() {
517    setTimeout(enhanceLeagueStats, 2000);
518  }
519  
520  if (document.readyState === 'loading') {
521    document.addEventListener('DOMContentLoaded', init);
522  } else {
523    init();
524  }
525  
526  const observer = new MutationObserver((mutations) => {
527    let shouldEnhance = false;
528    mutations.forEach(mutation => {
529      mutation.addedNodes.forEach(node => {
530        if (node.nodeType === 1) {
531          if (node.tagName === 'TABLE' || node.querySelector('table')) {
532            shouldEnhance = true;
533          }
534        }
535      });
536    });
537    
538    if (shouldEnhance && !isEnhancing) {
539      lastEnhancedUrl = '';
540      setTimeout(enhanceLeagueStats, 1500);
541    }
542  });
543  
544  observer.observe(document.body, {
545    childList: true,
546    subtree: true
547  });
548  
549})();
550
  'use strict';
  
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  let isEnhancing = false;
  let lastEnhancedUrl = '';
  
  // Detect if on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  async function enhanceLeagueStats() {
    if (!location.href.includes('league_instance')) return;
    if (isEnhancing) return;
    
    const currentUrl = location.href;
    if (currentUrl === lastEnhancedUrl) return;
    
    isEnhancing = true;
    console.log('Stats Enhancer: Starting on-demand enhancement (Mobile: ' + isMobile + ')');
    
    const seasonMatch = location.href.match(/subseason=(\d+)/);
    if (!seasonMatch) {
      isEnhancing = false;
      return;
    }
    
    const season = seasonMatch[1];
    
    console.log('Waiting for tables to load...');
    await waitForTables();
    console.log('Tables loaded');
    
    // Find all tables that need enhancement
    const tables = [];
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
        tables.push(table);
      }
    });
    
    // Filter out-of-state teams only from stats tables
    tables.forEach(table => filterOutOfStateTeams(table));
    
    if (tables.length === 0) {
      console.log('No tables found to enhance');
      isEnhancing = false;
      return;
    }
    
    console.log('Found ' + tables.length + ' tables to enhance');
    
    // Collect all unique team IDs from visible players
    const teamIds = new Set();
    tables.forEach(table => {
      table.querySelectorAll('tbody tr').forEach(row => {
        if (row.style.display === 'none') return; // Skip hidden out-of-state rows
        
        const teamCell = Array.from(row.querySelectorAll('td')).find(cell => 
          cell.querySelector('a[href*="/page/show/"]')
        );
        
        if (teamCell) {
          const teamLink = teamCell.querySelector('a[href*="/page/show/"]');
          const teamIdMatch = teamLink?.href?.match(/page\/show\/(\d+)/);
          if (teamIdMatch) {
            teamIds.add(teamIdMatch[1]);
          }
        }
      });
    });
    
    console.log('Found ' + teamIds.size + ' unique teams on this page');
    
    if (teamIds.size === 0) {
      console.log('No teams found');
      isEnhancing = false;
      return;
    }
    
    // Show loading indicator
    showLoadingIndicator('Loading data for ' + teamIds.size + ' teams...');
    
    // Fetch roster data for only these teams
    const playerData = {};
    let loadedCount = 0;
    let failedCount = 0;
    
    for (const teamId of teamIds) {
      try {
        const cacheKey = 'team_' + teamId + '_' + season;
        let teamRoster = null;
        
        // Try cache first
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
            teamRoster = parsedCache.data;
            console.log('Using cached data for team ' + teamId);
          }
        }
        
        // Fetch if not cached
        if (!teamRoster) {
          console.log('Fetching roster for team ' + teamId);
          teamRoster = await fetchTeamRoster(teamId, season);
          
          // Cache it
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              data: teamRoster,
              timestamp: Date.now()
            }));
          } catch (e) {
            console.warn('Could not cache team data:', e.message);
          }
          
          // Small delay between fetches to avoid overwhelming mobile connections
          await new Promise(resolve => setTimeout(resolve, isMobile ? 150 : 50));
        }
        
        Object.assign(playerData, teamRoster);
        loadedCount++;
        
        // Update progress
        if (loadedCount % 3 === 0 || loadedCount === teamIds.size) {
          showLoadingIndicator('Loading data... ' + loadedCount + '/' + teamIds.size + ' teams');
        }
      } catch (error) {
        console.error('Failed to fetch team ' + teamId + ':', error.message);
        failedCount++;
      }
    }
    
    hideLoadingIndicator();
    
    console.log('Loaded ' + loadedCount + ' teams, failed ' + failedCount + ', total ' + Object.keys(playerData).length + ' players');
    
    // Even if some teams failed, enhance with what we have
    if (Object.keys(playerData).length > 0) {
      tables.forEach(table => {
        enhanceTable(table, playerData);
      });
      console.log('Enhanced ' + tables.length + ' tables');
    } else {
      console.log('No player data available to enhance tables');
      showErrorMessage('Could not load any team data');
    }
    
    lastEnhancedUrl = currentUrl;
    isEnhancing = false;
  }
  
  function filterOutOfStateTeams(table) {
    let hiddenCount = 0;
    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
      let shouldHide = false;
      cells.forEach(cell => {
        const teamLink = cell.querySelector('a[href*="/page/show/"]');
        if (teamLink) {
          const teamName = teamLink.textContent.trim();
          const fullTeamName = teamLink.getAttribute('title') || '';
          
          const outOfStateIndicators = [
            '(Wis.)', '(N.D.)', '(Ontario)', 
            'Wisconsin', 'North Dakota', 'Canada'
          ];
          
          const isOutOfState = outOfStateIndicators.some(indicator => 
            teamName.includes(indicator) || fullTeamName.includes(indicator)
          );
          
          if (isOutOfState) {
            shouldHide = true;
          }
        }
      });
      
      if (shouldHide) {
        row.style.display = 'none';
        hiddenCount++;
      }
    });
    if (hiddenCount > 0) {
      console.log('Filtered out ' + hiddenCount + ' out-of-state team rows from stats table');
    }
  }
  
  async function waitForTables() {
    let attempts = 0;
    const maxAttempts = 40;
    
    while (attempts < maxAttempts) {
      const tables = document.querySelectorAll('table');
      let hasPlayerLinks = false;
      let linkCount = 0;
      
      tables.forEach(table => {
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
          const nameCell = row.querySelector('td a[href*="roster_players"]');
          if (nameCell) {
            hasPlayerLinks = true;
            linkCount++;
          }
        });
      });
      
      if (hasPlayerLinks && linkCount >= 10) {
        console.log('Found ' + linkCount + ' player links, waiting 800ms more...');
        await new Promise(resolve => setTimeout(resolve, 800));
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 150));
      attempts++;
    }
    console.log('Timed out waiting for tables');
  }
  
  function showLoadingIndicator(message) {
    let indicator = document.getElementById('roster-loading-indicator');
    
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'roster-loading-indicator';
      indicator.style.cssText = 'position: fixed;' +
        'top: 20px;' +
        (isMobile ? 'left: 50%; transform: translateX(-50%);' : 'right: 20px;') +
        'background: #2c3e50;' +
        'color: white;' +
        'padding: ' + (isMobile ? '12px 20px' : '15px 25px') + ';' +
        'border-radius: 6px;' +
        'font-size: ' + (isMobile ? '13px' : '14px') + ';' +
        'font-weight: 600;' +
        'box-shadow: 0 4px 12px rgba(0,0,0,0.3);' +
        'z-index: 99999;' +
        'max-width: ' + (isMobile ? '90%' : '300px') + ';';
      
      const style = document.createElement('style');
      style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
      document.head.appendChild(style);
      document.body.appendChild(indicator);
    }
    
    const showSpinner = message.indexOf('⚠️') === -1 && message.indexOf('Could not') === -1;
    indicator.innerHTML = '<div style="display: flex; align-items: center; gap: 10px;">' +
      (showSpinner ? '<div style="width: 18px; height: 18px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; flex-shrink: 0;"></div>' : '') +
      '<span style="font-size: ' + (isMobile ? '12px' : '14px') + ';">' + message + '</span>' +
      '</div>';
  }
  
  function showErrorMessage(message) {
    showLoadingIndicator('⚠️ ' + message);
    setTimeout(hideLoadingIndicator, 5000);
  }
  
  function hideLoadingIndicator() {
    const indicator = document.getElementById('roster-loading-indicator');
    if (indicator) {
      indicator.style.transition = 'opacity 0.3s';
      indicator.style.opacity = '0';
      setTimeout(function() { indicator.remove(); }, 300);
    }
  }
  
  async function fetchTeamRoster(teamId, season) {
    const url = 'https://www.legacy.hockey/roster/show/' + teamId + '?subseason=' + season;
    
    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, isMobile ? 10000 : 5000);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const playerMap = {};
      
      doc.querySelectorAll('table tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
          const number = cells[0]?.textContent?.trim();
          const nameLink = cells[2]?.querySelector('a');
          const playerIdMatch = nameLink?.href?.match(/roster_players\/(\d+)/);
          const position = cells[3]?.textContent?.trim();
          const grade = cells[4]?.textContent?.trim();
          
          if (playerIdMatch && number !== 'MGR') {
            playerMap[playerIdMatch[1]] = {
              number: number,
              position: position || '',
              grade: grade || ''
            };
          }
        }
      });
      
      return playerMap;
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }
  
  function enhanceTable(table, playerData) {
    const headerRow = table.querySelector('thead tr');
    const bodyRows = table.querySelectorAll('tbody tr');
    
    if (!headerRow || bodyRows.length === 0) return;
    
    const headers = headerRow.querySelectorAll('th');
    let nameIndex = -1;
    
    headers.forEach(function(header, index) {
      if (header.textContent.trim() === 'Name') {
        nameIndex = index;
      }
    });
    
    if (nameIndex === -1) return;
    
    const headerTexts = Array.from(headers).map(function(h) { return h.textContent.trim(); });
    if (headerTexts.includes('Pos') || headerTexts.includes('Grade')) {
      console.log('Table already enhanced, skipping');
      return;
    }
    
    const sampleHeader = headers[0];
    const isGoalieTable = headerTexts.includes('GAA') && headerTexts.includes('SV %');
    console.log('Enhancing ' + (isGoalieTable ? 'Goalie' : 'Skater') + ' table');
    
    if (!isGoalieTable) {
      const posHeader = document.createElement('th');
      posHeader.textContent = 'Pos';
      posHeader.className = sampleHeader.className;
      posHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
      posHeader.title = 'Sort by Position (sorts current page only)';
      posHeader.onclick = function() { sortTable(table, nameIndex + 1); };
      headers[nameIndex].after(posHeader);
    }
    
    const gradeHeader = document.createElement('th');
    gradeHeader.textContent = 'Grade';
    gradeHeader.className = sampleHeader.className;
    gradeHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
    gradeHeader.title = 'Sort by Grade (sorts current page only)';
    const gradeColumnIndex = isGoalieTable ? nameIndex + 1 : nameIndex + 2;
    gradeHeader.onclick = function() { sortTable(table, gradeColumnIndex); };
    
    if (isGoalieTable) {
      headers[nameIndex].after(gradeHeader);
    } else {
      const posHeader = headers[nameIndex].nextElementSibling;
      posHeader.after(gradeHeader);
    }
    
    let matchedCount = 0;
    bodyRows.forEach(function(row) {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
      const nameCell = cells[nameIndex];
      const playerLink = nameCell?.querySelector('a');
      const playerIdMatch = playerLink?.href?.match(/roster_players\/(\d+)/);
      
      let position = '';
      let grade = '';
      
      if (playerIdMatch) {
        const playerId = playerIdMatch[1];
        const info = playerData[playerId];
        if (info) {
          position = info.position;
          grade = info.grade;
          matchedCount++;
        }
      }
      
      if (!isGoalieTable) {
        const posCell = document.createElement('td');
        posCell.textContent = position;
        posCell.className = cells[0].className;
        posCell.style.cssText = 'text-align: center; font-weight: 600;';
        cells[nameIndex].after(posCell);
      }
      
      const gradeCell = document.createElement('td');
      gradeCell.textContent = grade;
      gradeCell.className = cells[0].className;
      gradeCell.style.textAlign = 'center';
      
      if (isGoalieTable) {
        cells[nameIndex].after(gradeCell);
      } else {
        const posCell = cells[nameIndex].nextElementSibling;
        posCell.after(gradeCell);
      }
    });
    
    console.log('Table enhanced (' + (isGoalieTable ? 'Goalie' : 'Skater') + '): ' + matchedCount + '/' + bodyRows.length + ' players matched');
  }
  
  function sortTable(table, columnIndex) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    const currentDir = table.dataset['sort' + columnIndex];
    const direction = currentDir === 'asc' ? 'desc' : 'asc';
    table.dataset['sort' + columnIndex] = direction;
    
    rows.sort(function(a, b) {
      const aVal = a.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
      const bVal = b.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
      
      if (direction === 'asc') {
        return aVal.localeCompare(bVal);
      } else {
        return bVal.localeCompare(aVal);
      }
    });
    
    rows.forEach(function(row) { tbody.appendChild(row); });
  }
  
  function init() {
    setTimeout(enhanceLeagueStats, 2000);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  const observer = new MutationObserver(function(mutations) {
    let shouldEnhance = false;
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          if (node.tagName === 'TABLE' || node.querySelector('table')) {
            shouldEnhance = true;
          }
        }
      });
    });
    
    if (shouldEnhance && !isEnhancing) {
      lastEnhancedUrl = '';
      setTimeout(enhanceLeagueStats, 1500);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
})();
