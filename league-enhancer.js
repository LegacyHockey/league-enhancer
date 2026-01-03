(function(){
2  'use strict';
3  
4  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
5  let allPlayerData = {};
6  let isEnhancing = false;
7  let lastEnhancedUrl = '';
8  
9  // All Minnesota conference page IDs (excluding Out of State)
10  const MN_CONFERENCES = [
11    '9113382', // Big 9
12    '9113405', // Big South
13    '9113424', // Central Lakes
14    '9113443', // Granite Ridge
15    '9113450', // IMAC
16    '9113459', // Independents
17    '9113474', // Iron Range
18    '9113483', // Lake
19    '9113496', // Lake Superior
20    '9113513', // Mariucci
21    '9113528', // Metro East
22    '9113545', // Metro West
23    '9113562', // Mississippi 8
24    '9113577', // Northwest
25    '9113586', // Northwest Suburban
26    '9113611', // South Suburban
27    '9113630', // Suburban East
28    '9113656', // Tri-Metro
29    '9113667', // West Central
30    '9113678'  // Wright County
31  ];
32  
33  // Detect if on mobile
34  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
35  
36  // Mobile-specific settings - even more conservative
37  const MOBILE_BATCH_SIZE = 2; // Process only 2 teams at once on mobile
38  const MOBILE_DELAY = 300; // Longer delays between requests on mobile
39  const MOBILE_TIMEOUT = 10000; // 10 second timeout for mobile requests
40  const MOBILE_CONF_BATCH = 3; // Process only 3 conferences at a time
41  
42  // Debug logging
43  function debugLog(message, data = null) {
44    const timestamp = new Date().toISOString().substr(11, 8);
45    console.log(`[${timestamp}] ${message}`, data || '');
46  }
47  
48  async function enhanceLeagueStats() {
49    if (!location.href.includes('league_instance')) return;
50    if (isEnhancing) return;
51    
52    const currentUrl = location.href;
53    if (currentUrl === lastEnhancedUrl) return;
54    
55    isEnhancing = true;
56    debugLog('Stats Enhancer: Starting enhancement', `Mobile: ${isMobile}`);
57    
58    const seasonMatch = location.href.match(/subseason=(\d+)/);
59    if (!seasonMatch) {
60      debugLog('No season found in URL');
61      isEnhancing = false;
62      return;
63    }
64    
65    const season = seasonMatch[1];
66    debugLog('Season detected', season);
67    
68    // Load data if not already loaded
69    if (Object.keys(allPlayerData).length === 0) {
70      const cacheKey = `league_mn_v3_${season}`;
71      debugLog('Checking cache', cacheKey);
72      
73      let cached;
74      try {
75        cached = localStorage.getItem(cacheKey);
76        debugLog('Cache retrieved', cached ? 'Found' : 'Not found');
77      } catch (e) {
78        debugLog('ERROR: Cannot access localStorage', e.message);
79        showErrorMessage('Storage error: ' + e.message);
80        isEnhancing = false;
81        return;
82      }
83      
84      if (cached) {
85        try {
86          const parsedCache = JSON.parse(cached);
87          const cacheAge = Date.now() - parsedCache.timestamp;
88          debugLog('Cache age (ms)', cacheAge);
89          
90          if (cacheAge < CACHE_DURATION) {
91            debugLog('Using cached data', `${Object.keys(parsedCache.data).length} players`);
92            allPlayerData = parsedCache.data;
93          } else {
94            debugLog('Cache expired, fetching fresh data');
95            showLoadingIndicator('Loading Minnesota team rosters...');
96            try {
97              allPlayerData = await fetchAllMNTeamRosters(season);
98              debugLog('Fresh data fetched', `${Object.keys(allPlayerData).length} players`);
99              localStorage.setItem(cacheKey, JSON.stringify({
100                data: allPlayerData,
101                timestamp: Date.now()
102              }));
103              hideLoadingIndicator();
104            } catch (error) {
105              debugLog('ERROR: Failed to fetch fresh data', error.message);
106              console.error('Full error:', error);
107              showErrorMessage('Could not load roster data. Using cached data.');
108              // Try to use expired cache rather than failing completely
109              if (parsedCache && parsedCache.data && Object.keys(parsedCache.data).length > 0) {
110                debugLog('Falling back to expired cache', `${Object.keys(parsedCache.data).length} players`);
111                allPlayerData = parsedCache.data;
112                hideLoadingIndicator();
113              } else {
114                debugLog('No valid cache to fall back to');
115                isEnhancing = false;
116                return;
117              }
118            }
119          }
120        } catch (e) {
121          debugLog('ERROR: Cache parse error', e.message);
122          console.error('Cache parse error:', e);
123          localStorage.removeItem(cacheKey);
124          showErrorMessage('Cache corrupted. Please refresh.');
125          isEnhancing = false;
126          return;
127        }
128      } else {
129        debugLog('No cache, fetching roster data');
130        showLoadingIndicator('Loading Minnesota team rosters...');
131        try {
132          allPlayerData = await fetchAllMNTeamRosters(season);
133          debugLog('Data fetched successfully', `${Object.keys(allPlayerData).length} players`);
134          
135          try {
136            localStorage.setItem(cacheKey, JSON.stringify({
137              data: allPlayerData,
138              timestamp: Date.now()
139            }));
140            debugLog('Data cached successfully');
141          } catch (storageError) {
142            debugLog('WARNING: Could not cache data', storageError.message);
143            // Continue anyway - we have the data
144          }
145          
146          hideLoadingIndicator();
147        } catch (error) {
148          debugLog('ERROR: Failed to fetch roster data', error.message);
149          console.error('Full fetch error:', error);
150          showErrorMessage('Failed to load roster data: ' + error.message);
151          isEnhancing = false;
152          return;
153        }
154      }
155    }
156    
157    if (Object.keys(allPlayerData).length === 0) {
158      debugLog('ERROR: No roster data available after all attempts');
159      isEnhancing = false;
160      return;
161    }
162    
163    debugLog('Waiting for tables to load...');
164    await waitForTables();
165    debugLog('Tables loaded, enhancing...');
166    
167    filterOutOfStateTeams();
168    
169    let enhanced = 0;
170    document.querySelectorAll('table').forEach(table => {
171      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
172      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
173        enhanceTable(table, allPlayerData);
174        enhanced++;
175      }
176    });
177    
178    debugLog(`Enhancement complete`, `${enhanced} tables enhanced`);
179    lastEnhancedUrl = currentUrl;
180    isEnhancing = false;
181  }
182  
183  function filterOutOfStateTeams() {
184    let hiddenCount = 0;
185    document.querySelectorAll('table tbody tr').forEach(row => {
186      const cells = row.querySelectorAll('td');
187      if (cells.length === 0) return;
188      
189      cells.forEach(cell => {
190        const teamLink = cell.querySelector('a[href*="/page/show/"]');
191        if (teamLink) {
192          const teamName = teamLink.textContent.trim();
193          const fullTeamName = teamLink.getAttribute('title') || '';
194          
195          const outOfStateIndicators = [
196            '(Wis.)', '(N.D.)', '(Ontario)', 
197            'Wisconsin', 'North Dakota', 'Canada'
198          ];
199          
200          const isOutOfState = outOfStateIndicators.some(indicator => 
201            teamName.includes(indicator) || fullTeamName.includes(indicator)
202          );
203          
204          if (isOutOfState) {
205            row.style.display = 'none';
206            hiddenCount++;
207          }
208        }
209      });
210    });
211    if (hiddenCount > 0) {
212      debugLog('Filtered out-of-state teams', `${hiddenCount} rows hidden`);
213    }
214  }
215  
216  async function waitForTables() {
217    let attempts = 0;
218    const maxAttempts = 40;
219    
220    while (attempts < maxAttempts) {
221      const tables = document.querySelectorAll('table');
222      let hasPlayerLinks = false;
223      let linkCount = 0;
224      
225      tables.forEach(table => {
226        const rows = table.querySelectorAll('tbody tr');
227        rows.forEach(row => {
228          const nameCell = row.querySelector('td a[href*="roster_players"]');
229          if (nameCell) {
230            hasPlayerLinks = true;
231            linkCount++;
232          }
233        });
234      });
235      
236      if (hasPlayerLinks && linkCount >= 10) {
237        debugLog('Tables ready', `${linkCount} player links found`);
238        await new Promise(resolve => setTimeout(resolve, 800));
239        return;
240      }
241      
242      await new Promise(resolve => setTimeout(resolve, 150));
243      attempts++;
244    }
245    debugLog('WARNING: Timed out waiting for tables');
246  }
247  
248  function showLoadingIndicator(message) {
249    let indicator = document.getElementById('roster-loading-indicator');
250    
251    if (!indicator) {
252      indicator = document.createElement('div');
253      indicator.id = 'roster-loading-indicator';
254      indicator.style.cssText = `
255        position: fixed;
256        top: 20px;
257        ${isMobile ? 'left: 50%; transform: translateX(-50%);' : 'right: 20px;'}
258        background: #2c3e50;
259        color: white;
260        padding: ${isMobile ? '12px 20px' : '15px 25px'};
261        border-radius: 6px;
262        font-size: ${isMobile ? '13px' : '14px'};
263        font-weight: 600;
264        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
265        z-index: 99999;
266        max-width: ${isMobile ? '90%' : '300px'};
267      `;
268      
269      const style = document.createElement('style');
270      style.textContent = `
271        @keyframes spin {
272          0% { transform: rotate(0deg); }
273          100% { transform: rotate(360deg); }
274        }
275      `;
276      document.head.appendChild(style);
277      document.body.appendChild(indicator);
278    }
279    
280    const showSpinner = !message.includes('⚠️') && !message.includes('Could not') && !message.includes('Failed');
281    indicator.innerHTML = `
282      <div style="display: flex; align-items: center; gap: 10px;">
283        ${showSpinner ? '<div style="width: 18px; height: 18px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; flex-shrink: 0;"></div>' : ''}
284        <span style="font-size: ${isMobile ? '12px' : '14px'};">${message}</span>
285      </div>
286    `;
287  }
288  
289  function showErrorMessage(message) {
290    showLoadingIndicator('⚠️ ' + message);
291    setTimeout(hideLoadingIndicator, 10000); // Show error longer
292  }
293  
294  function hideLoadingIndicator() {
295    const indicator = document.getElementById('roster-loading-indicator');
296    if (indicator) {
297      indicator.style.transition = 'opacity 0.3s';
298      indicator.style.opacity = '0';
299      setTimeout(() => indicator.remove(), 300);
300    }
301  }
302  
303  // Fetch with timeout wrapper
304  async function fetchWithTimeout(url, timeout = isMobile ? MOBILE_TIMEOUT : 5000) {
305    debugLog('Fetching URL', url);
306    const controller = new AbortController();
307    const timeoutId = setTimeout(() => {
308      debugLog('Request timeout', url);
309      controller.abort();
310    }, timeout);
311    
312    try {
313      const response = await fetch(url, { signal: controller.signal });
314      clearTimeout(timeoutId);
315      debugLog('Fetch success', `${url} - Status: ${response.status}`);
316      return response;
317    } catch (error) {
318      clearTimeout(timeoutId);
319      debugLog('Fetch error', `${url} - ${error.message}`);
320      if (error.name === 'AbortError') {
321        throw new Error(`Request timeout: ${url}`);
322      }
323      throw error;
324    }
325  }
326  
327  async function fetchAllMNTeamRosters(season) {
328    debugLog('Starting fetchAllMNTeamRosters', season);
329    const allTeamIds = new Set();
330    
331    // Fetch team IDs from each Minnesota conference
332    const batchSize = isMobile ? MOBILE_CONF_BATCH : 10;
333    debugLog('Conference batch size', batchSize);
334    
335    for (let i = 0; i < MN_CONFERENCES.length; i += batchSize) {
336      const batch = MN_CONFERENCES.slice(i, i + batchSize);
337      debugLog(`Processing conference batch ${i / batchSize + 1}`, `${batch.length} conferences`);
338      
339      // Process conferences in parallel batches
340      const results = await Promise.allSettled(batch.map(async (confId) => {
341        const url = `https://www.legacy.hockey/page/show/${confId}?subseason=${season}`;
342        
343        try {
344          const response = await fetchWithTimeout(url);
345          if (!response.ok) {
346            debugLog('Conference fetch failed', `${confId} - Status: ${response.status}`);
347            return { confId, teams: [] };
348          }
349          
350          const html = await response.text();
351          const doc = new DOMParser().parseFromString(html, 'text/html');
352          
353          const teamLinks = doc.querySelectorAll('a[href*="/page/show/"]');
354          const foundTeams = [];
355          
356          teamLinks.forEach(link => {
357            if (link.href.includes(`subseason=${season}`)) {
358              const match = link.href.match(/page\/show\/(\d+)/);
359              if (match && match[1] !== confId) {
360                foundTeams.push(match[1]);
361              }
362            }
363          });
364          
365          debugLog(`Conference ${confId} complete`, `${foundTeams.length} teams`);
366          return { confId, teams: foundTeams };
367        } catch (error) {
368          debugLog('Conference error', `${confId} - ${error.message}`);
369          return { confId, teams: [], error: error.message };
370        }
371      }));
372      
373      // Collect team IDs from results
374      results.forEach(result => {
375        if (result.status === 'fulfilled' && result.value.teams) {
376          result.value.teams.forEach(id => allTeamIds.add(id));
377        }
378      });
379      
380      const progress = Math.min(i + batchSize, MN_CONFERENCES.length);
381      showLoadingIndicator(`Scanning conferences... ${progress}/${MN_CONFERENCES.length}`);
382      
383      // Delay between batches
384      if (i + batchSize < MN_CONFERENCES.length) {
385        await new Promise(resolve => setTimeout(resolve, isMobile ? 200 : 50));
386      }
387    }
388    
389    debugLog('Conference scan complete', `${allTeamIds.size} teams found`);
390    
391    if (allTeamIds.size === 0) {
392      throw new Error('No teams found in conferences');
393    }
394    
395    showLoadingIndicator(`Found ${allTeamIds.size} teams. Loading rosters...`);
396    
397    // Fetch rosters with progress tracking
398    const allData = {};
399    const teamArray = Array.from(allTeamIds);
400    const teamBatchSize = isMobile ? MOBILE_BATCH_SIZE : 5;
401    let successCount = 0;
402    let errorCount = 0;
403    
404    debugLog('Starting roster fetch', `${teamArray.length} teams, batch size: ${teamBatchSize}`);
405    
406    for (let i = 0; i < teamArray.length; i += teamBatchSize) {
407      const batch = teamArray.slice(i, i + teamBatchSize);
408      debugLog(`Fetching roster batch ${Math.floor(i / teamBatchSize) + 1}`, `Teams: ${batch.join(', ')}`);
409      
410      // Process teams in parallel batches
411      const results = await Promise.allSettled(
412        batch.map(teamId => fetchTeamRoster(teamId, season))
413      );
414      
415      results.forEach((result, idx) => {
416        if (result.status === 'fulfilled' && result.value && Object.keys(result.value).length > 0) {
417          Object.assign(allData, result.value);
418          successCount++;
419          debugLog(`Team ${batch[idx]} success`, `${Object.keys(result.value).length} players`);
420        } else {
421          errorCount++;
422          const errorMsg = result.reason?.message || 'Unknown error';
423          debugLog(`Team ${batch[idx]} failed`, errorMsg);
424        }
425      });
426      
427      const progress = Math.min(i + teamBatchSize, teamArray.length);
428      showLoadingIndicator(`Loading rosters... ${progress}/${teamArray.length}`);
429      
430      // Delay between batches
431      if (i + teamBatchSize < teamArray.length) {
432        await new Promise(resolve => setTimeout(resolve, isMobile ? MOBILE_DELAY : 100));
433      }
434    }
435    
436    debugLog('Roster fetch complete', `Success: ${successCount}, Errors: ${errorCount}, Players: ${Object.keys(allData).length}`);
437    
438    // Accept partial data if we got at least 30% of teams (reduced threshold)
439    if (Object.keys(allData).length === 0) {
440      throw new Error('No roster data loaded - all requests failed');
441    }
442    
443    if (successCount < teamArray.length * 0.3) {
444      debugLog('WARNING: Low success rate', `Only ${successCount}/${teamArray.length} teams (${Math.round(successCount/teamArray.length*100)}%)`);
445    }
446    
447    return allData;
448  }
449  
450  async function fetchTeamRoster(teamId, season) {
451    const url = `https://www.legacy.hockey/roster/show/${teamId}?subseason=${season}`;
452    
453    const response = await fetchWithTimeout(url);
454    if (!response.ok) return {};
455    
456    const html = await response.text();
457    const doc = new DOMParser().parseFromString(html, 'text/html');
458    const playerMap = {};
459    
460    doc.querySelectorAll('table tbody tr').forEach(row => {
461      const cells = row.querySelectorAll('td');
462      if (cells.length >= 5) {
463        const number = cells[0]?.textContent?.trim();
464        const nameLink = cells[2]?.querySelector('a');
465        const playerIdMatch = nameLink?.href?.match(/roster_players\/(\d+)/);
466        const position = cells[3]?.textContent?.trim();
467        const grade = cells[4]?.textContent?.trim();
468        
469        if (playerIdMatch && number !== 'MGR') {
470          playerMap[playerIdMatch[1]] = {
471            number: number,
472            position: position || '',
473            grade: grade || ''
474          };
475        }
476      }
477    });
478    
479    return playerMap;
480  }
481  
482  function enhanceTable(table, playerData) {
483    const headerRow = table.querySelector('thead tr');
484    const bodyRows = table.querySelectorAll('tbody tr');
485    
486    if (!headerRow || bodyRows.length === 0) return;
487    
488    const headers = headerRow.querySelectorAll('th');
489    let nameIndex = -1;
490    
491    headers.forEach((header, index) => {
492      if (header.textContent.trim() === 'Name') {
493        nameIndex = index;
494      }
495    });
496    
497    if (nameIndex === -1) return;
498    
499    const headerTexts = Array.from(headers).map(h => h.textContent.trim());
500    if (headerTexts.includes('Pos') || headerTexts.includes('Grade')) {
501      debugLog('Table already enhanced, skipping');
502      return;
503    }
504    
505    const sampleHeader = headers[0];
506    const isGoalieTable = headerTexts.includes('GAA') && headerTexts.includes('SV %');
507    debugLog('Enhancing table', isGoalieTable ? 'Goalie' : 'Skater');
508    
509    if (!isGoalieTable) {
510      const posHeader = document.createElement('th');
511      posHeader.textContent = 'Pos';
512      posHeader.className = sampleHeader.className;
513      posHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
514      posHeader.title = 'Sort by Position (sorts current page only)';
515      posHeader.onclick = () => sortTable(table, nameIndex + 1);
516      headers[nameIndex].after(posHeader);
517    }
518    
519    const gradeHeader = document.createElement('th');
520    gradeHeader.textContent = 'Grade';
521    gradeHeader.className = sampleHeader.className;
522    gradeHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
523    gradeHeader.title = 'Sort by Grade (sorts current page only)';
524    const gradeColumnIndex = isGoalieTable ? nameIndex + 1 : nameIndex + 2;
525    gradeHeader.onclick = () => sortTable(table, gradeColumnIndex);
526    
527    if (isGoalieTable) {
528      headers[nameIndex].after(gradeHeader);
529    } else {
530      const posHeader = headers[nameIndex].nextElementSibling;
531      posHeader.after(gradeHeader);
532    }
533    
534    let matchedCount = 0;
535    bodyRows.forEach(row => {
536      const cells = row.querySelectorAll('td');
537      if (cells.length === 0) return;
538      
539      const nameCell = cells[nameIndex];
540      const playerLink = nameCell?.querySelector('a');
541      const playerIdMatch = playerLink?.href?.match(/roster_players\/(\d+)/);
542      
543      let position = '';
544      let grade = '';
545      
546      if (playerIdMatch) {
547        const playerId = playerIdMatch[1];
548        const info = playerData[playerId];
549        if (info) {
550          position = info.position;
551          grade = info.grade;
552          matchedCount++;
553        }
554      }
555      
556      if (!isGoalieTable) {
557        const posCell = document.createElement('td');
558        posCell.textContent = position;
559        posCell.className = cells[0].className;
560        posCell.style.cssText = 'text-align: center; font-weight: 600;';
561        cells[nameIndex].after(posCell);
562      }
563      
564      const gradeCell = document.createElement('td');
565      gradeCell.textContent = grade;
566      gradeCell.className = cells[0].className;
567      gradeCell.style.textAlign = 'center';
568      
569      if (isGoalieTable) {
570        cells[nameIndex].after(gradeCell);
571      } else {
572        const posCell = cells[nameIndex].nextElementSibling;
573        posCell.after(gradeCell);
574      }
575    });
576    
577    debugLog(`Table enhanced`, `${matchedCount}/${bodyRows.length} players matched`);
578  }
579  
580  function sortTable(table, columnIndex) {
581    const tbody = table.querySelector('tbody');
582    const rows = Array.from(tbody.querySelectorAll('tr'));
583    
584    const currentDir = table.dataset[`sort${columnIndex}`];
585    const direction = currentDir === 'asc' ? 'desc' : 'asc';
586    table.dataset[`sort${columnIndex}`] = direction;
587    
588    rows.sort((a, b) => {
589      const aVal = a.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
590      const bVal = b.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
591      
592      if (direction === 'asc') {
593        return aVal.localeCompare(bVal);
594      } else {
595        return bVal.localeCompare(aVal);
596      }
597    });
598    
599    rows.forEach(row => tbody.appendChild(row));
600  }
601  
602  function init() {
603    debugLog('Initializing script');
604    setTimeout(enhanceLeagueStats, 2000);
605  }
606  
607  if (document.readyState === 'loading') {
608    document.addEventListener('DOMContentLoaded', init);
609  } else {
610    init();
611  }
612  
613  const observer = new MutationObserver((mutations) => {
614    let shouldEnhance = false;
615    mutations.forEach(mutation => {
616      mutation.addedNodes.forEach(node => {
617        if (node.nodeType === 1) {
618          if (node.tagName === 'TABLE' || node.querySelector('table')) {
619            shouldEnhance = true;
620          }
621        }
622      });
623    });
624    
625    if (shouldEnhance && !isEnhancing) {
626      lastEnhancedUrl = '';
627      debugLog('Table mutation detected, re-enhancing');
628      setTimeout(enhanceLeagueStats, 1500);
629    }
630  });
631  
632  observer.observe(document.body, {
633    childList: true,
634    subtree: true
635  });
636  
637})();
