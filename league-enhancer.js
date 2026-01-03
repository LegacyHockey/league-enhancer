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
  
  async function enhanceLeagueStats() {
    if (!location.href.includes('league_instance')) return;
    if (isEnhancing) return;
    
    // Check if we're on a new URL/tab
    const currentUrl = location.href;
    if (currentUrl === lastEnhancedUrl) return;
    
    isEnhancing = true;
    console.log('Stats Enhancer: Starting enhancement');
    
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
        const parsedCache = JSON.parse(cached);
        if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
          console.log('Using cached league roster data');
          allPlayerData = parsedCache.data;
        } else {
          console.log('Cache expired, fetching fresh data');
          showLoadingIndicator('Loading all Minnesota team rosters...');
          allPlayerData = await fetchAllMNTeamRosters(season);
          localStorage.setItem(cacheKey, JSON.stringify({
            data: allPlayerData,
            timestamp: Date.now()
          }));
          hideLoadingIndicator();
        }
      } else {
        console.log('No cache found, fetching roster data for all Minnesota teams');
        showLoadingIndicator('Loading all Minnesota team rosters... This may take 1-2 minutes.');
        allPlayerData = await fetchAllMNTeamRosters(season);
        localStorage.setItem(cacheKey, JSON.stringify({
          data: allPlayerData,
          timestamp: Date.now()
        }));
        hideLoadingIndicator();
      }
    }
    
    if (Object.keys(allPlayerData).length === 0) {
      console.log('No roster data available');
      isEnhancing = false;
      return;
    }
    
    // Wait for tables to fully load
    console.log('Waiting for tables to load...');
    await waitForTables();
    console.log('Tables loaded, enhancing...');
    
    // Filter out excluded teams and enhance tables
    filterOutOfStateTeams();
    
    // Enhance all stats tables
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
    // Remove rows for out-of-state teams
    let hiddenCount = 0;
    document.querySelectorAll('table tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
      // Find the Team column and check for out-of-state teams
      cells.forEach(cell => {
        const teamLink = cell.querySelector('a[href*="/page/show/"]');
        if (teamLink) {
          const teamName = teamLink.textContent.trim();
          const fullTeamName = teamLink.getAttribute('title') || '';
          
          // Check if team is from out of state
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
      
      // Wait for at least 10 player links to ensure table is populated
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
    const indicator = document.createElement('div');
    indicator.id = 'roster-loading-indicator';
    indicator.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 20px; height: 20px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <span>${message}</span>
      </div>
    `;
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #2c3e50;
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 99999;
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
  
  function hideLoadingIndicator() {
    const indicator = document.getElementById('roster-loading-indicator');
    if (indicator) {
      indicator.style.transition = 'opacity 0.3s';
      indicator.style.opacity = '0';
      setTimeout(() => indicator.remove(), 300);
    }
  }
  
  async function fetchAllMNTeamRosters(season) {
    const allTeamIds = new Set();
    
    // Fetch team IDs from each Minnesota conference
    for (let i = 0; i < MN_CONFERENCES.length; i++) {
      const confId = MN_CONFERENCES[i];
      const url = `https://www.legacy.hockey/page/show/${confId}?subseason=${season}`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`Failed to fetch conference ${confId}`);
          continue;
        }
        
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        
        // Find all team links
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
        
        console.log(`Conference ${i + 1}: Found ${foundTeams} teams`);
        
        // Update indicator
        const indicator = document.getElementById('roster-loading-indicator');
        if (indicator) {
          indicator.querySelector('span').textContent = 
            `Scanning conferences... ${i + 1}/${MN_CONFERENCES.length} (${allTeamIds.size} teams found)`;
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`Error fetching conference ${confId}:`, error);
      }
    }
    
    console.log(`Total: Found ${allTeamIds.size} Minnesota teams`);
    
    // Now fetch rosters for all teams
    const allData = {};
    let count = 0;
    
    for (const teamId of allTeamIds) {
      const rosterData = await fetchTeamRoster(teamId, season);
      Object.assign(allData, rosterData);
      count++;
      
      const indicator = document.getElementById('roster-loading-indicator');
      if (indicator) {
        indicator.querySelector('span').textContent = 
          `Loading rosters... ${count}/${allTeamIds.size} teams`;
      }
      
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    
    console.log(`Fetched roster data for ${count} teams, ${Object.keys(allData).length} players`);
    return allData;
  }
  
  async function fetchTeamRoster(teamId, season) {
    const url = `https://www.legacy.hockey/roster/show/${teamId}?subseason=${season}`;
    
    try {
      const response = await fetch(url);
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
    } catch (error) {
      console.error(`Error fetching roster for team ${teamId}:`, error);
      return {};
    }
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
    
    // Check if already enhanced by looking for Pos or Grade column
    const headerTexts = Array.from(headers).map(h => h.textContent.trim());
    if (headerTexts.includes('Pos') || headerTexts.includes('Grade')) {
      console.log('Table already enhanced, skipping');
      return;
    }
    
    const sampleHeader = headers[0];
    
    // Check if this is a goalie table
    const isGoalieTable = headerTexts.includes('GAA') && headerTexts.includes('SV %');
    console.log(`Enhancing ${isGoalieTable ? 'Goalie' : 'Skater'} table`);
    
    // Only add Position column for skater tables
    if (!isGoalieTable) {
      const posHeader = document.createElement('th');
      posHeader.textContent = 'Pos';
      posHeader.className = sampleHeader.className;
      posHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
      posHeader.title = 'Sort by Position (sorts current page only)';
      posHeader.onclick = () => sortTable(table, nameIndex + 1);
      headers[nameIndex].after(posHeader);
    }
    
    // Always add Grade column
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
      // For skater tables, insert after the Pos header we just added
      const posHeader = headers[nameIndex].nextElementSibling;
      posHeader.after(gradeHeader);
    }
    
    // Add data to rows
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
      
      // Add Position cell for skater tables only
      if (!isGoalieTable) {
        const posCell = document.createElement('td');
        posCell.textContent = position;
        posCell.className = cells[0].className;
        posCell.style.cssText = 'text-align: center; font-weight: 600;';
        cells[nameIndex].after(posCell);
      }
      
      // Add Grade cell
      const gradeCell = document.createElement('td');
      gradeCell.textContent = grade;
      gradeCell.className = cells[0].className;
      gradeCell.style.textAlign = 'center';
      
      if (isGoalieTable) {
        cells[nameIndex].after(gradeCell);
      } else {
        // For skater tables, insert after the Pos cell we just added
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
      // Reset the last URL so we re-enhance for tab changes
      lastEnhancedUrl = '';
      setTimeout(enhanceLeagueStats, 1500);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
})();
