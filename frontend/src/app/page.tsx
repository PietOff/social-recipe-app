'use client';

import React, { useState } from 'react';
import { Recipe } from '../types';
import styles from './page.module.css';
import { auth, db } from '../firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  deleteDoc,
  query,
  where,
  setDoc
} from 'firebase/firestore';
import { apiPost } from '../lib/api';
import {
  saveRecipeToCloud,
  recipeKey,
  isSameRecipe,
  videoIdFromUrl,
  thumbnailSrc,
  loadFailedImportIds,
  clearFailedImportIds,
} from '../lib/recipes';
import { useCollectionImport, CollectionVideo } from '../hooks/useCollectionImport';
import { addPendingSync, flushPendingSync, loadPendingSync, mergeSynced } from '../lib/sync';
import { MOOD_CHIPS, recommendFromCookbook, Suggestion } from '../lib/recommend';
import { hasLabel, labelFacets, labelValues } from '../lib/labels';
import { exportRecipesToPdf } from '../lib/printExport';

interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  token: string;
}

function HomeContent() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([]);
  const savedRecipesRef = React.useRef<Recipe[]>([]);

  // Collection import state
  const [collectionVideos, setCollectionVideos] = useState<CollectionVideo[] | null>(null);
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [importedVideoIds, setImportedVideoIds] = useState<Set<string>>(new Set());
  // Videos that previously extracted to zero ingredients; skipped on later runs.
  const [failedVideoIds, setFailedVideoIds] = useState<Set<string>>(new Set());
  const { progress: importProgress, start: startImport, cancel: cancelImport, resume: resumeImport, dismiss: dismissImport, resumable } = useCollectionImport();
  const cookbookScrollY = React.useRef(0);
  const [cookbookLoading, setCookbookLoading] = useState(false);
  const [cookbookError, setCookbookError] = useState<string | null>(null);
  // Recipes that were saved while signed in but never reached Firestore.
  const [pendingSync, setPendingSync] = useState<Recipe[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);

  // Mirrors savedRecipes for callbacks that outlive the render they were made in.
  React.useEffect(() => { savedRecipesRef.current = savedRecipes; }, [savedRecipes]);

  // Close user menu on outside click
  React.useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

  // Validate that a URL points to a supported recipe source before hitting the API.
  const isSupportedRecipeUrl = (raw: string): boolean => {
    try {
      const host = new URL(raw.trim()).hostname.replace(/^www\./, '').toLowerCase();
      const supported = [
        'tiktok.com', 'vm.tiktok.com',
        'instagram.com',
        'youtube.com', 'youtu.be', 'm.youtube.com',
      ];
      return supported.some(d => host === d || host.endsWith('.' + d));
    } catch {
      return false;
    }
  };

  // Load saved recipes and user on mount
  React.useEffect(() => {
    // 0. Load previously imported TikTok video IDs to avoid redundant Groq calls
    const storedIds = localStorage.getItem('chefSocial_imported_video_ids');
    if (storedIds) {
      try { setImportedVideoIds(new Set(JSON.parse(storedIds))); } catch { /* ignore */ }
    }
    setFailedVideoIds(loadFailedImportIds());
    setPendingSync(loadPendingSync());

    // 1. Immediately hydrate from cache (for instant visibility)
    const cachedCookbook = localStorage.getItem('chefSocial_cached_cookbook');
    if (cachedCookbook) {
      try {
        setSavedRecipes(JSON.parse(cachedCookbook));
      } catch (e) {
        console.error('Failed to parse cached cookbook', e);
      }
    }

    // 2. Listen to Auth State
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        const userData = {
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || '',
          avatar_url: firebaseUser.photoURL || '',
          token: token
        };
        setUser(userData);
        localStorage.setItem('chefSocial_user', JSON.stringify(userData));
        fetchCloudRecipes(firebaseUser.uid);
      } else {
        setUser(null);
        localStorage.removeItem('chefSocial_user');
        // If not logged in, load from local cookbook
        const saved = localStorage.getItem('chefSocial_cookbook');
        if (saved && !cachedCookbook) {
          try {
            setSavedRecipes(JSON.parse(saved));
          } catch (e) {
            console.error('Failed to load old cookbook', e);
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const fetchCloudRecipes = async (uid: string) => {
    setCookbookLoading(true);
    setCookbookError(null);
    try {
      const q = query(collection(db, 'recipes'), where('user_id', '==', uid));
      const querySnapshot = await getDocs(q);
      const recipes: Recipe[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        recipes.push({
          id: doc.id,
          title: data.title,
          description: data.description || '',
          ingredients: data.ingredients || [],
          instructions: data.instructions || [],
          tags: data.tags || [],
          image_url: data.image_url || null,
          prep_time: data.prep_time || null,
          cook_time: data.cook_time || null,
          servings: data.servings || null,
          source_url: data.source_url || null,
          video_id: data.video_id || null,
        });
      });
      // An empty result is only trustworthy when it came from the server AND we
      // had nothing to begin with.
      //
      // getDocs() falls back to the SDK's offline cache when it cannot reach
      // Firestore, and resolves successfully - so a moment of bad signal on a
      // phone yields an EMPTY snapshot with no error, indistinguishable from
      // "this account has no recipes". The old code then wrote that emptiness
      // over chefSocial_cached_cookbook, destroying the only local copy. That is
      // how a 318-recipe cookbook rendered as "No recipes saved yet".
      const known = savedRecipesRef.current;
      if (recipes.length === 0 && known.length > 0) {
        setCookbookError(
          querySnapshot.metadata.fromCache
            ? 'Could not reach the database just now - showing your saved copy. Pull down to retry.'
            : `The database returned no recipes, but ${known.length} are saved on this device. ` +
              'Keeping them rather than clearing your cookbook - reload to try again.',
        );
        return; // Leave savedRecipes and the cache exactly as they are.
      }

      // Sort client-side (no index required)
      setSavedRecipes(recipes);
      if (!querySnapshot.metadata.fromCache || recipes.length > 0) {
        localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(recipes));
      }

      // Hydrate imported IDs from the cloud to prevent duplicates across devices
      const cloudIds = new Set(
        recipes.map(r => r.video_id || videoIdFromUrl(r.source_url) || r.source_url).filter(Boolean) as string[]
      );
      setImportedVideoIds(prev => new Set([...prev, ...cloudIds]));

      // The database is reachable, so anything stuck in the queue can go up now.
      await retryPendingSync(uid, recipes);
    } catch (e: any) {
      console.error('Failed to fetch cloud recipes', e);
      if (e.code === 'permission-denied') {
        setCookbookError('Database permission denied. Please verify your Firestore Security Rules allow read access.');
      } else {
        setCookbookError('Could not reach the database. Showing cached data.');
      }
    } finally {
      setCookbookLoading(false);
    }
  };

  /**
   * Re-pushes recipes whose cloud write failed earlier. Saves are idempotent
   * (deterministic doc ids), so a recipe that did land is simply overwritten.
   */
  const retryPendingSync = async (uid: string, base?: Recipe[]) => {
    if (loadPendingSync().length === 0) {
      setPendingSync([]);
      return;
    }
    setSyncing(true);
    try {
      const { synced, remaining, lastError } = await flushPendingSync(uid);
      setPendingSync(remaining);
      if (synced.length > 0) {
        setSavedRecipes(prev => {
          const next = mergeSynced(base ?? prev, synced);
          localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(next));
          return next;
        });
      }
      if (remaining.length > 0) {
        setCookbookError(
          `${remaining.length} recipe${remaining.length === 1 ? '' : 's'} could not be saved to the cloud` +
          `${lastError ? ` (${lastError})` : ''}. They are on this device only.`,
        );
      } else if (synced.length > 0) {
        setCookbookError(null);
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;
      
      const token = await firebaseUser.getIdToken();
      const userData = {
        id: firebaseUser.uid,
        email: firebaseUser.email || '',
        name: firebaseUser.displayName || '',
        avatar_url: firebaseUser.photoURL || '',
        token: token
      };
      setUser(userData);
      localStorage.setItem('chefSocial_user', JSON.stringify(userData));

      // Migrate local recipes to Cloud Firestore
      const localRecipes = localStorage.getItem('chefSocial_cookbook');
      if (localRecipes) {
        try {
          const recipes: Recipe[] = JSON.parse(localRecipes);
          for (const r of recipes) {
            await saveRecipeToCloud(firebaseUser.uid, r);
          }
          localStorage.removeItem('chefSocial_cookbook'); // Clear local after migration
        } catch (e) {
          console.error('Migration failed:', e);
          setCookbookError('Some recipes from this device could not be uploaded. They are still saved locally.');
        }
      }

      // Fetch all cloud recipes
      await fetchCloudRecipes(firebaseUser.uid);
    } catch (e: any) {
      if (e.code === 'auth/unauthorized-domain') {
        setError(`Login failed: This domain (${window.location.hostname}) is not authorized in your Firebase Console. Please add it under Authentication > Settings > Authorized domains.`);
      } else if (e.code === 'auth/operation-not-allowed') {
        setError('Login failed: Google Sign-in is not enabled. Please enable it in the Firebase Console under Authentication > Sign-in method.');
      } else {
        setError(`Login failed: ${e.message}`);
      }
      console.error('Google login error', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    try {
      await signOut(auth);
      setUser(null);
      localStorage.removeItem('chefSocial_user');
      localStorage.removeItem('chefSocial_cached_cookbook');
      setSavedRecipes([]);
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  const handleExportCookbook = () => {
    setUserMenuOpen(false);
    const data = JSON.stringify(savedRecipes, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chefsocial-cookbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearImportCache = () => {
    setUserMenuOpen(false);
    setImportedVideoIds(new Set());
    localStorage.removeItem('chefSocial_imported_video_ids');
    // Also forget videos that failed with "no ingredients", so they get retried.
    clearFailedImportIds();
    setFailedVideoIds(new Set());
  };

  const saveRecipe = async (recipeToSave: Recipe) => {
    // Identity is video_id / source_url / doc id - NOT the title. Keying on the
    // title meant two recipes called "Chicken Curry" clobbered each other.
    const isAlreadySaved = savedRecipes.some(r => isSameRecipe(r, recipeToSave));

    if (isAlreadySaved) {
      const recipeToDelete = savedRecipes.find(r => isSameRecipe(r, recipeToSave));
      const newSaved = savedRecipes.filter(r => !isSameRecipe(r, recipeToSave));
      setSavedRecipes(newSaved);

      if (!user) {
        localStorage.setItem('chefSocial_cookbook', JSON.stringify(newSaved));
      } else if (recipeToDelete?.id) {
        try {
          await deleteDoc(doc(db, 'recipes', recipeToDelete.id));
          localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(newSaved));
        } catch (e) {
          console.error('Failed to delete from Firestore', e);
        }
      }
    } else {
      // Optimistic update
      const optimistic = [recipeToSave, ...savedRecipes];
      setSavedRecipes(optimistic);

      if (user) {
        try {
          const savedRecipe = await saveRecipeToCloud(user.id, recipeToSave);
          setSavedRecipes(prev => {
            const next = [savedRecipe, ...prev.filter(r => !isSameRecipe(r, recipeToSave))];
            // Write the cache from the value we just computed. The old code
            // serialised the pre-update `savedRecipes` closure, so the cache drifted.
            localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(next));
            return next;
          });
        } catch (e) {
          // Never silently: a save that only reached localStorage looks
          // identical to a real one until you open the app on another device.
          console.error('Cloud save failed, kept locally', e);
          localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(optimistic));
          setPendingSync(addPendingSync(recipeToSave));
          setCookbookError(
            `"${recipeToSave.title || 'Recipe'}" saved on this device only - it could not reach the cloud, ` +
            `so it will not show up on your other devices yet.`,
          );
        }
      } else {
        localStorage.setItem('chefSocial_cookbook', JSON.stringify(optimistic));
      }
    }
  };

  const handleSuggest = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (savedRecipes.length === 0) return;
    setSuggestLoading(true);
    setSuggestError(null);
    setHasSuggested(true);
    try {
      const result = await recommendFromCookbook(savedRecipes, [...selectedMoods], moodText.trim());
      setSuggestions(result.results);
      setSuggestIntro(result.intro);
      setSuggestConsidered({ considered: result.considered, total: result.total });
    } catch (err: any) {
      setSuggestions([]);
      setSuggestIntro('');
      setSuggestError(err?.message || 'Could not get a suggestion right now.');
    } finally {
      setSuggestLoading(false);
    }
  };

  const clearMood = () => {
    setSelectedMoods(new Set());
    setMoodText('');
    setSuggestions([]);
    setSuggestIntro('');
    setSuggestError(null);
    setHasSuggested(false);
  };

  const extractSingleRecipe = async (videoUrl: string): Promise<Recipe> =>
    apiPost<Recipe>('/extract-recipe', { url: videoUrl.trim() });

  /** Merges a recipe saved by the background import into local state + cache. */
  const mergeImportedRecipe = React.useCallback((saved: Recipe) => {
    setSavedRecipes(prev => {
      const next = [saved, ...prev.filter(r => !isSameRecipe(r, saved))];
      try {
        localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(next));
      } catch { /* quota */ }
      return next;
    });
    const key = saved.video_id || videoIdFromUrl(saved.source_url) || saved.source_url;
    if (key) {
      setImportedVideoIds(prev => {
        const next = new Set(prev).add(key);
        try {
          localStorage.setItem('chefSocial_imported_video_ids', JSON.stringify([...next]));
        } catch { /* quota */ }
        return next;
      });
    }
  }, []);

  const handleImportCollection = () => {
    if (!collectionVideos || !user) return;
    const toImport = collectionVideos.filter(v => selectedVideoIds.has(v.video_id ?? v.url));
    if (toImport.length === 0) return;

    setCollectionVideos(null);
    setCollectionTitle(null);
    setSelectedVideoIds(new Set());
    setView('cookbook');

    // The loop runs here in the tab rather than as a server background task.
    // Recipes stream into the cookbook as they finish.
    startImport(user.id, toImport, mergeImportedRecipe);
  };

  const handleResumeImport = () => resumeImport(mergeImportedRecipe);

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    if (!isSupportedRecipeUrl(url)) {
      setError('Please paste a TikTok, Instagram or YouTube link.');
      return;
    }

    setLoading(true);
    setError(null);
    setRecipe(null);
    setCollectionVideos(null);
    setCollectionTitle(null);

    try {
      let collectionData: { is_collection?: boolean; count?: number; videos?: CollectionVideo[]; collection_title?: string } | null = null;
      try {
        collectionData = await apiPost('/extract-collection', { url: url.trim() });
      } catch {
        collectionData = null; // not a collection - fall through to single extraction
      }

      {
        if (collectionData && collectionData.is_collection && (collectionData.count ?? 0) > 0) {
          const videos: CollectionVideo[] = collectionData.videos ?? [];
          setCollectionVideos(videos);
          setCollectionTitle(collectionData.collection_title || 'Collection');
          setLoading(false);

          setClassifying(true);
          // Fresh read: an import may have recorded new failures since mount.
          const failedNow = loadFailedImportIds();
          setFailedVideoIds(failedNow);
          const withoutFailed = (ids: Set<string>) => new Set([...ids].filter(k => !failedNow.has(k)));
          const selectAll = () => withoutFailed(new Set(videos.map(v => v.video_id ?? v.url)));
          try {
            // Chunked: asking one LLM call to emit hundreds of JSON objects
            // risks truncation, which silently marked every video as a recipe.
            const CHUNK = 50;
            const chunks: CollectionVideo[][] = [];
            for (let i = 0; i < videos.length; i += CHUNK) chunks.push(videos.slice(i, i + CHUNK));

            const settled = await Promise.allSettled(
              chunks.map(chunk =>
                apiPost<{ results: { video_id: string; is_recipe: boolean }[] }>(
                  '/classify-recipes',
                  { videos: chunk.map(v => ({ video_id: v.video_id, title: v.title })) },
                )
              )
            );

            const recipeIds = new Set<string>();
            settled.forEach((outcome, i) => {
              if (outcome.status === 'fulfilled') {
                outcome.value.results
                  .filter(r => r.is_recipe)
                  .forEach(r => recipeIds.add(r.video_id));
              } else {
                // Don't silently drop a chunk we couldn't classify - select it all.
                chunks[i].forEach(v => recipeIds.add(v.video_id ?? v.url));
              }
            });
            setSelectedVideoIds(recipeIds.size > 0 ? withoutFailed(recipeIds) : selectAll());
          } catch {
            setSelectedVideoIds(selectAll());
          } finally {
            setClassifying(false);
          }
          return;
        }
      }

      const data = await extractSingleRecipe(url);
      setRecipe(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!recipe) return;
    if (confirm("Are you sure you want to delete this recipe?")) {
      const updated = savedRecipes.filter(r => !isSameRecipe(r, recipe));
      setSavedRecipes(updated);

      if (user) {
        localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(updated));
        if (recipe.id) {
          try {
            await deleteDoc(doc(db, 'recipes', recipe.id));
          } catch (e) { console.error("Firestore delete failed", e); }
        }
      } else {
        localStorage.setItem('chefSocial_cookbook', JSON.stringify(updated));
      }

      setRecipe(null);
      setView('cookbook');
    }
  };

  // Renders a clean printable document in a hidden iframe instead of
  // window.print() on the live page, which produced broken/blank output.
  const handlePrint = () => {
    if (recipe) exportRecipesToPdf([recipe]);
  };

  const handleExportPdf = (recipesToExport: Recipe[], cookbook: boolean) => {
    if (recipesToExport.length === 0) return;
    exportRecipesToPdf(recipesToExport, { cookbook, title: 'My Cookbook' });
  };

  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const shareLinkRef = React.useRef<HTMLInputElement>(null);

  const copyShareLink = (link: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      }).catch(() => fallbackCopy(link));
    } else {
      fallbackCopy(link);
    }
  };

  const fallbackCopy = (link: string) => {
    // The visible input may not be mounted yet when auto-copy fires right
    // after link creation, so copy from a temporary off-screen textarea.
    const input = shareLinkRef.current;
    let copied = false;
    if (input) {
      input.select();
      input.setSelectionRange(0, 99999);
      copied = document.execCommand('copy');
    }
    if (!copied) {
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand('copy');
      ta.remove();
    }
    if (copied) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    }
  };

  const handleShare = async (recipesToShare: Recipe[]) => {
    if (!user) { setError('Sign in to share recipes.'); return; }
    setShareLoading(true);
    try {
      // Math.random() is not cryptographically secure - its PRNG state is
      // recoverable from a few outputs, which made share links guessable.
      const shareToken = crypto.randomUUID().replace(/-/g, '');

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      // Firestore rejects any object containing `undefined` field values, and
      // freshly extracted recipes have optional fields left undefined - which
      // made this write throw and no link was ever created. The JSON
      // round-trip strips them.
      const cleanRecipes: Recipe[] = JSON.parse(JSON.stringify(recipesToShare));
      await setDoc(doc(db, 'shared_links', shareToken), {
        recipes: cleanRecipes,
        created_by: user.id,
        created_at: Date.now(),
        expires_at: Date.now() + THIRTY_DAYS
      });

      const link = `${window.location.origin}/share/${shareToken}`;
      setShareLink(link);
      setTimeout(() => copyShareLink(link), 50);
    } catch (e: any) {
      setError(`Failed to create share link: ${e.message}`);
    } finally {
      setShareLoading(false);
    }
  };

  // --- VIEW STATE ---
  const [view, setView] = useState<'home' | 'cookbook' | 'details' | 'suggest'>('home');

  // --- "What am I feeling like?" ---
  const [selectedMoods, setSelectedMoods] = useState<Set<string>>(new Set());
  const [moodText, setMoodText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestIntro, setSuggestIntro] = useState('');
  const [suggestConsidered, setSuggestConsidered] = useState<{ considered: number; total: number } | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [hasSuggested, setHasSuggested] = useState(false);
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const moodInputRef = React.useRef<HTMLInputElement>(null);

  // Close the open recipe / collection overlay on Escape
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (recipe) {
        setRecipe(null);
        if (view === 'details') {
          setView('cookbook');
          setTimeout(() => window.scrollTo({ top: cookbookScrollY.current, behavior: 'smooth' }), 50);
        }
      } else if (collectionVideos) {
        setCollectionVideos(null);
        setCollectionTitle(null);
        setSelectedVideoIds(new Set());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [recipe, collectionVideos, view]);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  // --- FILTERING & BILINGUAL SEARCH ---
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Filter chips are derived from the saved recipes (own tags plus labels
  // inferred from times, ingredients and method), ordered by coverage.
  const cookbookFacets = React.useMemo(() => labelFacets(savedRecipes), [savedRecipes]);

  // A chip can disappear when the cookbook changes; drop the filter rather than
  // leaving the grid mysteriously empty.
  React.useEffect(() => {
    if (selectedCategory !== 'All' && !cookbookFacets.some(f => f.value === selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [cookbookFacets, selectedCategory]);

  const TRANSLATIONS: Record<string, string[]> = {
    'chicken': ['kip', 'gevogelte', 'poultry'],
    'beef': ['rund', 'biefstuk', 'steak', 'meat'],
    'pork': ['varken', 'ham', 'spek', 'bacon', 'pork belly'],
    'fish': ['vis', 'zalm', 'tonijn', 'salmon', 'tuna', 'cod', 'kabeljauw'],
    'shrimp': ['garnaal', 'garnalen', 'prawns'],
    'pasta': ['spaghetti', 'macaroni', 'penne', 'lasagna', 'noedels', 'noodles'],
    'rice': ['rijst', 'risotto'],
    'vegetable': ['groente', 'vega', 'vegetarian'],
    'cheese': ['kaas', 'parmezaan', 'cheddar', 'mozzarella'],
    'egg': ['ei', 'eieren', 'eggs'],
    'bread': ['brood', 'toast', 'sandwich'],

    'kip': ['chicken', 'poultry'],
    'rund': ['beef', 'steak'],
    'varken': ['pork', 'ham', 'bacon'],
    'vis': ['fish', 'salmon', 'tuna'],
    'garnaal': ['shrimp', 'prawns'],
    'groente': ['vegetable', 'veggie', 'vega'],
    'ontbijt': ['breakfast'],
    'lunch': ['middageten'],
    'avondeten': ['dinner'],
    'toetje': ['dessert'],
    'drankje': ['drink', 'cocktail', 'smoothie'],
    'gezond': ['healthy', 'low-carb', 'salad', 'bowl'],
    'snel': ['quick', 'fast', '15 mins', 'airfryer'],
    'airfryer': ['hetelucht'],
    'bbq': ['barbecue', 'grillen', 'braai']
  };

  const filteredRecipes = savedRecipes.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const terms = [q];
      if (TRANSLATIONS[q]) terms.push(...TRANSLATIONS[q]);

      const textToSearch = [
        r.title,
        r.description,
        ...labelValues(r),
        ...(r.ingredients || []).map(i => i?.item || ''),
      ].join(' ').toLowerCase();

      const matches = terms.some(term => textToSearch.includes(term));
      if (!matches) return false;
    }
    if (selectedCategory !== "All") {
      return hasLabel(r, selectedCategory);
    }
    return true;
  });

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <h1 className={styles.logo}>Chef<span className={styles.highlight}>Social</span></h1>

            {/* User Auth Area */}
            <div className={styles.authArea} ref={userMenuRef}>
              {user ? (
                <>
                  <div
                    className={styles.userChip}
                    onClick={() => setUserMenuOpen(prev => !prev)}
                  >
                    {user.avatar_url && (
                      <img
                        src={user.avatar_url}
                        alt={user.name || 'User'}
                        referrerPolicy="no-referrer"
                        className={styles.avatar}
                      />
                    )}
                    <span className={styles.userName}>
                      {user.name?.split(' ')[0] || 'User'}
                    </span>
                  </div>
                  {userMenuOpen && (
                    <div className={styles.userMenu}>
                      <div className={styles.userMenuHeader}>
                        <div style={{ fontWeight: 600 }}>{user.name || 'User'}</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{user.email}</div>
                      </div>
                      <div className={styles.userMenuDivider} />
                      <button className={styles.userMenuItem} onClick={() => { setUserMenuOpen(false); setView('cookbook'); }}>
                        <span>📚</span> My Cookbook ({savedRecipes.length})
                      </button>
                      <button className={styles.userMenuItem} onClick={handleExportCookbook}>
                        <span>📥</span> Export Cookbook
                      </button>
                      <button className={styles.userMenuItem} onClick={() => { setUserMenuOpen(false); handleExportPdf(savedRecipes, true); }}>
                        <span>📖</span> Cookbook PDF
                      </button>
                      <button className={styles.userMenuItem} onClick={handleClearImportCache}>
                        <span>🔄</span> Reset Import Cache
                      </button>
                      <div className={styles.userMenuDivider} />
                      <button className={`${styles.userMenuItem} ${styles.userMenuLogout}`} onClick={handleLogout}>
                        <span>👋</span> Log Out
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={handleGoogleLogin}
                  disabled={authLoading}
                  className={styles.button}
                  style={{
                    padding: '0.5rem 1.2rem',
                    fontSize: '0.88rem',
                    background: 'var(--primary-gradient)',
                    border: 'none',
                    borderRadius: '24px',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(255, 107, 53, 0.35)',
                    transition: 'transform 0.2s ease'
                  }}
                >
                  {authLoading ? 'Signing in...' : 'Sign In with Google'}
                </button>
              )}
            </div>
          </div>

          {/* NAVIGATION BUTTONS */}
          <div className={styles.navButtons}>
            <button
              onClick={() => setView('home')}
              className={styles.button}
              style={{
                background: view === 'home' || view === 'details' ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                opacity: view === 'home' || view === 'details' ? 1 : 0.7
              }}
            >
              + New Recipe
            </button>
            <button
              onClick={() => setView('cookbook')}
              className={styles.button}
              style={{
                background: view === 'cookbook' ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                opacity: view === 'cookbook' ? 1 : 0.7
              }}
            >
              📚 Cookbook
            </button>
            <button
              onClick={() => setView('suggest')}
              className={styles.button}
              style={{
                background: view === 'suggest' ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                opacity: view === 'suggest' ? 1 : 0.7
              }}
            >
              ✨ What to cook
            </button>
          </div>
        </header>

        <div className={styles.mainContent}>

          {/* Errors and the share-link toast render on every view: shares can
              be started from the cookbook too, where they used to be invisible. */}
          {pendingSync.length > 0 && (
            <div className={styles.syncWarning}>
              <span>
                ⚠️ {pendingSync.length} recipe{pendingSync.length === 1 ? '' : 's'} on this device
                {' '}{pendingSync.length === 1 ? 'has' : 'have'} not reached the cloud, so
                {' '}{pendingSync.length === 1 ? 'it will' : 'they will'} not appear on your other devices.
              </span>
              <button
                type="button"
                className={styles.button}
                style={{ whiteSpace: 'nowrap', padding: '0.4rem 0.9rem', fontSize: '0.82rem' }}
                disabled={syncing || !user}
                onClick={() => user && retryPendingSync(user.id)}
              >
                {syncing ? 'Syncing...' : user ? 'Retry sync' : 'Sign in to sync'}
              </button>
            </div>
          )}

          {error && <div className={styles.error}>{error}{error.includes('YouTube') && <><br /><small style={{ opacity: 0.8 }}>💡 Tip: Try using TikTok or Instagram links instead</small></>}</div>}

          {shareLink && (
            <div className={styles.shareToast}>
              <input ref={shareLinkRef} readOnly value={shareLink} onClick={e => (e.target as HTMLInputElement).select()} className={styles.shareLinkInput} />
              <button onClick={() => copyShareLink(shareLink)} className={styles.button} style={{ whiteSpace: 'nowrap', padding: '0.35rem 0.8rem', fontSize: '0.82rem' }}>
                {shareCopied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={() => { setShareLink(null); setShareCopied(false); }} className={styles.iconButton} style={{ opacity: 0.5, padding: '0 0.25rem' }}>×</button>
            </div>
          )}

          {/* VIEW: HOME (Extraction) */}
          {(view === 'home' || view === 'details') && (
            <>
              {view === 'home' && (
                <form onSubmit={handleExtract} className={styles.form}>
                  <div className={styles.inputWrap}>
                    <input
                      ref={urlInputRef}
                      type="url"
                      inputMode="url"
                      autoCorrect="off"
                      autoCapitalize="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste TikTok, Instagram or YouTube link..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className={styles.input}
                      required
                    />
                    {url && (
                      <button
                        type="button"
                        className={styles.clearButton}
                        aria-label="Clear the link"
                        title="Clear"
                        onClick={() => { setUrl(''); urlInputRef.current?.focus(); }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button type="submit" disabled={loading} className={styles.button}>
                    {loading ? 'Extracting...' : 'Get Recipe'}
                  </button>
                </form>
              )}

              {/* Collection detected UI */}
              {collectionVideos && importProgress.status !== 'running' && (
                <div className={styles.recipeCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h2 style={{ margin: 0 }}>📚 {collectionTitle}</h2>
                    <button onClick={() => { setCollectionVideos(null); setCollectionTitle(null); setSelectedVideoIds(new Set()); }} className={styles.iconButton} style={{ opacity: 0.6 }}>×</button>
                  </div>

                  {classifying ? (
                    <p style={{ opacity: 0.6, margin: '1rem 0' }}>Checking which videos are recipes...</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.75rem 0 0.5rem' }}>
                        <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>
                          {selectedVideoIds.size} of {collectionVideos.length} selected
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => setSelectedVideoIds(new Set(collectionVideos.filter(v => !importedVideoIds.has(v.video_id ?? v.url) && !failedVideoIds.has(v.video_id ?? v.url)).map(v => v.video_id ?? v.url)))} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>All</button>
                          <span style={{ opacity: 0.4 }}>|</span>
                          <button onClick={() => setSelectedVideoIds(new Set())} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>None</button>
                        </div>
                      </div>

                      <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
                        {collectionVideos.map((v, i) => {
                          const key = v.video_id ?? v.url;
                          const alreadyImported = importedVideoIds.has(key);
                          const failedBefore = !alreadyImported && failedVideoIds.has(key);
                          const unavailable = alreadyImported || failedBefore;
                          const checked = selectedVideoIds.has(key);
                          return (
                            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.6rem', borderRadius: '8px', background: checked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', cursor: unavailable ? 'default' : 'pointer', opacity: unavailable ? 0.35 : checked ? 1 : 0.5 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={unavailable}
                                onChange={() => {
                                  if (unavailable) return;
                                  setSelectedVideoIds(prev => {
                                    const next = new Set(prev);
                                    checked ? next.delete(key) : next.add(key);
                                    return next;
                                  });
                                }}
                                style={{ accentColor: '#FF6B35', width: '16px', height: '16px', flexShrink: 0 }}
                              />
                              <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {v.title || `Video ${i + 1}`}
                              </span>
                              {alreadyImported && (
                                <span style={{ fontSize: '0.75rem', opacity: 0.6, flexShrink: 0 }}>already saved</span>
                              )}
                              {failedBefore && (
                                <span style={{ fontSize: '0.75rem', opacity: 0.6, flexShrink: 0 }}>no recipe found</span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      <button onClick={handleImportCollection} className={styles.saveButton} style={{ margin: 0 }} disabled={selectedVideoIds.size === 0}>
                        Import {selectedVideoIds.size} Recipe{selectedVideoIds.size !== 1 ? 's' : ''}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Resume banner for an import interrupted by a refresh/close */}
              {resumable && importProgress.status === 'idle' && (
                <div className={styles.recipeCard} style={{ textAlign: 'center' }}>
                  <h3 style={{ marginBottom: '0.5rem' }}>Unfinished import</h3>
                  <p style={{ opacity: 0.7, fontSize: '0.9rem', marginBottom: '1rem' }}>
                    {resumable.remaining.length} recipe{resumable.remaining.length !== 1 ? 's' : ''} left from your last import.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                    <button onClick={handleResumeImport} className={styles.button}>Resume</button>
                    <button onClick={dismissImport} className={styles.iconButton} style={{ opacity: 0.6 }}>Discard</button>
                  </div>
                </div>
              )}

              {/* Collection import progress */}
              {importProgress.status !== 'idle' && importProgress.total > 0 && (() => {
                const settled = importProgress.done + importProgress.failed + importProgress.skipped;
                const pct = Math.round((settled / importProgress.total) * 100);
                const running = importProgress.status === 'running';
                return (
                  <div className={styles.recipeCard} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>
                      {running ? '⏳' : importProgress.status === 'finished' ? '✅' : importProgress.status === 'paused' ? '🚦' : '⏸️'}
                    </div>
                    <h3 style={{ marginBottom: '0.5rem' }}>
                      {running
                        ? `Importing recipes... ${settled}/${importProgress.total}`
                        : importProgress.status === 'finished'
                          ? 'Import complete'
                          : importProgress.status === 'paused'
                            ? 'Import paused'
                            : 'Import stopped'}
                    </h3>

                    {importProgress.stopReason && (
                      <p style={{
                        margin: '0 0 0.75rem', fontSize: '0.85rem', lineHeight: 1.5,
                        background: 'rgba(255,193,7,0.12)', border: '1px solid rgba(255,193,7,0.35)',
                        borderRadius: '10px', padding: '0.6rem 0.8rem', textAlign: 'left'
                      }}>
                        {importProgress.stopReason}
                        {resumable && ` ${resumable.remaining.length} recipe${resumable.remaining.length !== 1 ? 's' : ''} are still queued - press Resume to continue.`}
                      </p>
                    )}

                    <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', overflow: 'hidden', margin: '1rem 0' }}>
                      <div style={{
                        height: '8px',
                        background: 'var(--primary-gradient)',
                        width: `${pct}%`,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', fontSize: '0.85rem', opacity: 0.75, marginBottom: '0.75rem' }}>
                      <span>✅ {importProgress.done} saved</span>
                      {importProgress.skipped > 0 && <span>⏭️ {importProgress.skipped} already had</span>}
                      {importProgress.failed > 0 && <span>⚠️ {importProgress.failed} failed</span>}
                    </div>

                    {running && (
                      <>
                        <p style={{ opacity: 0.6, fontSize: '0.82rem', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {importProgress.currentTitle ?? 'Starting...'}
                        </p>
                        <p style={{ opacity: 0.5, fontSize: '0.78rem', marginBottom: '1rem' }}>
                          Keep this tab open. Recipes appear in your cookbook as they finish.
                        </p>
                      </>
                    )}

                    {importProgress.errors.length > 0 && (
                      <details style={{ textAlign: 'left', margin: '0 0 1rem', fontSize: '0.8rem', opacity: 0.7 }}>
                        <summary style={{ cursor: 'pointer' }}>Show {importProgress.errors.length} problem{importProgress.errors.length !== 1 ? 's' : ''}</summary>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                          {importProgress.errors.map((e, i) => (
                            <li key={i}>{e.title} — {e.reason}</li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {running ? (
                      <button onClick={cancelImport} className={styles.iconButton} style={{ opacity: 0.6 }}>
                        Cancel import
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        {(importProgress.status === 'cancelled' || importProgress.status === 'paused') && resumable && (
                          <button onClick={handleResumeImport} className={styles.button}>Resume</button>
                        )}
                        <button onClick={dismissImport} className={styles.iconButton} style={{ opacity: 0.6 }}>Dismiss</button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {recipe && (
                <div className={styles.recipeCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <h2 className={styles.recipeTitle}>{recipe.title}</h2>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={handlePrint} className={styles.iconButton} title="Save as PDF">🖨️</button>
                      <button onClick={() => recipe && handleShare([recipe])} disabled={shareLoading} className={styles.iconButton} title="Share recipe">🔗</button>
                      <button onClick={handleDelete} className={styles.iconButton} title="Delete Recipe" style={{ color: '#ff6b6b' }}>🗑️</button>
                      <button onClick={() => { setRecipe(null); if (view === 'details') { setView('cookbook'); setTimeout(() => window.scrollTo({ top: cookbookScrollY.current, behavior: 'smooth' }), 50); } }} className={styles.iconButton} style={{ opacity: 0.6 }}>×</button>
                    </div>
                  </div>
                  <p className={styles.recipeDesc}>{recipe.description}</p>

                  {/* Tags */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0' }}>
                    {labelValues(recipe).map(tag => (
                      <span key={tag} style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem' }}>
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className={styles.metaGrid}>
                    <div className={styles.metaItem}>⏱ {recipe.prep_time || '--'}</div>
                    <div className={styles.metaItem}>🔥 {recipe.cook_time || '--'}</div>
                    <div className={styles.metaItem}>👥 {recipe.servings || '--'}</div>
                  </div>

                  <div className={styles.splitSection}>
                    <div className={styles.ingredients}>
                      <h3>Ingredients</h3>
                      {Object.entries(
                        recipe.ingredients.reduce((acc, ing) => {
                          const group = ing.group || 'Main';
                          if (!acc[group]) acc[group] = [];
                          acc[group].push(ing);
                          return acc;
                        }, {} as Record<string, typeof recipe.ingredients>)
                      ).map(([group, items]) => (
                        <div key={group} style={{ marginBottom: '1rem' }}>
                          <h4 style={{ margin: '0.5rem 0', color: '#FF8E53', fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {group}
                          </h4>
                          <ul>
                            {items.map((ing, i) => (
                              <li key={i}>
                                <b>{ing.amount} {(ing.unit && !ing.amount?.toLowerCase().endsWith(ing.unit.toLowerCase())) ? ing.unit : ''}</b> {ing.item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <div className={styles.instructions}>
                      <h3>Instructions</h3>
                      <ol>
                        {recipe.instructions.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  </div>

                  <button onClick={() => saveRecipe(recipe)} disabled={savedRecipes.some(r => isSameRecipe(r, recipe))} className={styles.saveButton}>
                    {savedRecipes.some(r => isSameRecipe(r, recipe)) ? 'Saved to Cookbook!' : 'Save to Cookbook'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* VIEW: SUGGEST ("what am I feeling like?") */}
          {view === 'suggest' && (
            <div className={styles.cookbookSection}>
              <div className={styles.recipeCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                  <h2 style={{ margin: 0 }}>✨ What am I feeling like?</h2>
                  {(selectedMoods.size > 0 || moodText || hasSuggested) && (
                    <button type="button" onClick={clearMood} className={styles.textButton}>
                      Reset
                    </button>
                  )}
                </div>
                <p style={{ opacity: 0.65, fontSize: '0.88rem', margin: '0.35rem 0 1rem' }}>
                  Picks from the {savedRecipes.length} recipe{savedRecipes.length === 1 ? '' : 's'} in your
                  cookbook - it only ever suggests something you have actually saved.
                </p>

                <div className={styles.filterContainer} style={{ paddingBottom: '0.6rem', marginBottom: '0.6rem' }}>
                  {MOOD_CHIPS.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      className={`${styles.filterChip} ${selectedMoods.has(chip) ? styles.filterChipActive : ''}`}
                      onClick={() => setSelectedMoods(prev => {
                        const next = new Set(prev);
                        if (next.has(chip)) next.delete(chip); else next.add(chip);
                        return next;
                      })}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSuggest} className={styles.form}>
                  <div className={styles.inputWrap}>
                    <input
                      ref={moodInputRef}
                      type="text"
                      placeholder="Anything else? e.g. 'nothing heavy, no oven, 20 minutes'"
                      value={moodText}
                      onChange={(e) => setMoodText(e.target.value)}
                      className={styles.input}
                    />
                    {moodText && (
                      <button
                        type="button"
                        className={styles.clearButton}
                        aria-label="Clear"
                        title="Clear"
                        onClick={() => { setMoodText(''); moodInputRef.current?.focus(); }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button type="submit" className={styles.button} disabled={suggestLoading || savedRecipes.length === 0}>
                    {suggestLoading ? 'Thinking...' : selectedMoods.size === 0 && !moodText ? 'Surprise me' : 'Suggest'}
                  </button>
                </form>

                {savedRecipes.length === 0 && (
                  <p style={{ opacity: 0.6, fontSize: '0.88rem', marginTop: '1rem' }}>
                    Save a few recipes first and this will have something to pick from.
                  </p>
                )}
              </div>

              {suggestError && <div className={styles.error} style={{ marginBottom: '1rem' }}>{suggestError}</div>}

              {suggestIntro && !suggestLoading && (
                <p style={{ opacity: 0.85, margin: '0 0 1rem', fontSize: '0.95rem' }}>{suggestIntro}</p>
              )}

              {suggestConsidered && suggestConsidered.considered < suggestConsidered.total && !suggestLoading && (
                <p style={{ opacity: 0.5, margin: '-0.5rem 0 1rem', fontSize: '0.78rem' }}>
                  Considered the {suggestConsidered.considered} most relevant of your {suggestConsidered.total} recipes.
                </p>
              )}

              <div className={styles.cookbookGrid}>
                {suggestions.map(({ recipe: suggested, reason }) => {
                  const key = recipeKey(suggested);
                  const thumb = thumbnailSrc(suggested);
                  return (
                    <div
                      key={key}
                      className={styles.cookbookItem}
                      onClick={() => {
                        cookbookScrollY.current = window.scrollY;
                        setRecipe(suggested);
                        setView('details');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <div className={styles.cookbookImage}>
                        {thumb ? (
                          <img
                            src={thumb}
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
                            alt={suggested.title}
                            referrerPolicy="no-referrer"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const siblingSpan = e.currentTarget.nextElementSibling as HTMLElement;
                              if (siblingSpan) siblingSpan.style.display = 'block';
                            }}
                          />
                        ) : null}
                        <span style={{ fontSize: '2rem', display: thumb ? 'none' : 'block' }}>🍳</span>
                      </div>
                      <div className={styles.cookbookContent}>
                        <h4>{suggested.title}</h4>
                        {reason && <p className={styles.suggestReason}>{reason}</p>}
                        <div className={styles.tagsRow}>
                          {labelValues(suggested).slice(0, 3).map(t => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasSuggested && !suggestLoading && !suggestError && suggestions.length === 0 && savedRecipes.length > 0 && (
                <p style={{ opacity: 0.6, width: '100%', textAlign: 'center', padding: '2rem' }}>
                  Nothing in your cookbook really fits that. Try fewer chips, or different wording.
                </p>
              )}
            </div>
          )}

          {/* VIEW: COOKBOOK */}
          {view === 'cookbook' && (
            <div className={styles.cookbookSection}>
              <div className={styles.cookbookHeader}>
                <h2>My Cookbook ({savedRecipes.length})</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div className={styles.searchWrap}>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search (try 'Kip' or 'Chicken')..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={styles.searchInput}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className={styles.clearButton}
                        aria-label="Clear the search"
                        title="Clear"
                        onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => { setSelectMode(p => !p); setBulkSelected(new Set()); }}
                    className={styles.button}
                    style={{ whiteSpace: 'nowrap', padding: '0.5rem 0.9rem', fontSize: '0.85rem', background: selectMode ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)' }}
                  >
                    {selectMode ? 'Cancel' : 'Select'}
                  </button>
                  {selectMode && (
                    <button
                      onClick={() => {
                        const allIds = new Set(filteredRecipes.map(recipeKey));
                        const allSelected = filteredRecipes.every(r => bulkSelected.has(recipeKey(r)));
                        setBulkSelected(allSelected ? new Set() : allIds);
                      }}
                      className={styles.button}
                      style={{ whiteSpace: 'nowrap', padding: '0.5rem 0.9rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)' }}
                    >
                      {filteredRecipes.every(r => bulkSelected.has(recipeKey(r))) ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>
              </div>

              {/* Bulk action bar. Sits above the grid and sticks to the top of
                  the viewport: below the grid it was unreachable without
                  scrolling past every recipe in the cookbook. */}
              {selectMode && bulkSelected.size > 0 && (
                <div className={styles.bulkBar}>
                  <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>{bulkSelected.size} selected</span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => handleExportPdf(savedRecipes.filter(r => bulkSelected.has(recipeKey(r))), false)}
                      className={styles.button}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.12)' }}
                      title="Export the selected recipes as one PDF, one recipe per page"
                    >
                      🖨️ Export PDF
                    </button>
                    <button
                      onClick={() => handleExportPdf(savedRecipes.filter(r => bulkSelected.has(recipeKey(r))), true)}
                      className={styles.button}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.12)' }}
                      title="Export as a cookbook PDF: cover page, table of contents and recipes grouped by category"
                    >
                      📖 Cookbook PDF
                    </button>
                    <button
                      onClick={() => {
                        const recipes = savedRecipes.filter(r => bulkSelected.has(recipeKey(r)));
                        handleShare(recipes).then(() => { setSelectMode(false); setBulkSelected(new Set()); });
                      }}
                      className={styles.button}
                      disabled={shareLoading}
                      style={{ padding: '0.5rem 1.2rem', fontSize: '0.9rem' }}
                    >
                      🔗 {shareLoading ? 'Creating link...' : 'Share selected'}
                    </button>
                  </div>
                </div>
              )}

              {/* Filter Chips */}
              <div className={styles.filterContainer}>
                <button
                  className={`${styles.filterChip} ${selectedCategory === "All" ? styles.filterChipActive : ''}`}
                  onClick={() => setSelectedCategory("All")}
                >
                  All
                </button>
                {/* Chips come from what is actually saved, most common first, so
                    every filter offered returns something. The old fixed list of
                    ~34 chips was shown in full even when most matched nothing. */}
                {cookbookFacets.map(facet => (
                  <button
                    key={facet.value}
                    className={`${styles.filterChip} ${selectedCategory === facet.value ? styles.filterChipActive : ''}`}
                    onClick={() => setSelectedCategory(facet.value)}
                    title={`${facet.count} recipe${facet.count === 1 ? '' : 's'}`}
                  >
                    {facet.value}
                    <span className={styles.chipCount}>{facet.count}</span>
                  </button>
                ))}
              </div>

              {cookbookError && (
                <div className={styles.error} style={{ marginBottom: '1rem' }}>{cookbookError}</div>
              )}

              {/* Grid View */}
              <div className={styles.cookbookGrid}>
                {cookbookLoading && savedRecipes.length === 0 ? (
                  <p style={{ opacity: 0.6, width: '100%', textAlign: 'center', padding: '2rem' }}>
                    Loading your recipes...
                  </p>
                ) : filteredRecipes.map((r, idx) => {
                  const key = recipeKey(r);
                  const thumb = thumbnailSrc(r);
                  const isSelected = bulkSelected.has(key);
                  return (
                    <div
                      key={key}
                      className={styles.cookbookItem}
                      style={{ outline: isSelected ? '2px solid #FF6B35' : undefined, position: 'relative' }}
                      onClick={() => {
                        if (selectMode) {
                          setBulkSelected(prev => { const n = new Set(prev); isSelected ? n.delete(key) : n.add(key); return n; });
                        } else {
                          cookbookScrollY.current = window.scrollY; setRecipe(r); setView('details'); window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                    >
                      {selectMode && (
                        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 22, height: 22, borderRadius: '50%', background: isSelected ? '#FF6B35' : 'rgba(0,0,0,0.5)', border: '2px solid #FF6B35', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: '#fff' }}>
                          {isSelected ? '✓' : ''}
                        </div>
                      )}
                      <div className={styles.cookbookImage}>
                        {thumb ? (
                          <img
                            src={thumb}
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
                            alt={r.title}
                            referrerPolicy="no-referrer"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const siblingSpan = e.currentTarget.nextElementSibling as HTMLElement;
                              if (siblingSpan) siblingSpan.style.display = 'block';
                            }}
                          />
                        ) : null}
                        <span style={{ fontSize: '2rem', display: thumb ? 'none' : 'block' }}>🍳</span>
                      </div>
                      <div className={styles.cookbookContent}>
                        <h4>{r.title}</h4>
                        <div className={styles.tagsRow}>
                          {labelValues(r).slice(0, 3).map(t => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!cookbookLoading && filteredRecipes.length === 0 && savedRecipes.length > 0 && (
                  <p style={{ opacity: 0.6, width: '100%', textAlign: 'center', padding: '2rem' }}>
                    No recipes match your filter.
                  </p>
                )}
                {!cookbookLoading && savedRecipes.length === 0 && (
                  <p style={{ opacity: 0.6, width: '100%', textAlign: 'center', padding: '2rem' }}>
                    No recipes saved yet. Extract one to get started!
                  </p>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return <HomeContent />;
}
