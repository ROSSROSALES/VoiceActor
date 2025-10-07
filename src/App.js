import React, { useState } from 'react';
import { Search, User, Tv, ChevronRight } from 'lucide-react';

export default function AnimeVASearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [characterFavoritesCache, setCharacterFavoritesCache] = useState({});
  const [selectedVA, setSelectedVA] = useState(null);
  const [vaDetails, setVADetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('search');

  const searchAnime = async () => {
    if (!searchTerm.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchTerm)}&limit=10`);
      const data = await res.json();
      setSearchResults(data.data || []);
      setView('results');
    } catch (err) {
      console.error('Search error:', err);
    }
    setLoading(false);
  };

  const selectAnime = async (anime) => {
    setSelectedAnime(anime);
    setLoading(true);
    setView('anime');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 350));
      const res = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/characters`);
      const data = await res.json();
      setCharacters(data.data || []);
      
    } catch (err) {
      console.error('Character fetch error:', err);
    }
    setLoading(false);
  };

  const fetchWithRetry = async (url, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          // Rate limited, wait longer and retry
          await new Promise(resolve => setTimeout(resolve, 3000 * (i + 1)));
          continue;
        }
        return res;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Max retries reached');
  };

  const selectVA = async (va, charName) => {
  console.log('selectVA');
  setSelectedVA({ ...va, charName });
  setLoading(true);
  setView('va');
  
  try {
    // Wait 1.5 seconds before starting to let any rate limits clear
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('Starting to fetch voice actor data...');
    
    const res = await fetch(`https://api.jikan.moe/v4/people/${va.person.mal_id}/full`);
    const data = await res.json();
    console.log('Voice actor data loaded');
    
    // Remove duplicates and sort by role importance (Main first, then Supporting)
    const uniqueRoles = data.data.voices
      ?.filter((role, idx, arr) =>    
        arr.findIndex(r => r.character.mal_id === role.character.mal_id) === idx
      ) || [];
    
    // Take top 30 main/supporting roles
    const topRoles = uniqueRoles.slice(0, 30);
    console.log(`Found ${topRoles.length} top roles to fetch`);
    
    // Fetch character favorites for these top roles
    const rolesWithFavorites = [];
    for (let i = 0; i < topRoles.length; i++) {
      const role = topRoles[i];
      console.log(`Fetching character ${i + 1}/${topRoles.length}: ${role.character.name}`);
      
      // Check cache first
      if (characterFavoritesCache[role.character.mal_id] !== undefined) {
        console.log(`✓ Using cached data for ${role.character.name}`);
        rolesWithFavorites.push({
          ...role,
          character: {
            ...role.character,
            favorites: characterFavoritesCache[role.character.mal_id]
          }
        });
      } else {
        // Wait 0.4 seconds before each request
        console.log(`Waiting 0.5 seconds before fetching...`);
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // Fetch if not in cache
        try {
          //console.log(`Fetching from API: ${role.character.mal_id}`);
          const charRes = await fetchWithRetry(`https://api.jikan.moe/v4/characters/${role.character.mal_id}/full`);
          const charData = await charRes.json();
          const favorites = charData.data.favorites || 0;
          setCharacterFavoritesCache(prev => ({ ...prev, [role.character.mal_id]: favorites }));
          rolesWithFavorites.push({
            ...role,
            character: {
              ...role.character,
              favorites
            }
          });
          console.log(`✓ Fetched ${role.character.name}: ${favorites} favorites`);
        } catch (err) {
          console.error(`✗ Error fetching character ${role.character.name}:`, err);
          rolesWithFavorites.push({ ...role, character: { ...role.character, favorites: 0 } });
        }
      }
    }
    
    // Sort by character favorites
    const sortedByFavorites = rolesWithFavorites.sort((a, b) => {
      return (b.character.favorites || 0) - (a.character.favorites || 0);
    });
    
    console.log('All characters loaded and sorted!');
    setVADetails({
      ...data.data,
      voices: sortedByFavorites
    });
  } catch (err) {
    console.error('VA fetch error:', err);
  }
  setLoading(false);
};

  const resetSearch = () => {
    setView('search');
    setSearchTerm('');
    setSearchResults([]);
    setSelectedAnime(null);
    setCharacters([]);
    setCharacterFavoritesCache({});
    setSelectedVA(null);
    setVADetails(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="max-w-4xl mx-auto p-4 pb-20">
        {/* Header */}
        <div className="text-center py-6">
          <h1 className="text-4xl font-bold text-white mb-2">Anime Voice Actors</h1>
          <p className="text-purple-200">Discover characters and their voice actors</p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchAnime()}
                placeholder="Search for an anime..."
                className="w-full px-4 py-3 pl-12 rounded-lg bg-white/10 backdrop-blur-md border border-white/20 text-white placeholder-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <Search className="absolute left-4 top-3.5 text-purple-200" size={20} />
            </div>
            <button
              onClick={searchAnime}
              disabled={loading}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
            >
              Search
            </button>
          </div>
          {view !== 'search' && (
            <button
              onClick={resetSearch}
              className="mt-3 text-purple-200 hover:text-white transition text-sm"
            >
              ← New Search
            </button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-400 border-t-transparent"></div>
            <p className="text-purple-200 mt-4">Loading...</p>
          </div>
        )}

        {/* Search Results */}
        {view === 'results' && !loading && searchResults.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-white mb-4">Search Results</h2>
            {searchResults.map((anime) => (
              <div
                key={anime.mal_id}
                onClick={() => selectAnime(anime)}
                className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20 hover:bg-white/20 transition cursor-pointer flex items-center gap-4"
              >
                <img
                  src={anime.images.jpg.image_url}
                  alt={anime.title}
                  className="w-16 h-24 object-cover rounded"
                />
                <div className="flex-1">
                  <h3 className="text-white font-semibold text-lg">{anime.title}</h3>
                  <p className="text-purple-200 text-sm">
                    {anime.type} • {anime.episodes ? `${anime.episodes} episodes` : 'Ongoing'}
                  </p>
                  <p className="text-purple-200 text-sm">★ {anime.score || 'N/A'}</p>
                </div>
                <ChevronRight className="text-purple-200" size={24} />
              </div>
            ))}
          </div>
        )}

        {/* Anime Characters */}
        {view === 'anime' && selectedAnime && !loading && (
          <div>
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 border border-white/20 mb-6">
              <div className="flex gap-4 items-start">
                <img
                  src={selectedAnime.images.jpg.image_url}
                  alt={selectedAnime.title}
                  className="w-24 h-36 object-cover rounded"
                />
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">{selectedAnime.title}</h2>
                  <p className="text-purple-200 text-sm">{selectedAnime.synopsis?.slice(0, 200)}...</p>
                </div>
              </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <User size={20} />
              Characters & Voice Actors
            </h3>
            
            <div className="space-y-3">
              {characters.filter(c => c.voice_actors?.length > 0).map((char) => (
                <div key={char.character.mal_id} className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
                  <div className="flex items-center gap-4 mb-3">
                    <img
                      src={char.character.images.jpg.image_url}
                      alt={char.character.name}
                      className="w-14 h-14 object-cover rounded-full"
                    />
                    <div className="flex-1">
                      <h4 className="text-white font-semibold">{char.character.name}</h4>
                      <p className="text-purple-200 text-sm">{char.role}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2 pl-4">
                    {char.voice_actors.filter(va => va.language === 'Japanese').map((va) => (
                      <div
                        key={va.person.mal_id}
                        onClick={() => selectVA(va, char.character.name)}
                        className="bg-white/5 rounded-lg p-3 flex items-center gap-3 hover:bg-white/10 transition cursor-pointer"
                      >
                        <img
                          src={va.person.images.jpg.image_url}
                          alt={va.person.name}
                          className="w-10 h-10 object-cover rounded-full"
                        />
                        <div className="flex-1">
                          <p className="text-white font-medium text-sm">{va.person.name}</p>
                          <p className="text-purple-200 text-xs">{va.language}</p>
                        </div>
                        <ChevronRight className="text-purple-200" size={18} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Voice Actor Details */}
        {view === 'va' && selectedVA && vaDetails && !loading && (
          <div>
            <button
              onClick={() => setView('anime')}
              className="mb-4 text-purple-200 hover:text-white transition text-sm"
            >
              ← Back to Characters
            </button>

            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 border border-white/20 mb-6">
              <div className="flex gap-4 items-start mb-4">
                <img
                  src={vaDetails.images.jpg.image_url}
                  alt={vaDetails.name}
                  className="w-24 h-24 object-cover rounded-full"
                />
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">{vaDetails.name}</h2>
                  <p className="text-purple-200 text-sm">Voice Actor / Seiyuu</p>
                  <p className="text-purple-200 text-sm">Birthday: {vaDetails.birthday || 'N/A'}</p>
                </div>
              </div>
              <p className="text-purple-200 text-sm">{vaDetails.about?.slice(0, 300)}...</p>
            </div>

            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Tv size={20} />
              Popular Roles ({vaDetails.voices?.length || 0})
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vaDetails.voices
                ?.sort((a, b) => {
                  const favoritesA = a.character.favorites || 0;
                  const favoritesB = b.character.favorites || 0;
                  return favoritesB - favoritesA;
                })
                .filter((role, idx, arr) => 
                  arr.findIndex(r => r.character.mal_id === role.character.mal_id) === idx
                )
                .slice(0, 12)
                .map((role, idx) => (
                <div key={idx} className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
                  <div className="flex gap-3">
                    <img
                      src={role.character.images.jpg.image_url}
                      alt={role.character.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white font-semibold text-sm truncate">{role.character.name}</h4>
                      <p className="text-purple-200 text-xs truncate">{role.anime.title}</p>
                      <p className="text-purple-300 text-xs">{role.role}</p>
                      {role.character.favorites > 0 && (
                        <p className="text-yellow-300 text-xs">♥ {role.character.favorites.toLocaleString()} favorites</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty States */}
        {view === 'results' && !loading && searchResults.length === 0 && searchTerm && (
          <div className="text-center py-12">
            <p className="text-purple-200">No results found. Try a different search term.</p>
          </div>
        )}
      </div>
    </div>
  );
}
