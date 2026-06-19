'use client';

import React, { useState } from 'react';
import RecipeCard from '../components/RecipeCard';
import { CategoryAccordion } from '../components/CategoryAccordion';
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
  addDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  where, 
  setDoc 
} from 'firebase/firestore';

const API_URL = '/api';

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

  // Collection import state
  type CollectionVideo = { url: string; title?: string; thumbnail?: string; video_id?: string };
  const [collectionVideos, setCollectionVideos] = useState<CollectionVideo[] | null>(null);
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importCancelled, setImportCancelled] = useState(false);
  const [importedVideoIds, setImportedVideoIds] = useState<Set<string>>(new Set());
  const cookbookScrollY = React.useRef(0);
  const [cookbookLoading, setCookbookLoading] = useState(false);
  const [cookbookError, setCookbookError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);

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

  // Helper to migrate legacy single-category recipes
  const categoryToTags = (cat: string) => [cat];

  // Load saved recipes and user on mount
  React.useEffect(() => {
    // 0. Load previously imported TikTok video IDs to avoid redundant Groq calls
    const storedIds = localStorage.getItem('chefSocial_imported_video_ids');
    if (storedIds) {
      try { setImportedVideoIds(new Set(JSON.parse(storedIds))); } catch { /* ignore */ }
    }

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
        });
      });
      // Sort client-side (no index required)
      setSavedRecipes(recipes);
      localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(recipes));
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
          const recipes = JSON.parse(localRecipes);
          for (const r of recipes) {
            await addDoc(collection(db, 'recipes'), {
              user_id: firebaseUser.uid,
              title: r.title,
              description: r.description || '',
              ingredients: r.ingredients || [],
              instructions: r.instructions || [],
              tags: r.tags || [],
              image_url: r.image_url || null,
              prep_time: r.prep_time || null,
              cook_time: r.cook_time || null,
              servings: r.servings || null,
              created_at: Date.now()
            });
          }
          localStorage.removeItem('chefSocial_cookbook'); // Clear local after migration
        } catch (e) {
          console.error('Migration failed:', e);
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
  };

  const saveRecipe = async (recipeToSave: Recipe) => {
    const isAlreadySaved = savedRecipes.some(r => r.title === recipeToSave.title);

    if (isAlreadySaved) {
      // Remove recipe
      const recipeToDelete = savedRecipes.find(r => r.title === recipeToSave.title);
      const newSaved = savedRecipes.filter(r => r.title !== recipeToSave.title);
      setSavedRecipes(newSaved);

      if (!user) {
        localStorage.setItem('chefSocial_cookbook', JSON.stringify(newSaved));
      } else if (recipeToDelete?.id) {
        // Cloud delete from Firestore
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
          const docRef = await addDoc(collection(db, 'recipes'), {
            user_id: user.id,
            title: recipeToSave.title,
            description: recipeToSave.description || '',
            ingredients: recipeToSave.ingredients || [],
            instructions: recipeToSave.instructions || [],
            tags: recipeToSave.tags || [],
            image_url: recipeToSave.image_url || null,
            prep_time: recipeToSave.prep_time || null,
            cook_time: recipeToSave.cook_time || null,
            servings: recipeToSave.servings || null,
            created_at: Date.now()
          });
          
          const savedRecipe = { ...recipeToSave, id: docRef.id };
          setSavedRecipes(prev => [savedRecipe, ...prev.filter(r => r.title !== recipeToSave.title)]);
          localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify([savedRecipe, ...savedRecipes]));
        } catch (e) {
          console.error('Cloud save failed, kept locally', e);
          localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(optimistic));
        }
      } else {
        localStorage.setItem('chefSocial_cookbook', JSON.stringify(optimistic));
      }
    }
  };

  const extractSingleRecipe = async (videoUrl: string): Promise<Recipe | null> => {
    const res = await fetch(`${API_URL}/extract-recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl.trim() }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Extraction failed');
    }
    return res.json();
  };

  const saveRecipeDirect = async (recipeToSave: Recipe) => {
    setSavedRecipes(prev => {
      if (prev.some(r => r.title === recipeToSave.title)) return prev;
      const updated = [recipeToSave, ...prev];
      if (!user) localStorage.setItem('chefSocial_cookbook', JSON.stringify(updated));
      return updated;
    });

    if (user) {
      try {
        const docRef = await addDoc(collection(db, 'recipes'), {
          user_id: user.id,
          title: recipeToSave.title,
          description: recipeToSave.description || '',
          ingredients: recipeToSave.ingredients || [],
          instructions: recipeToSave.instructions || [],
          tags: recipeToSave.tags || [],
          image_url: recipeToSave.image_url || null,
          prep_time: recipeToSave.prep_time || null,
          cook_time: recipeToSave.cook_time || null,
          servings: recipeToSave.servings || null,
          created_at: Date.now()
        });
        const saved = { ...recipeToSave, id: docRef.id };
        setSavedRecipes(prev => [saved, ...prev.filter(r => r.title !== recipeToSave.title)]);
      } catch (e) {
        console.warn('Cloud save failed for recipe, kept locally', e);
      }
    }
  };

  const handleImportCollection = async () => {
    if (!collectionVideos) return;
    const toImport = collectionVideos.filter(v => selectedVideoIds.has(v.video_id ?? v.url));
    if (toImport.length === 0) return;

    setImportCancelled(false);
    setImportProgress({ current: 0, total: toImport.length });

    const existingTitles = new Set(savedRecipes.map(r => r.title));
    const importedTitles = new Set<string>();
    const newlyImportedVideoIds: string[] = [];

    let retryCount = 0;

    for (let i = 0; i < toImport.length; i++) {
      if (importCancelled) break;
      setImportProgress({ current: i + 1, total: toImport.length });

      const videoId = toImport[i].video_id ?? toImport[i].url;

      if (importedVideoIds.has(videoId)) continue;

      try {
        const r = await extractSingleRecipe(toImport[i].url);
        if (r && !existingTitles.has(r.title) && !importedTitles.has(r.title)) {
          await saveRecipeDirect(r);
          importedTitles.add(r.title);
          newlyImportedVideoIds.push(videoId);
          retryCount = 0; // reset on success
        }
      } catch (err: any) {
        const msg: string = err?.message || '';
        if ((msg.includes('rate_limit_exceeded') || msg.includes('Rate limit') || msg.includes('429') || msg.includes('Too Many Requests')) && retryCount < 3) {
          console.warn(`Rate limit hit, retrying video ${i + 1} in 10 seconds... (Attempt ${retryCount + 1}/3)`);
          retryCount++;
          i--; // Retry this index
          await new Promise(res => setTimeout(res, 10000));
          continue;
        }
        
        // If we exhausted retries or hit a different error
        if ((msg.includes('rate_limit_exceeded') || msg.includes('Rate limit') || msg.includes('429'))) {
           console.error(`Giving up on video ${i + 1} due to persistent rate limits.`);
        } else {
           console.warn(`Skipped video ${i + 1}:`, err);
        }
      }
      if (i < toImport.length - 1) await new Promise(res => setTimeout(res, 1000));
    }

    if (newlyImportedVideoIds.length > 0) {
      const updated = new Set([...importedVideoIds, ...newlyImportedVideoIds]);
      setImportedVideoIds(updated);
      localStorage.setItem('chefSocial_imported_video_ids', JSON.stringify([...updated]));
    }

    setImportProgress(null);
    setCollectionVideos(null);
    setCollectionTitle(null);
    setSelectedVideoIds(new Set());
    setView('cookbook');
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setRecipe(null);
    setCollectionVideos(null);
    setCollectionTitle(null);

    try {
      const collectionRes = await fetch(`${API_URL}/extract-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (collectionRes.ok) {
        const collectionData = await collectionRes.json();
        if (collectionData.is_collection && collectionData.count > 0) {
          const videos: CollectionVideo[] = collectionData.videos;
          setCollectionVideos(videos);
          setCollectionTitle(collectionData.collection_title || 'TikTok Collection');
          setLoading(false);

          setClassifying(true);
          try {
            const classifyRes = await fetch(`${API_URL}/classify-recipes`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videos: videos.map(v => ({ video_id: v.video_id, title: v.title })) }),
            });
            if (classifyRes.ok) {
              const { results } = await classifyRes.json();
              const recipeIds = new Set<string>(
                results.filter((r: { video_id: string; is_recipe: boolean }) => r.is_recipe)
                       .map((r: { video_id: string; is_recipe: boolean }) => r.video_id)
              );
              setSelectedVideoIds(recipeIds.size > 0 ? recipeIds : new Set(videos.map(v => v.video_id ?? v.url)));
            } else {
              setSelectedVideoIds(new Set(videos.map(v => v.video_id ?? v.url)));
            }
          } catch {
            setSelectedVideoIds(new Set(videos.map(v => v.video_id ?? v.url)));
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
      const updated = savedRecipes.filter(r => r.title !== recipe.title);
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

  const handlePrint = () => {
    window.print();
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
      }).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
  };

  const fallbackCopy = () => {
    const input = shareLinkRef.current;
    if (!input) return;
    input.select();
    input.setSelectionRange(0, 99999);
    document.execCommand('copy');
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  };

  const handleShare = async (recipesToShare: Recipe[]) => {
    if (!user) { setError('Sign in to share recipes.'); return; }
    setShareLoading(true);
    try {
      const shareToken = Math.random().toString(36).substring(2, 18);
      
      await setDoc(doc(db, 'shared_links', shareToken), {
        recipes: recipesToShare,
        created_by: user.id,
        created_at: Date.now()
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
  const [view, setView] = useState<'home' | 'cookbook' | 'details'>('home');
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  // --- FILTERING & BILINGUAL SEARCH ---
  const [selectedCategory, setSelectedCategory] = useState("All");

  const MEAL_TYPES = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Appetizer', 'Drink'];
  const DISH_TYPES = [
    'Airfryer', 'BBQ', 'Slow Cooker', 'Pasta', 'Pizza', 'Burger', 'Sandwich', 'Wrap', 'Tacos',
    'Salad', 'Bowl', 'Soup', 'Stew', 'Curry', 'Rice', 'Meat', 'Fish', 'Chicken', 'Vegetarian', 'Vegan',
    'Low-Carb', 'High-Protein', 'Smoothie', 'Cocktail', 'Sauce', 'Side'
  ];

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
        ...(r.tags || []),
        r.category || ''
      ].join(' ').toLowerCase();

      const matches = terms.some(term => textToSearch.includes(term));
      if (!matches) return false;
    }
    if (selectedCategory !== "All") {
      const tags = (r.tags || (r.category ? categoryToTags(r.category) : [])).map(t => t.toLowerCase());
      return tags.includes(selectedCategory.toLowerCase());
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
          </div>
        </header>

        <div className={styles.mainContent}>

          {/* VIEW: HOME (Extraction) */}
          {(view === 'home' || view === 'details') && (
            <>
              {view === 'home' && (
                <form onSubmit={handleExtract} className={styles.form}>
                  <input
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
                  <button type="submit" disabled={loading} className={styles.button}>
                    {loading ? 'Extracting...' : 'Get Recipe'}
                  </button>
                </form>
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

              {/* Collection detected UI */}
              {collectionVideos && !importProgress && (
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
                          <button onClick={() => setSelectedVideoIds(new Set(collectionVideos.filter(v => !importedVideoIds.has(v.video_id ?? v.url)).map(v => v.video_id ?? v.url)))} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>All</button>
                          <span style={{ opacity: 0.4 }}>|</span>
                          <button onClick={() => setSelectedVideoIds(new Set())} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>None</button>
                        </div>
                      </div>

                      <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
                        {collectionVideos.map((v, i) => {
                          const key = v.video_id ?? v.url;
                          const alreadyImported = importedVideoIds.has(key);
                          const checked = selectedVideoIds.has(key);
                          return (
                            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.6rem', borderRadius: '8px', background: checked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', cursor: alreadyImported ? 'default' : 'pointer', opacity: alreadyImported ? 0.35 : checked ? 1 : 0.5 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={alreadyImported}
                                onChange={() => {
                                  if (alreadyImported) return;
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

              {/* Collection import progress */}
              {importProgress && (
                <div className={styles.recipeCard} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⏳</div>
                  <h3 style={{ marginBottom: '0.5rem' }}>
                    Importing recipes... {importProgress.current}/{importProgress.total}
                  </h3>
                  <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', overflow: 'hidden', margin: '1rem 0' }}>
                    <div style={{
                      height: '8px',
                      background: 'var(--primary-gradient)',
                      width: `${(importProgress.current / importProgress.total) * 100}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <p style={{ opacity: 0.6, fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Recipes are being saved to your cookbook automatically.
                  </p>
                  <button onClick={() => setImportCancelled(true)} className={styles.iconButton} style={{ opacity: 0.6 }}>
                    Cancel import
                  </button>
                </div>
              )}

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
                    {(recipe.tags || (recipe.category ? categoryToTags(recipe.category) : [])).map(tag => (
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

                  <button onClick={() => saveRecipe(recipe)} disabled={savedRecipes.some(r => r.title === recipe.title)} className={styles.saveButton}>
                    {savedRecipes.some(r => r.title === recipe.title) ? 'Saved to Cookbook!' : 'Save to Cookbook'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* VIEW: COOKBOOK */}
          {view === 'cookbook' && (
            <div className={styles.cookbookSection}>
              <div className={styles.cookbookHeader}>
                <h2>My Cookbook ({savedRecipes.length})</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Search (try 'Kip' or 'Chicken')..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={styles.searchInput}
                  />
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
                        const allIds = new Set(filteredRecipes.map(r => r.id || r.title));
                        const allSelected = filteredRecipes.every(r => bulkSelected.has(r.id || r.title));
                        setBulkSelected(allSelected ? new Set() : allIds);
                      }}
                      className={styles.button}
                      style={{ whiteSpace: 'nowrap', padding: '0.5rem 0.9rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)' }}
                    >
                      {filteredRecipes.every(r => bulkSelected.has(r.id || r.title)) ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Chips */}
              <div className={styles.filterContainer}>
                <button
                  className={`${styles.filterChip} ${selectedCategory === "All" ? styles.filterChipActive : ''}`}
                  onClick={() => setSelectedCategory("All")}
                >
                  All
                </button>
                {MEAL_TYPES.map(cat => (
                  <button
                    key={cat}
                    className={`${styles.filterChip} ${selectedCategory === cat ? styles.filterChipActive : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
                <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)', margin: '0 4px' }}></div>
                {DISH_TYPES.map(cat => (
                  <button
                    key={cat}
                    className={`${styles.filterChip} ${selectedCategory === cat ? styles.filterChipActive : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
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
                  const recipeKey = r.id || r.title;
                  const isSelected = bulkSelected.has(recipeKey);
                  return (
                    <div
                      key={idx}
                      className={styles.cookbookItem}
                      style={{ outline: isSelected ? '2px solid #FF6B35' : undefined, position: 'relative' }}
                      onClick={() => {
                        if (selectMode) {
                          setBulkSelected(prev => { const n = new Set(prev); isSelected ? n.delete(recipeKey) : n.add(recipeKey); return n; });
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
                        {(r.image_url || r.image) ? (
                          <img
                            src={r.image_url || r.image}
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
                        <span style={{ fontSize: '2rem', display: (r.image_url || r.image) ? 'none' : 'block' }}>🍳</span>
                      </div>
                      <div className={styles.cookbookContent}>
                        <h4>{r.title}</h4>
                        <div className={styles.tagsRow}>
                          {(r.tags || (r.category ? categoryToTags(r.category) : [])).slice(0, 3).map(t => (
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

              {/* Bulk action bar */}
              {selectMode && bulkSelected.size > 0 && (
                <div className={styles.bulkBar}>
                  <span style={{ opacity: 0.8 }}>{bulkSelected.size} selected</span>
                  <button
                    onClick={() => {
                      const recipes = savedRecipes.filter(r => bulkSelected.has(r.id || r.title));
                      handleShare(recipes).then(() => { setSelectMode(false); setBulkSelected(new Set()); });
                    }}
                    className={styles.button}
                    disabled={shareLoading}
                    style={{ padding: '0.5rem 1.2rem', fontSize: '0.9rem' }}
                  >
                    🔗 {shareLoading ? 'Creating link...' : 'Share selected'}
                  </button>
                </div>
              )}
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
