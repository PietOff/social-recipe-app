'use client';

import React, { useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from '@react-oauth/google';
import RecipeCard from '../components/RecipeCard';
import { CategoryAccordion } from '../components/CategoryAccordion';
import { Recipe } from '../types';
import styles from './page.module.css';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://social-recipe-appsocial-recipe-backend.onrender.com';

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
  const [collectionVideos, setCollectionVideos] = useState<{ url: string; title?: string; thumbnail?: string }[] | null>(null);
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importCancelled, setImportCancelled] = useState(false);
  const [cookbookLoading, setCookbookLoading] = useState(false);
  const [cookbookError, setCookbookError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Helper to migrate legacy single-category recipes
  const categoryToTags = (cat: string) => [cat];

  // Load saved recipes and user on mount
  React.useEffect(() => {
    // 1. Immediately hydrate from cache (for instant visibility)
    const cachedCookbook = localStorage.getItem('chefSocial_cached_cookbook');
    if (cachedCookbook) {
      try {
        setSavedRecipes(JSON.parse(cachedCookbook));
      } catch (e) {
        console.error('Failed to parse cached cookbook', e);
      }
    }

    // 2. Load user and sync
    const savedUser = localStorage.getItem('chefSocial_user');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        // Refresh from cloud
        fetchCloudRecipes(parsedUser.token);
      } catch (e) {
        console.error('Failed to load user', e);
      }
    } else {
      // Fallback for legacy / non-logged-in users
      const saved = localStorage.getItem('chefSocial_cookbook');
      if (saved && !cachedCookbook) {
        try {
          setSavedRecipes(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load old cookbook', e);
        }
      }
    }
  }, []);

  const fetchCloudRecipes = async (token: string) => {
    setCookbookLoading(true);
    setCookbookError(null);
    try {
      const res = await fetch(`${API_URL}/recipes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const recipes = await res.json();
        setSavedRecipes(recipes);
        localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(recipes));
      } else {
        setCookbookError('Could not load your recipes from the cloud. Showing cached data.');
      }
    } catch (e) {
      setCookbookError('Could not reach the server. Showing cached data.');
    } finally {
      setCookbookLoading(false);
    }
  };

  const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) return;

    setAuthLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential })
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        localStorage.setItem('chefSocial_user', JSON.stringify(userData));

        // Migrate local recipes to cloud
        const localRecipes = localStorage.getItem('chefSocial_cookbook');
        if (localRecipes) {
          const recipes = JSON.parse(localRecipes);
          for (const r of recipes) {
            await fetch(`${API_URL}/recipes`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userData.token}`
              },
              body: JSON.stringify(r)
            });
          }
          localStorage.removeItem('chefSocial_cookbook'); // Clear local after migration
        }

        // Fetch all cloud recipes
        fetchCloudRecipes(userData.token);
      } else {
        const errData = await res.json().catch(() => ({ detail: 'Login failed' }));
        setError(`Login failed: ${errData.detail || res.statusText}`);
        console.error('Login failed:', errData);
      }
    } catch (e: any) {
      setError(`Login error: ${e.message}`);
      console.error('Google login error', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('chefSocial_user');
    setSavedRecipes([]);
  };

  const saveRecipe = async (recipeToSave: Recipe) => {
    const isAlreadySaved = savedRecipes.some(r => r.title === recipeToSave.title);

    if (isAlreadySaved) {
      // Remove recipe
      // Find the ID of the recipe to delete from the saved list
      const recipeToDelete = savedRecipes.find(r => r.title === recipeToSave.title);
      const newSaved = savedRecipes.filter(r => r.title !== recipeToSave.title);
      setSavedRecipes(newSaved);

      if (!user) {
        localStorage.setItem('chefSocial_cookbook', JSON.stringify(newSaved));
      } else if (recipeToDelete?.id) {
        // Cloud delete
        try {
          const res = await fetch(`${API_URL}/recipes/${recipeToDelete.id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${user.token}`
            }
          });
          if (!res.ok) {
            console.error('Failed to delete from cloud');
            // Revert optimistic update if needed, but for now just log
          }
        } catch (e) {
          console.error('Failed to delete from cloud', e);
        }
      }
    } else {
      // Optimistic update — show saved immediately regardless of cloud result
      const optimistic = [recipeToSave, ...savedRecipes];
      setSavedRecipes(optimistic);

      if (user) {
        try {
          const res = await fetch(`${API_URL}/recipes`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user.token}`
            },
            body: JSON.stringify(recipeToSave)
          });
          if (res.ok) {
            // Replace optimistic entry with server version (gets a real DB id)
            const savedRecipe = await res.json();
            setSavedRecipes(prev => [savedRecipe, ...prev.filter(r => r.title !== recipeToSave.title)]);
            localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify([savedRecipe, ...savedRecipes]));
          } else {
            // Cloud failed — keep the optimistic save in local cache
            localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(optimistic));
          }
        } catch (e) {
          // Network error — keep locally so the user doesn't lose their save
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
      body: JSON.stringify({ url: videoUrl }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Extraction failed');
    }
    return res.json();
  };

  const handleImportCollection = async () => {
    if (!collectionVideos) return;
    setImportCancelled(false);
    setImportProgress({ current: 0, total: collectionVideos.length });
    let imported = 0;

    for (let i = 0; i < collectionVideos.length; i++) {
      if (importCancelled) break;
      setImportProgress({ current: i + 1, total: collectionVideos.length });
      try {
        const r = await extractSingleRecipe(collectionVideos[i].url);
        if (r) {
          const alreadySaved = savedRecipes.some(s => s.title === r.title);
          if (!alreadySaved) {
            await saveRecipe(r);
            imported++;
          }
        }
      } catch (err) {
        // Skip failed videos, continue with the rest
        console.warn(`Skipped video ${i + 1}:`, err);
      }
      // Small delay to avoid hammering the server
      if (i < collectionVideos.length - 1) await new Promise(res => setTimeout(res, 500));
    }

    setImportProgress(null);
    setCollectionVideos(null);
    setCollectionTitle(null);
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
      // First, try to detect if this is a collection URL
      const collectionRes = await fetch(`${API_URL}/extract-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (collectionRes.ok) {
        const collectionData = await collectionRes.json();
        if (collectionData.is_collection && collectionData.count > 0) {
          setCollectionVideos(collectionData.videos);
          setCollectionTitle(collectionData.collection_title || 'TikTok Collection');
          setLoading(false);
          return;
        }
      }

      // Not a collection — extract as single recipe
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

      // Update appropriate storage
      if (user) {
        localStorage.setItem('chefSocial_cached_cookbook', JSON.stringify(updated));
        // Also delete from cloud
        if (recipe.id) {
          try {
            await fetch(`${API_URL}/recipes/${recipe.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${user.token}` }
            });
          } catch (e) { console.error("Cloud delete failed", e); }
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

  // --- VIEW STATE ---
  const [view, setView] = useState<'home' | 'cookbook' | 'details'>('home');

  // --- FILTERING & BILINGUAL SEARCH ---
  const [selectedCategory, setSelectedCategory] = useState("All");

  const MEAL_TYPES = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Appetizer', 'Drink'];
  const DISH_TYPES = [
    'Airfryer', 'BBQ', 'Slow Cooker', 'Pasta', 'Pizza', 'Burger', 'Sandwich', 'Wrap', 'Tacos',
    'Salad', 'Bowl', 'Soup', 'Stew', 'Curry', 'Rice', 'Meat', 'Fish', 'Chicken', 'Vegetarian', 'Vegan',
    'Low-Carb', 'High-Protein', 'Smoothie', 'Cocktail', 'Sauce', 'Side'
  ];

  const TRANSLATIONS: Record<string, string[]> = {
    // English -> Dutch & Synonyms
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

    // Dutch -> English & Synonyms
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
    // 1. Search Query (Bilingual)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      // Expand query with synonyms/translations
      const terms = [q];
      if (TRANSLATIONS[q]) terms.push(...TRANSLATIONS[q]);
      // Also check partial matches for keys in translation map? (Simple approach first)

      const textToSearch = [
        r.title,
        r.description,
        ...(r.tags || []),
        r.category || ''
      ].join(' ').toLowerCase();

      const matches = terms.some(term => textToSearch.includes(term));
      if (!matches) return false;
    }
    // 2. Category Filter
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
            <div className={styles.authArea}>
              {user ? (
                <div
                  className={styles.userChip}
                  onClick={handleLogout}
                  title="Click to logout"
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
              ) : (
                <GoogleLogin
                  onSuccess={handleGoogleLogin}
                  onError={() => console.error('Login Failed')}
                  size="medium"
                  theme="filled_black"
                  text="signin"
                  shape="pill"
                />
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

              {/* Collection detected UI */}
              {collectionVideos && !importProgress && (
                <div className={styles.recipeCard} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📚</div>
                  <h2 style={{ marginBottom: '0.25rem' }}>{collectionTitle}</h2>
                  <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
                    Found {collectionVideos.length} videos in this collection. Import them all as recipes?
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button onClick={handleImportCollection} className={styles.saveButton} style={{ margin: 0 }}>
                      Import All {collectionVideos.length} Recipes
                    </button>
                    <button onClick={() => { setCollectionVideos(null); setCollectionTitle(null); }} className={styles.iconButton} style={{ padding: '0.5rem 1rem', opacity: 0.6 }}>
                      Cancel
                    </button>
                  </div>
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
                      <button onClick={handleDelete} className={styles.iconButton} title="Delete Recipe" style={{ color: '#ff6b6b' }}>🗑️</button>
                      <button onClick={() => setRecipe(null)} className={styles.iconButton} style={{ opacity: 0.6 }}>×</button>
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
                <input
                  type="text"
                  placeholder="Search (try 'Kip' or 'Chicken')..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                />
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
                ) : filteredRecipes.map((r, idx) => (
                  <div key={idx} className={styles.cookbookItem} onClick={() => { setRecipe(r); setView('details'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <div className={styles.cookbookImage}>
                      {(r.image_url || r.image) ? (
                        <img
                          src={r.image_url || r.image}
                          alt={r.title}
                          referrerPolicy="no-referrer"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            // Hide broken image and show emoji fallback
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
                ))}
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

// Wrap in GoogleOAuthProvider
export default function Home() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <HomeContent />
    </GoogleOAuthProvider>
  );
}

