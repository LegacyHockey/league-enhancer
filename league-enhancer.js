(function(){
  'use strict';
  
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  let allPlayerData = {};
  let isEnhancing = false;
  let lastEnhancedUrl = '';
  
  // All Minnesota conference page IDs (excluding Out of State)
  const MN_CONFERENCES = [
    '9113382', // Big 9
    '9113405', // Big South
    '9113424', // Central Lakes
    '9113443', // Granite Ridge
    '9113450', // IMAC
    '9113459', // Independents
    '9113474', // Iron Range
    '9113483', // Lake
    '9113496', // Lake Superior
    '9113513', // Mariucci
    '9113528', // Metro East
    '9113545', // Metro West
    '9113562', // Mississippi 8
    '9113577', // Northwest
    '9113586', // Northwest Suburban
    '9113611', // South Suburban
    '9113630', // Suburban East
    '9113656', // Tri-Metro
    '9113667', // West Central
    '9113678'  // Wright County
  ];
  
  // Detect if on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  // Mobile-specific settings
  const MOBILE_BATCH_SIZE = 3; // Process fewer teams at once on mobile
  const MOBILE_DELAY = 200; // Longer delays between requests on mobile
  const MOBILE_TIMEOUT = 8000; // 8 second timeout for mobile requests
  
  async function enhanceLeagueStats() {
    if (!location.href.includes('league_instance')) return;
    if (isEnhancing) return;
    
    const currentUrl = location.href;
    if (currentUrl === lastEnhancedUrl) return;
    
    isEnhancing = true;
    console.log('Stats Enhancer: Starting enhancement (Mobile: ' + isMobile + ')');
    
    const seasonMatch = location.href.match(/subseason=(\d+)/);
    if (!seasonMatch) {
      isEnhancing = false;
      return;
    }
    
    const season = seasonMatch[1];
    
    // Load data if not already loaded
    if (Object.keys(allPlayerData).length === 0) {
      const cacheKey = `league_mn_v3_${season}`;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        try {
          const parsedCache = JSON.parse(cached);
          if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
            console.log('Using cached league roster data');
            allPlayerData = parsedCache.data;
          } else {
            console.log('Cache expired, fetching fresh data');
            showLoadingIndicator('Loading Minnesota team rosters...');
            try {
              allPlayerData = await fetchAllMNTeamRosters(season);
              localStorage.setItem(cacheKey, JSON.stringify({
                data: allPlayerData,
                timestamp: Date.now()
              }));
              hideLoadingIndicator();
            } catch (error) {
              console.error('Error fetching rosters:', error);
              showErrorMessage('Could not load roster data. Using cached data if available.');
              // Try to use expired cache rather than failing completely
              if (parsedCache && parsedCache.data) {
                allPlayerData = parsedCache.data;
                hideLoadingIndicator();
              } else {
                isEnhancing = false;
                return;
              }
            }
          }
        } catch (e) {
          console.error('Error parsing cache:', e);
          localStorage.removeItem(cacheKey);
          isEnhancing = false;
          return;
        }
      } else {
        console.log('No cache found, fetching roster data');
        showLoadingIndicator('Loading Minnesota team rosters...');
        try {
          allPlayerData = await fetchAllMNTeamRosters(season);
          localStorage.setItem(cacheKey, JSON.stringify({
            data: allPlayerData,
            timestamp: Date.now()
          }));
          hideLoadingIndicator();
        } catch (error) {
          console.error('Error fetching rosters:', error);
          showErrorMessage('Failed to load roster data. Please try refreshing the page.');
          isEnhancing = false;
          return;
        }
      }
    }
    
    if (Object.keys(allPlayerData).length === 0) {
      console.log('No roster data available');
      isEnhancing = false;
      return;
    }
    
    console.log('Waiting for tables to load...');
    await waitForTables();
    console.log('Tables loaded, enhancing...');
    
    filterOutOfStateTeams();
    
    let enhanced = 0;
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
        enhanceTable(table, allPlayerData);
        enhanced++;
      }
    });
    
    console.log(`Enhanced ${enhanced} tables`);
    lastEnhancedUrl = currentUrl;
    isEnhancing = false;
  }
  
  function filterOutOfStateTeams() {
    let hiddenCount = 0;
    document.querySelectorAll('table tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
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
            row.style.display = 'none';
            hiddenCount++;
          }
        }
      });
    });
    if (hiddenCount > 0) {
      console.log(`Filtered out ${hiddenCount} out-of-state team rows`);
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
        console.log(`Found ${linkCount} player links, waiting 800ms more...`);
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
      indicator.style.cssText = `
        position: fixed;
        top: 20px;
        ${isMobile ? 'left: 50%; transform: translateX(-50%);' : 'right: 20px;'}
        background: #2c3e50;
        color: white;
        padding: ${isMobile ? '12px 20px' : '15px 25px'};
        border-radius: 6px;
        font-size: ${isMobile ? '13px' : '14px'};
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 99999;
        max-width: ${isMobile ? '90%' : '300px'};
      `;
      
      const style = document.createElement('style');
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(indicator);
    }
    
    const showSpinner = !message.includes('⚠️') && !message.includes('Could not');
    indicator.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        ${showSpinner ? '<div style="width: 18px; height: 18px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; flex-shrink: 0;"></div>' : ''}
        <span style="font-size: ${isMobile ? '12px' : '14px'};">${message}</span>
      </div>
    `;
  }
  
  function showErrorMessage(message) {
    showLoadingIndicator('⚠️ ' + message);
    setTimeout(hideLoadingIndicator, 7000);
  }
  
  function hideLoadingIndicator() {
    const indicator = document.getElementById('roster-loading-indicator');
    if (indicator) {
      indicator.style.transition = 'opacity 0.3s';
      indicator.style.opacity = '0';
      setTimeout(() => indicator.remove(), 300);
    }
  }
  
  // Fetch with timeout wrapper
  async function fetchWithTimeout(url, timeout = isMobile ? MOBILE_TIMEOUT : 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }
  
  async function fetchAllMNTeamRosters(season) {
    const allTeamIds = new Set();
    
    // Fetch team IDs from each Minnesota conference
    const batchSize = isMobile ? 5 : 10; // Process fewer conferences at once on mobile
    
    for (let i = 0; i < MN_CONFERENCES.length; i += batchSize) {
      const batch = MN_CONFERENCES.slice(i, i + batchSize);
      
      // Process conferences in parallel batches
      await Promise.all(batch.map(async (confId) => {
        const url = `https://www.legacy.hockey/page/show/${confId}?subseason=${season}`;
        
        try {
          const response = await fetchWithTimeout(url);
          if (!response.ok) {
            console.warn(`Failed to fetch conference ${confId}`);
            return;
          }
          
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          
          const teamLinks = doc.querySelectorAll('a[href*="/page/show/"]');
          let foundTeams = 0;
          
          teamLinks.forEach(link => {
            if (link.href.includes(`subseason=${season}`)) {
              const match = link.href.match(/page\/show\/(\d+)/);
              if (match && match[1] !== confId) {
                allTeamIds.add(match[1]);
                foundTeams++;
              }
            }
          });
          
          console.log(`Conference ${i + batch.indexOf(confId) + 1}/${MN_CONFERENCES.length}: Found ${foundTeams} teams`);
        } catch (error) {
          console.error(`Error fetching conference ${confId}:`, error.message);
          // Continue with other conferences
        }
      }));
      
      const progress = Math.min(i + batchSize, MN_CONFERENCES.length);
      showLoadingIndicator(`Scanning conferences... ${progress}/${MN_CONFERENCES.length}`);
      
      // Small delay between batches
      if (i + batchSize < MN_CONFERENCES.length) {
        await new Promise(resolve => setTimeout(resolve, isMobile ? 150 : 50));
      }
    }
    
    if (allTeamIds.size === 0) {
      throw new Error('No teams found in conferences');
    }
    
    console.log(`Total: Found ${allTeamIds.size} Minnesota teams`);
    showLoadingIndicator(`Found ${allTeamIds.size} teams. Loading rosters...`);
    
    // Fetch rosters with progress tracking
    const allData = {};
    const teamArray = Array.from(allTeamIds);
    const teamBatchSize = isMobile ? MOBILE_BATCH_SIZE : 5;
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < teamArray.length; i += teamBatchSize) {
      const batch = teamArray.slice(i, i + teamBatchSize);
      
      // Process teams in parallel batches
      const results = await Promise.allSettled(
        batch.map(teamId => fetchTeamRoster(teamId, season))
      );
      
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          Object.assign(allData, result.value);
          successCount++;
        } else {
          console.error(`Error fetching team ${batch[idx]}:`, result.reason?.message || 'Unknown error');
          errorCount++;
        }
      });
      
      const progress = Math.min(i + teamBatchSize, teamArray.length);
      showLoadingIndicator(`Loading rosters... ${progress}/${teamArray.length}`);
      
      // Delay between batches (longer on mobile)
      if (i + teamBatchSize < teamArray.length) {
        await new Promise(resolve => setTimeout(resolve, isMobile ? MOBILE_DELAY : 100));
      }
    }
    
    console.log(`Fetched ${successCount}/${teamArray.length} teams successfully, ${Object.keys(allData).length} players total (${errorCount} errors)`);
    
    // Accept partial data if we got at least 50% of teams
    if (Object.keys(allData).length === 0) {
      throw new Error('No roster data loaded');
    }
    
    if (successCount < teamArray.length * 0.5) {
      console.warn(`Only ${successCount}/${teamArray.length} teams loaded successfully`);
    }
    
    return allData;
  }
  
  async function fetchTeamRoster(teamId, season) {
    const url = `https://www.legacy.hockey/roster/show/${teamId}?subseason=${season}`;
    
    const response = await fetchWithTimeout(url);
    if (!response.ok) return {};
    
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
  }
  
  function enhanceTable(table, playerData) {
    const headerRow = table.querySelector('thead tr');
    const bodyRows = table.querySelectorAll('tbody tr');
    
    if (!headerRow || bodyRows.length === 0) return;
    
    const headers = headerRow.querySelectorAll('th');
    let nameIndex = -1;
    
    headers.forEach((header, index) => {
      if (header.textContent.trim() === 'Name') {
        nameIndex = index;
      }
    });
    
    if (nameIndex === -1) return;
    
    const headerTexts = Array.from(headers).map(h => h.textContent.trim());
    if (headerTexts.includes('Pos') || headerTexts.includes('Grade')) {
      console.log('Table already enhanced, skipping');
      return;
    }
    
    const sampleHeader = headers[0];
    const isGoalieTable = headerTexts.includes('GAA') && headerTexts.includes('SV %');
    console.log(`Enhancing ${isGoalieTable ? 'Goalie' : 'Skater'} table`);
    
    if (!isGoalieTable) {
      const posHeader = document.createElement('th');
      posHeader.textContent = 'Pos';
      posHeader.className = sampleHeader.className;
      posHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
      posHeader.title = 'Sort by Position (sorts current page only)';
      posHeader.onclick = () => sortTable(table, nameIndex + 1);
      headers[nameIndex].after(posHeader);
    }
    
    const gradeHeader = document.createElement('th');
    gradeHeader.textContent = 'Grade';
    gradeHeader.className = sampleHeader.className;
    gradeHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
    gradeHeader.title = 'Sort by Grade (sorts current page only)';
    const gradeColumnIndex = isGoalieTable ? nameIndex + 1 : nameIndex + 2;
    gradeHeader.onclick = () => sortTable(table, gradeColumnIndex);
    
    if (isGoalieTable) {
      headers[nameIndex].after(gradeHeader);
    } else {
      const posHeader = headers[nameIndex].nextElementSibling;
      posHeader.after(gradeHeader);
    }
    
    let matchedCount = 0;
    bodyRows.forEach(row => {
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
    
    console.log(`Table enhanced (${isGoalieTable ? 'Goalie' : 'Skater'}): ${matchedCount}/${bodyRows.length} players matched`);
  }
  
  function sortTable(table, columnIndex) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    const currentDir = table.dataset[`sort${columnIndex}`];
    const direction = currentDir === 'asc' ? 'desc' : 'asc';
    table.dataset[`sort${columnIndex}`] = direction;
    
    rows.sort((a, b) => {
      const aVal = a.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
      const bVal = b.querySelectorAll('td')[columnIndex]?.textContent?.trim() || '';
      
      if (direction === 'asc') {
        return aVal.localeCompare(bVal);
      } else {
        return bVal.localeCompare(aVal);
      }
    });
    
    rows.forEach(row => tbody.appendChild(row));
  }
  
  function init() {
    setTimeout(enhanceLeagueStats, 2000);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  const observer = new MutationObserver((mutations) => {
    let shouldEnhance = false;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
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
