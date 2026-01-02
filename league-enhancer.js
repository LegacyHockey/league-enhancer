(function(){
  'use strict';
  
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  let allPlayerData = {};
  let isEnhancing = false;
  
  async function enhanceLeagueStats() {
    // Only run on league stats pages
    if (!location.href.includes('league_instance')) return;
    if (isEnhancing) return;
    
    const seasonMatch = location.href.match(/subseason=(\d+)/);
    if (!seasonMatch) return;
    
    const season = seasonMatch[1];
    
    // Load data if not already loaded
    if (Object.keys(allPlayerData).length === 0) {
      const cacheKey = `league_all_${season}`;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const parsedCache = JSON.parse(cached);
        if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
          console.log('Using cached league roster data');
          allPlayerData = parsedCache.data;
        } else {
          console.log('Cache expired, fetching fresh data');
          showLoadingIndicator('Loading all team rosters...');
          allPlayerData = await fetchAllTeamRosters(season);
          localStorage.setItem(cacheKey, JSON.stringify({
            data: allPlayerData,
            timestamp: Date.now()
          }));
          hideLoadingIndicator();
        }
      } else {
        console.log('No cache found, fetching roster data for all teams');
        showLoadingIndicator('Loading all team rosters... This may take 20-30 seconds.');
        allPlayerData = await fetchAllTeamRosters(season);
        localStorage.setItem(cacheKey, JSON.stringify({
          data: allPlayerData,
          timestamp: Date.now()
        }));
        hideLoadingIndicator();
      }
    }
    
    if (Object.keys(allPlayerData).length === 0) {
      console.log('No roster data available');
      return;
    }
    
    // Enhance all stats tables
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
        enhanceTable(table, allPlayerData);
      }
    });
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
  
  async function fetchAllTeamRosters(season) {
    // Find all unique team page IDs from links on the page
    const teamIds = new Set();
    document.querySelectorAll('a[href*="/page/show/"]').forEach(link => {
      if (link.href.includes(`subseason=${season}`) && link.href.includes('use_abbrev=true')) {
        const match = link.href.match(/page\/show\/(\d+)/);
        if (match) teamIds.add(match[1]);
      }
    });
    
    console.log(`Found ${teamIds.size} teams to fetch`);
    
    const allData = {};
    let count = 0;
    
    // Fetch ALL teams (no limit)
    for (const teamId of teamIds) {
      const rosterData = await fetchTeamRoster(teamId, season);
      Object.assign(allData, rosterData);
      count++;
      
      // Update loading indicator
      const indicator = document.getElementById('roster-loading-indicator');
      if (indicator) {
        indicator.querySelector('span').textContent = `Loading rosters... ${count}/${teamIds.size} teams`;
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
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
    
    // Check if already enhanced
    if (headerRow.textContent.includes('Pos')) return;
    
    const headers = headerRow.querySelectorAll('th');
    let nameIndex = -1;
    
    headers.forEach((header, index) => {
      if (header.textContent.trim() === 'Name') {
        nameIndex = index;
      }
    });
    
    if (nameIndex === -1) return;
    
    // Create header cells
    const sampleHeader = headers[0];
    
    const posHeader = document.createElement('th');
    posHeader.textContent = 'Pos';
    posHeader.className = sampleHeader.className;
    posHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
    posHeader.title = 'Sort by Position (sorts current page only)';
    posHeader.onclick = () => sortTable(table, nameIndex + 1);
    
    const gradeHeader = document.createElement('th');
    gradeHeader.textContent = 'Grade';
    gradeHeader.className = sampleHeader.className;
    gradeHeader.style.cssText = 'text-align: center; font-weight: bold; cursor: pointer;';
    gradeHeader.title = 'Sort by Grade (sorts current page only)';
    gradeHeader.onclick = () => sortTable(table, nameIndex + 2);
    
    // Insert headers after Name column
    headers[nameIndex].after(gradeHeader);
    headers[nameIndex].after(posHeader);
    
    // Add data to rows
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
        }
      }
      
      // Create position cell
      const posCell = document.createElement('td');
      posCell.textContent = position;
      posCell.className = cells[0].className;
      posCell.style.cssText = 'text-align: center; font-weight: 600;';
      
      // Create grade cell
      const gradeCell = document.createElement('td');
      gradeCell.textContent = grade;
      gradeCell.className = cells[0].className;
      gradeCell.style.textAlign = 'center';
      
      // Insert after name cell
      cells[nameIndex].after(gradeCell);
      cells[nameIndex].after(posCell);
    });
    
    console.log('Table enhanced with Position and Grade columns');
  }
  
  function sortTable(table, columnIndex) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    // Toggle sort direction
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
    
    // Re-append rows in new order
    rows.forEach(row => tbody.appendChild(row));
  }
  
  // Run when page loads
  function init() {
    setTimeout(enhanceLeagueStats, 2000);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Watch for pagination changes (when new tables are loaded)
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
    
    if (shouldEnhance) {
      setTimeout(enhanceLeagueStats, 500);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
})();
