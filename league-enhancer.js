(function(){
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
    
    // Filter out-of-state teams first
    filterOutOfStateTeams();
    
    // Find all tables that need enhancement
    const tables = [];
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
        tables.push(table);
      }
    });
    
    if (tables.length === 0) {
      console.log('No tables found to enhance');
      isEnhancing = false;
      return;
    }
    
    console.log(`Found ${tables.length} tables to enhance`);
    
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
    
    console.log(`Found ${teamIds.size} unique teams on this page`);
    
    if (teamIds.size === 0) {
      console.log('No teams found');
      isEnhancing = false;
      return;
    }
    
    // Show loading indicator
    showLoadingIndicator(`Loading data for ${teamIds.size} teams...`);
    
    // Fetch roster data for only these teams
    const playerData = {};
    let loadedCount = 0;
    let failedCount = 0;
    
    for (const teamId of teamIds) {
      try {
        const cacheKey = `team_${teamId}_${season}`;
        let teamRoster = null;
        
        // Try cache first
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
            teamRoster = parsedCache.data;
            console.log(`Using cached data for team ${teamId}`);
          }
        }
        
        // Fetch if not cached
        if (!teamRoster) {
          console.log(`Fetching roster for team ${teamId}`);
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
          showLoadingIndicator(`Loading data... ${loadedCount}/${teamIds.size} teams`);
        }
      } catch (error) {
        console.error(`Failed to fetch team ${teamId}:`, error.message);
        failedCount++;
      }
    }
    
    hideLoadingIndicator();
    
    console.log(`Loaded ${loadedCount} teams, failed ${failedCount}, total ${Object.keys(playerData).length} players`);
    
    // Even if some teams failed, enhance with what we have
    if (Object.keys(playerData).length > 0) {
      tables.forEach(table => {
        enhanceTable(table, playerData);
      });
      console.log(`Enhanced ${tables.length} tables`);
    } else {
      console.log('No player data available to enhance tables');
      showErrorMessage('Could not load any team data');
    }
    
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
    setTimeout(hideLoadingIndicator, 5000);
  }
  
  function hideLoadingIndicator() {
    const indicator = document.getElementById('roster-loading-indicator');
    if (indicator) {
      indicator.style.transition = 'opacity 0.3s';
      indicator.style.opacity = '0';
      setTimeout(() => indicator.remove(), 300);
    }
  }
  
  async function fetchTeamRoster(teamId, season) {
    const url = `https://www.legacy.hockey/roster/show/${teamId}?subseason=${season}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), isMobile ? 10000 : 5000);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const playerMap = {};
      
      // Extract team name from the page (school name only, no mascot)
      let teamName = '';
      const titleElement = doc.querySelector('h1.page-title, h1, .team-name');
      if (titleElement) {
        teamName = titleElement.textContent.trim();
        // Remove "Roster" or year info if present
        teamName = teamName.replace(/\s*Roster\s*/i, '').replace(/\s*\d{4}-\d{4}\s*/, '').trim();
        
        // Extract just the school name (first word or first two words before mascot)
        // Common patterns: "Edina Hornets", "Minnetonka Skippers", "Eden Prairie Eagles"
        // We want just "Edina", "Minnetonka", "Eden Prairie"
        
        // List of common mascot names to remove
        const mascots = [
          'Hornets', 'Skippers', 'Eagles', 'Hawks', 'Huskies', 'Panthers', 'Trojans',
          'Crimson', 'Knights', 'Royals', 'Bengals', 'Cougars', 'Spartans', 'Wildcats',
          'Tigers', 'Lions', 'Warriors', 'Saints', 'Rangers', 'Pirates', 'Bobcats',
          'Jaguars', 'Mustangs', 'Bulldogs', 'Cardinals', 'Raiders', 'Grizzlies', 'Bears',
          'Sabers', 'Sabres', 'Minutemen', 'Thunder', 'Storm', 'Lightning', 'Bolts',
          'Greyhounds', 'Ponies', 'Flyers', 'Rovers', 'Orioles', 'Blue Jags', 'Blaze'
        ];
        
        // Try to remove mascot name
        for (const mascot of mascots) {
          const regex = new RegExp('\\s+' + mascot + '\\b.*$', 'i');
          if (regex.test(teamName)) {
            teamName = teamName.replace(regex, '').trim();
            break;
          }
        }
        
        // Also remove any grade/level indicators like "Bantam AA", "Peewee A", etc.
        teamName = teamName.replace(/\s+(Bantam|Peewee|Squirt|Midget|U\d+|Varsity|JV)\s+[A-Z]+\s*$/i, '').trim();
        teamName = teamName.replace(/\s+(Bantam|Peewee|Squirt|Midget|U\d+|Varsity|JV)\s*$/i, '').trim();
      }
      
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
              grade: grade || '',
              teamName: teamName,
              teamId: teamId
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
    let teamIndex = -1;
    
    headers.forEach((header, index) => {
      const headerText = header.textContent.trim();
      if (headerText === 'Name') {
        nameIndex = index;
      }
      if (headerText === 'Team') {
        teamIndex = index;
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
    let teamNamesReplaced = 0;
    
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
      const nameCell = cells[nameIndex];
      const playerLink = nameCell?.querySelector('a');
      const playerIdMatch = playerLink?.href?.match(/roster_players\/(\d+)/);
      
      let position = '';
      let grade = '';
      let teamName = '';
      
      if (playerIdMatch) {
        const playerId = playerIdMatch[1];
        const info = playerData[playerId];
        if (info) {
          position = info.position;
          grade = info.grade;
          teamName = info.teamName;
          matchedCount++;
        }
      }
      
      // Replace team abbreviation with full name if we have it
      if (teamIndex !== -1 && teamName) {
        const teamCell = cells[teamIndex];
        const teamLink = teamCell?.querySelector('a');
        
        if (teamLink) {
          const currentText = teamLink.textContent.trim();
          // Only replace if current text looks like an abbreviation (short)
          if (currentText.length <= 10) {
            // Truncate long team names
            const maxLength = isMobile ? 20 : 30;
            const displayName = teamName.length > maxLength 
              ? teamName.substring(0, maxLength - 3) + '...'
              : teamName;
            
            teamLink.textContent = displayName;
            teamLink.title = teamName; // Show full name on hover
            teamNamesReplaced++;
          }
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
    
    console.log(`Table enhanced (${isGoalieTable ? 'Goalie' : 'Skater'}): ${matchedCount}/${bodyRows.length} players matched, ${teamNamesReplaced} team names replaced`);
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
