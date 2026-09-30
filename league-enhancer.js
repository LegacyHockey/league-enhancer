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
    
    isEnhancing = true;
    console.log('Stats Enhancer: Starting enhancement (Mobile: ' + isMobile + ')');
    
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
    const allTables = [];
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
        allTables.push(table);
      }
    });
    
    if (allTables.length === 0) {
      console.log('No tables found');
      isEnhancing = false;
      return;
    }
    
    // Filter to only tables that haven't been enhanced yet
    const tables = allTables.filter(table => {
      return !table.hasAttribute('data-enhanced');
    });
    
    if (tables.length === 0) {
      console.log('All tables already enhanced, skipping');
      isEnhancing = false;
      lastEnhancedUrl = currentUrl;
      return;
    }
    
    console.log(`Found ${tables.length} new tables to enhance`);
    
    // Filter out-of-state teams only from stats tables
    tables.forEach(table => filterOutOfStateTeams(table));
    
    // OPTIMIZATION: Replace team names first (doesn't require any fetching)
    tables.forEach(table => {
      replaceTeamNames(table);
    });
    
    // Collect all unique team IDs from visible players in NEW tables only
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
      tables.forEach(table => {
        table.setAttribute('data-enhanced', 'true');
      });
      isEnhancing = false;
      return;
    }
    
    // Check how many teams are already cached
    let cachedTeamCount = 0;
    for (const teamId of teamIds) {
      const cacheKey = `team_${teamId}_${season}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsedCache = JSON.parse(cached);
        if (Date.now() - parsedCache.timestamp < CACHE_DURATION) {
          cachedTeamCount++;
        }
      }
    }
    
    const needsToFetch = cachedTeamCount < teamIds.size;
    console.log(`${cachedTeamCount}/${teamIds.size} teams cached, ${needsToFetch ? 'will fetch new data' : 'all cached'}`);
    
    // Only show loading indicator if we need to fetch new data
    if (needsToFetch) {
      showLoadingIndicator(`Loading data for ${teamIds.size - cachedTeamCount} teams...`);
    }
    
    // Fetch roster data for only these teams
    const playerData = {};
    let loadedCount = 0;
    let failedCount = 0;
    let fetchedCount = 0;
    
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
          fetchedCount++;
          
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
          await new Promise(resolve => setTimeout(resolve, isMobile ? 100 : 30));
          
          // Update progress only if showing indicator
          if (needsToFetch && fetchedCount % 2 === 0) {
            showLoadingIndicator(`Loading data... ${fetchedCount}/${teamIds.size - cachedTeamCount} teams`);
          }
        }
        
        Object.assign(playerData, teamRoster);
        loadedCount++;
      } catch (error) {
        console.error(`Failed to fetch team ${teamId}:`, error.message);
        failedCount++;
      }
    }
    
    if (needsToFetch) {
      hideLoadingIndicator();
    }
    
    console.log(`Loaded ${loadedCount} teams (${cachedTeamCount} cached, ${fetchedCount} fetched), failed ${failedCount}, total ${Object.keys(playerData).length} players`);
    
    // Even if some teams failed, enhance with what we have
    if (Object.keys(playerData).length > 0) {
      tables.forEach(table => {
        addPositionAndGrade(table, playerData);
        // Mark this table as enhanced
        table.setAttribute('data-enhanced', 'true');
      });
      console.log(`Enhanced ${tables.length} tables`);
    } else {
      console.log('No player data available to enhance tables');
      if (needsToFetch) {
        showErrorMessage('Could not load any team data');
      }
      tables.forEach(table => {
        table.setAttribute('data-enhanced', 'true');
      });
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
      console.log(`Filtered out ${hiddenCount} out-of-state team rows from stats table`);
    }
  }
  
  // NEW: Separate function to just replace team names (fast, no fetching needed)
  function replaceTeamNames(table) {
    const headerRow = table.querySelector('thead tr');
    const bodyRows = table.querySelectorAll('tbody tr');
    
    if (!headerRow || bodyRows.length === 0) return;
    
    const headers = headerRow.querySelectorAll('th');
    let teamIndex = -1;
    
    headers.forEach((header, index) => {
      if (header.textContent.trim() === 'Team') {
        teamIndex = index;
      }
    });
    
    if (teamIndex === -1) return;
    
    // Add a style tag for team cells if not already added
    if (!document.getElementById('team-cell-overflow-style')) {
      const style = document.createElement('style');
      style.id = 'team-cell-overflow-style';
      style.textContent = `
        .team-cell-overflow {
          max-width: ${isMobile ? '110px' : '180px'} !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          padding-left: 8px !important;
          padding-right: 8px !important;
        }
        .team-link-overflow {
          display: block !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          max-width: 100% !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    let teamNamesReplaced = 0;
    
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
      const teamCell = cells[teamIndex];
      const teamLink = teamCell?.querySelector('a');
      
      if (teamLink) {
        const fullTeamName = teamLink.getAttribute('title');
        
        if (fullTeamName) {
          // Check if it's already been replaced (not an abbreviation)
          const currentText = teamLink.textContent.trim();
          if (currentText.length <= 10) {
            // Use the full team name from the title
            teamLink.textContent = fullTeamName;
            
            // Add classes for overflow handling
            teamCell.classList.add('team-cell-overflow');
            teamLink.classList.add('team-link-overflow');
            
            teamNamesReplaced++;
          }
        }
      }
    });
    
    console.log(`Replaced ${teamNamesReplaced} team names`);
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
        console.log(`Found ${linkCount} player links, waiting 200ms more...`);
        await new Promise(resolve => setTimeout(resolve, 200));
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
    const timeout = setTimeout(() => controller.abort(), isMobile ? 8000 : 4000);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
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
  
  // RENAMED: This now only adds position and grade columns
  function addPositionAndGrade(table, playerData) {
    const headerRow = table.querySelector('thead tr');
    const bodyRows = table.querySelectorAll('tbody tr');
    
    if (!headerRow || bodyRows.length === 0) return;
    
    const headers = headerRow.querySelectorAll('th');
    let nameIndex = -1;
    
    headers.forEach((header, index) => {
      const headerText = header.textContent.trim();
      if (headerText === 'Name') {
        nameIndex = index;
      }
    });
    
    if (nameIndex === -1) return;
    
    const headerTexts = Array.from(headers).map(h => h.textContent.trim());
    if (headerTexts.includes('Pos') || headerTexts.includes('Grade')) {
      console.log('Table already has position/grade columns, skipping');
      return;
    }
    
    const sampleHeader = headers[0];
    const isGoalieTable = headerTexts.includes('GAA') && headerTexts.includes('SV %');
    console.log(`Adding position/grade columns to ${isGoalieTable ? 'Goalie' : 'Skater'} table`);
    
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
    
    console.log(`Added position/grade to ${matchedCount}/${bodyRows.length} players`);
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
    setTimeout(enhanceLeagueStats, 300);
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
      setTimeout(enhanceLeagueStats, 500);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
})();

/* ===== Stream column for schedule tables ===== */
/*
 * Legacy.Hockey — "Stream" column for SportsEngine schedule tables
 *
 * Adds a Stream column to every schedule table on the page (team schedules
 * and the overall schedule). For each game row it opens that game's detail
 * page (/game/show/<id>) in the background, looks for a video stream link,
 * and shows a "Watch" link if one is found.
 *
 * - Only checks rows as they scroll into view, a few at a time.
 * - Caches results in the visitor's browser so repeat visits are instant.
 * - Re-runs automatically if SportsEngine swaps the table (e.g. subseason tabs).
 */
(function () {
  'use strict';

  var CONFIG = {
    headerLabel: 'Stream',
    insertAfterHeader: 'Location',   // new column goes right after this one; falls back to last column
    linkLabel: '\u25B6 Watch',

    // Once we know exactly how SportsEngine marks the stream on a game page,
    // put that CSS selector here (e.g. '.game-video a') and it will be used instead
    // of the host/keyword detection below.
    streamSelector: '',

    // Optional: CSS selector for the main content area of a game detail page.
    // Limits the search so site-wide header/footer links never count.
    gameContentSelector: '',

    // Links (or embedded players) pointing at these sites count as a stream.
    streamHosts: [
      'nfhsnetwork.com', 'hockeytv.com', 'livebarn.com', 'sportsengineplay.com',
      'youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'boxcast.tv', 'boxcast.com'
    ],

    // Fallback: an off-site link whose text contains one of these also counts.
    linkTextKeywords: ['watch live', 'live stream', 'livestream', 'stream', 'broadcast'],

    positiveCacheHours: 24,  // remember "has a stream" this long
    negativeCacheHours: 1,   // re-check "no stream" games hourly (streams get added late)
    maxConcurrent: 8
  };

  var GAME_LINK = /\/game\/show\/(\d+)/;
  var CACHE_PREFIX = 'lhStream:';
  var EXCLUDE = 'header, footer, nav, [id*="header"], [id*="Header"], [id*="footer"], [id*="Footer"], [class*="social"], [class*="footer"], [class*="Footer"]';
  var queue = [];
  var active = 0;

  /* ---------- cache ---------- */
  function cacheGet(id) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + id);
      if (!raw) return undefined;
      var e = JSON.parse(raw);
      var ttl = (e.url ? CONFIG.positiveCacheHours : CONFIG.negativeCacheHours) * 3600000;
      return (Date.now() - e.t > ttl) ? undefined : e.url;
    } catch (err) { return undefined; }
  }
  function cacheSet(id, url) {
    try { localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ url: url || null, t: Date.now() })); } catch (err) {}
  }

  /* ---------- stream detection ---------- */
  function resolve(href, base) {
    try { return new URL(href, base); } catch (err) { return null; }
  }
  function isStreamHost(u) {
    if (!u) return false;
    var h = u.hostname.replace(/^www\./, '');
    return CONFIG.streamHosts.some(function (s) { return h === s || h.slice(-(s.length + 1)) === '.' + s; });
  }
  function usable(el) { return !el.closest(EXCLUDE); }

  function findStreamUrl(doc, base) {
    var baseHost = resolve(base).hostname;

    if (CONFIG.streamSelector) {
      var el = doc.querySelector(CONFIG.streamSelector);
      if (!el) return null;
      var a = el.matches('a[href]') ? el : el.querySelector('a[href]');
      var f = el.matches('iframe[src]') ? el : el.querySelector('iframe[src]');
      var target = a ? a.getAttribute('href') : (f ? f.getAttribute('src') : null);
      var u = target && resolve(target, base);
      return u ? u.href : base; // stream marked but no link: send viewers to the game page
    }

    var root = (CONFIG.gameContentSelector && doc.querySelector(CONFIG.gameContentSelector)) || doc.body;
    if (!root) return null;

    var links = Array.prototype.filter.call(root.querySelectorAll('a[href]'), usable);
    for (var i = 0; i < links.length; i++) {
      var lu = resolve(links[i].getAttribute('href'), base);
      if (isStreamHost(lu)) return lu.href;
    }
    var frames = Array.prototype.filter.call(root.querySelectorAll('iframe[src]'), usable);
    for (var j = 0; j < frames.length; j++) {
      var fu = resolve(frames[j].getAttribute('src'), base);
      if (isStreamHost(fu)) return base; // embedded player: link to the game page itself
    }
    for (var k = 0; k < links.length; k++) {
      var text = links[k].textContent.toLowerCase();
      var ku = resolve(links[k].getAttribute('href'), base);
      if (ku && ku.hostname !== baseHost &&
          CONFIG.linkTextKeywords.some(function (w) { return text.indexOf(w) !== -1; })) {
        return ku.href;
      }
    }
    return null;
  }

  /* ---------- rendering ---------- */
  function render(td, url) {
    td.textContent = '';
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'lh-stream-link';
    a.textContent = CONFIG.linkLabel;
    a.setAttribute('aria-label', 'Watch stream of this game');
    td.appendChild(a);
  }

  /* ---------- fetch queue ---------- */
  function check(td) {
    var id = td.dataset.gameId;
    var gameUrl = td.dataset.gameUrl;
    return fetch(gameUrl, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var url = findStreamUrl(doc, gameUrl);
        cacheSet(id, url);
        render(td, url);
      })
      .catch(function () { td.textContent = ''; });
  }
  function pump() {
    while (active < CONFIG.maxConcurrent && queue.length) {
      var td = queue.shift();
      active++;
      check(td).then(function () { active--; pump(); });
    }
  }
  function enqueue(td) {
    td.textContent = '\u2026';
    queue.push(td);
    pump();
  }
  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { io.unobserve(e.target); enqueue(e.target); }
        });
      }, { rootMargin: '100px' })
    : null;

  /* ---------- table handling ---------- */
  function processTable(table) {
    if (table.dataset.lhStream) return;
    if (!table.querySelector('a[href*="/game/show/"]')) return;
    table.dataset.lhStream = '1';

    var headRow = (table.tHead && table.tHead.rows[0]) || table.rows[0];
    if (!headRow) return;
    var headers = Array.prototype.slice.call(headRow.cells);
    var colCount = headers.length;
    var idx = -1;
    headers.forEach(function (c, i) {
      if (idx === -1 && c.textContent.trim().toLowerCase() === CONFIG.insertAfterHeader.toLowerCase()) idx = i;
    });
    var insertAt = idx >= 0 ? idx + 1 : colCount;

    var th = document.createElement('th');
    th.textContent = CONFIG.headerLabel;
    th.className = 'lh-stream-col';
    headRow.insertBefore(th, headRow.cells[insertAt] || null);

    Array.prototype.forEach.call(table.rows, function (row) {
      if (row === headRow) return;
      if (row.cells.length < colCount) {           // month divider / spanning row
        var last = row.cells[row.cells.length - 1];
        if (last) last.colSpan += 1;
        return;
      }
      var td = document.createElement('td');
      td.className = 'lh-stream-col';
      row.insertBefore(td, row.cells[insertAt] || null);

      var link = row.querySelector('a[href*="/game/show/"]');
      var m = link && link.getAttribute('href').match(GAME_LINK);
      if (!m) return;

      var cached = cacheGet(m[1]);
      if (cached !== undefined) { render(td, cached); return; }

      td.dataset.gameId = m[1];
      td.dataset.gameUrl = new URL(link.getAttribute('href'), location.href).href;
      if (io) io.observe(td); else enqueue(td);
    });
  }

  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll('table'), processTable);
  }

  /* ---------- styles ---------- */
  var style = document.createElement('style');
  style.textContent =
    '.lh-stream-col{text-align:center;white-space:nowrap}' +
    '.lh-stream-link{font-weight:600;text-decoration:none}' +
    '.lh-stream-link:hover,.lh-stream-link:focus{text-decoration:underline}';
  document.head.appendChild(style);

  /* ---------- start ---------- */
  // Throttle (not debounce): ads and other scripts change the page constantly,
  // and a debounce kept postponing the scan. This scans within 100ms, guaranteed.
  var pending = false;
  function scheduleScan() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; scan(); }, 100);
  }
  function start() {
    scan();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
