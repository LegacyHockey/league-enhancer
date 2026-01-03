(function(){
  'use strict';
  
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  let allPlayerData = {};
  let isEnhancing = false;
  
  // Teams to exclude (North Dakota schools, etc.)
  const EXCLUDED_TEAMS = ['Mayville/Portland'];
  
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
    
    isEnhancing = true;
    
    const seasonMatch = location.href.match(/subseason=(\d+)/);
    if (!seasonMatch) {
      isEnhancing = false;
      return;
    }
    
    const season = seasonMatch[1];
    
    // Load data if not already loaded
    if (Object.keys(allPlayerData).length === 0) {
      const cacheKey = `league_mn_v2_${season}`;
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
    await waitForTables();
    
    // Filter out excluded teams and enhance tables
    filterExcludedTeams();
    
    // Enhance all stats tables
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(h => h.textContent.trim());
      if (headers.includes('#') && headers.includes('Name') && headers.includes('Team')) {
        enhanceTable(table, allPlayerData);
      }
    });
    
    isEnhancing = false;
  }
  
  function filterExcludedTeams() {
    // Remove rows for excluded teams
    document.querySelectorAll('table tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;
      
      // Find the Team column
      cells.forEach(cell => {
        const teamLink = cell.querySelector('a[href*="/page/show/"]');
        if (teamLink) {
          const teamName = teamLink.textContent.t
