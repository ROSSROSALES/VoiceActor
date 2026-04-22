import React, { useState, useRef } from 'react';
import { Search, User, Tv, ChevronRight } from 'lucide-react';

export default function AnimeVASearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [selectedVA, setSelectedVA] = useState(null);
  const [vaDetails, setVADetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [vaRolesLoading, setVARolesLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [view, setView] = useState('search');

  // Refs keep cache values current inside async callbacks (avoids stale closure on useState).
  const characterFavoritesCacheRef = useRef({});
  const vaDetailsCacheRef = useRef({});
  // Flip to true to stop a running background prefetch immediately.
  const prefetchAbortRef = useRef(false);

  const searchAnime = async () => {
    if (!searchTerm.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchTerm)}&limit=10`);
      const data = await res.json();
      setSearchResults(data.data || []);
      setView('results');
    } catch (err) {
      setError('Failed to search anime. Please try again.');
    }
    setLoading(false);
  };

  const selectAnime = async (anime) => {
    prefetchAbortRef.current = true; // stop any prefetch from a previous anime
    setSelectedAnime(anime);
    setLoading(true);
    setError(null);
    setView('anime');

    try {
      const res = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/characters`);
      const data = await res.json();
      const chars = data.data || [];
      setCharacters(chars);
      prefetchVAsForAnime(chars); // fire-and-forget background prefetch
    } catch (err) {
      setError('Failed to load characters. Please try again.');
    }
    setLoading(false);
  };

  const fetchWithRetry = async (url, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
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

  // Fetches character favorites for up to maxRoles roles in batches of 3.
  // abortRef: pass prefetchAbortRef for background use; null for foreground (never aborts).
  // onProgress: optional callback(batchStart, batchEnd, total) for UI progress updates.
  // Returns sorted roles array, or null if aborted mid-flight.
  const fetchRolesWithFavorites = async (rawRoles, maxRoles, abortRef, onProgress) => {
    const uniqueRoles = rawRoles.filter((role, idx, arr) =>
      arr.findIndex(r => r.character.mal_id === role.character.mal_id) === idx
    );
    const targetRoles = uniqueRoles.slice(0, maxRoles);

    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 1100;
    const rolesWithFavorites = [];

    for (let batchIndex = 0; batchIndex < targetRoles.length; batchIndex += BATCH_SIZE) {
      if (abortRef?.current) return null;

      const batch = targetRoles.slice(batchIndex, batchIndex + BATCH_SIZE);
      const batchStart = batchIndex + 1;
      const batchEnd = Math.min(batchIndex + BATCH_SIZE, targetRoles.length);

      if (onProgress) onProgress(batchStart, batchEnd, targetRoles.length);

      const batchResults = await Promise.all(
        batch.map(async (role) => {
          const cached = characterFavoritesCacheRef.current[role.character.mal_id];
          if (cached !== undefined) {
            return { ...role, character: { ...role.character, favorites: cached } };
          }
          try {
            const charRes = await fetchWithRetry(
              `https://api.jikan.moe/v4/characters/${role.character.mal_id}/full`
            );
            const charData = await charRes.json();
            const favorites = charData.data.favorites || 0;
            characterFavoritesCacheRef.current[role.character.mal_id] = favorites;
            return { ...role, character: { ...role.character, favorites } };
          } catch {
            return { ...role, character: { ...role.character, favorites: 0 } };
          }
        })
      );

      if (abortRef?.current) return null;

      rolesWithFavorites.push(...batchResults);

      if (batchEnd < targetRoles.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return rolesWithFavorites.sort(
      (a, b) => (b.character.favorites || 0) - (a.character.favorites || 0)
    );
  };

  // Background: pre-fetches full VA data for every Japanese VA in the character list.
  // Main-role VAs are prioritised. Uses 50 roles per VA for more accurate rankings.
  // Results are stored in vaDetailsCacheRef so selectVA can serve them instantly.
  //
  // EXIT PLAN: remove the prefetchVAsForAnime(chars) call in selectAnime to revert to
  // pure on-demand loading. This function and vaDetailsCacheRef can then be deleted.
  const prefetchVAsForAnime = async (characters) => {
    prefetchAbortRef.current = false;

    // Build a queue of unique Japanese VAs, Main characters first
    const seen = new Set();
    const vaQueue = [];
    const prioritized = [...characters].sort((a, b) =>
      a.role === 'Main' && b.role !== 'Main' ? -1 : b.role === 'Main' ? 1 : 0
    );
    for (const char of prioritized) {
      for (const va of (char.voice_actors || [])) {
        if (va.language === 'Japanese' && !seen.has(va.person.mal_id)) {
          seen.add(va.person.mal_id);
          vaQueue.push(va);
        }
      }
    }

    for (const va of vaQueue) {
      if (prefetchAbortRef.current) return;

      const mal_id = va.person.mal_id;
      if (vaDetailsCacheRef.current[mal_id]) continue; // already cached

      try {
        const res = await fetchWithRetry(`https://api.jikan.moe/v4/people/${mal_id}/full`);
        if (prefetchAbortRef.current) return;

        const data = await res.json();
        const sortedRoles = await fetchRolesWithFavorites(
          data.data.voices || [], 50, prefetchAbortRef, null
        );
        if (!sortedRoles || prefetchAbortRef.current) return;

        vaDetailsCacheRef.current[mal_id] = { ...data.data, voices: sortedRoles };
      } catch {
        // Skip this VA on error and continue to the next
      }

      if (!prefetchAbortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }
  };

  const selectVA = async (va, charName) => {
    const mal_id = va.person.mal_id;

    // Instant render: VA was pre-fetched in the background
    if (vaDetailsCacheRef.current[mal_id]) {
      setSelectedVA({ ...va, charName });
      setVADetails(vaDetailsCacheRef.current[mal_id]);
      setView('va');
      return;
    }

    // Cache miss: stop background prefetch so it doesn't compete for rate-limit
    // bandwidth, then do a focused on-demand fetch for just this VA.
    prefetchAbortRef.current = true;
    setSelectedVA({ ...va, charName });
    setLoading(true);
    setError(null);
    setView('va');

    try {
      const res = await fetch(`https://api.jikan.moe/v4/people/${mal_id}/full`);
      const data = await res.json();

      // Show profile immediately — don't wait for roles
      setVADetails({ ...data.data, voices: [] });
      setLoading(false);
      setVARolesLoading(true);

      try {
        const sortedRoles = await fetchRolesWithFavorites(
          data.data.voices || [],
          20,
          null,
          (start, end, total) =>
            setLoadingMessage(`Loading popular roles ${start}–${end} of ${total}...`)
        );
        const vaData = { ...data.data, voices: sortedRoles || [] };
        vaDetailsCacheRef.current[mal_id] = vaData;
        setVADetails(vaData);
      } catch {
        // Profile loaded fine — show it without roles rather than erroring
      } finally {
        setVARolesLoading(false);
        setLoadingMessage('');
      }
    } catch (err) {
      setLoading(false);
      setError('Failed to load voice actor details. Please try again.');
    }
  };

  const resetSearch = () => {
    prefetchAbortRef.current = true; // stop any running prefetch
    setView('search');
    setSearchTerm('');
    setSearchResults([]);
    setSelectedAnime(null);
    setCharacters([]);
    setSelectedVA(null);
    setVADetails(null);
    setError(null);
    setLoadingMessage('');
    setVARolesLoading(false);
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
                onKeyDown={(e) => e.key === 'Enter' && searchAnime()}
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
            <p className="text-purple-200 mt-4">{loadingMessage || 'Loading...'}</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-500/20 border border-red-400/40 rounded-lg p-4 mb-4">
            <p className="text-red-200 text-sm">{error}</p>
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
              Popular Roles {!vaRolesLoading && `(${vaDetails.voices?.length || 0})`}
              {vaRolesLoading && (
                <span className="flex items-center gap-1.5 text-purple-300 text-sm font-normal ml-1">
                  <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  {loadingMessage || 'loading...'}
                </span>
              )}
            </h3>

            {vaRolesLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 12 }).map((_, idx) => (
                  <div key={idx} className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20 animate-pulse">
                    <div className="flex gap-3">
                      <div className="w-16 h-16 bg-white/20 rounded flex-shrink-0" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="h-3 bg-white/20 rounded w-3/4" />
                        <div className="h-3 bg-white/20 rounded w-1/2" />
                        <div className="h-3 bg-white/20 rounded w-1/4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!vaRolesLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {vaDetails.voices?.slice(0, 12).map((role, idx) => (
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
            )}
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
