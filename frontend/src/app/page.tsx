'use client';

import React, { useState } from 'react';
import RecipeCard from '../components/RecipeCard';
import { CategoryAccordion } from '../components/CategoryAccordion';
import { Recipe } from '../types';
import styles from './page.module.css';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Helper to migrate legacy single-category recipes
  const categoryToTags = (cat: string) => [cat];

  // Load saved recipes on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('chefSocial_cookbook');
    if (saved) {
      try {
        setSavedRecipes(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load cookbook', e);
      }
    }
  }, []);

  const saveRecipe = (recipeToSave: Recipe) => {
    const isAlreadySaved = savedRecipes.some(r => r.title === recipeToSave.title);
    let newSaved;

    if (isAlreadySaved) {
      newSaved = savedRecipes.filter(r => r.title !== recipeToSave.title);
    } else {
      newSaved = [recipeToSave, ...savedRecipes];
    }

    setSavedRecipes(newSaved);
    localStorage.setItem('chefSocial_cookbook', JSON.stringify(newSaved));
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setRecipe(null);

    try {
      // FIX: Use the validated Render URL (it looks weird, but it works!)
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
        ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/extract-recipe`
        : 'https://social-recipe-appsocial-recipe-backend.onrender.com/extract-recipe';

      const res = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          api_key: undefined
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Extraction failed');
      }

      const data = await res.json();
      setRecipe(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (!recipe) return;
    if (confirm("Are you sure you want to delete this recipe?")) {
      const updated = savedRecipes.filter(r => r.title !== recipe.title);
      setSavedRecipes(updated);
      localStorage.setItem('chefSocial_cookbook', JSON.stringify(updated));
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

  const MEAL_TYPES = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack', 'Dessert'];
  const DISH_TYPES = ['Burger', 'Pizza', 'Pasta', 'Sandwich', 'Wrap', 'Tacos', 'Bowl', 'Salad', 'Soup', 'Rice', 'Stew', 'Curry', 'Roast', 'Bake', 'Meat', 'Fish', 'Vegetarian', 'Vegan'];

  const TRANSLATIONS: Record<string, string[]> = {
    'kip': ['chicken', 'poultry'], 'chicken': ['kip', 'gevogelte'],
    'rund': ['beef', 'steak'], 'beef': ['rund', 'biefstuk'],
    'varken': ['pork', 'ham', 'bacon'], 'pork': ['varken', 'ham', 'spek'],
    'vis': ['fish', 'salmon', 'tuna'], 'fish': ['vis', 'zalm', 'tonijn'],
    'groente': ['vegetable', 'veggie'], 'vegetable': ['groente', 'vega'],
    'ontbijt': ['breakfast'], 'breakfast': ['ontbijt'],
    'avondeten': ['dinner'], 'dinner': ['avondeten'],
    'lunch': ['lunch'], 'middageten': ['lunch'],
    'ei': ['egg'], 'eggs': ['eieren', 'ei'],
    'kaas': ['cheese'], 'cheese': ['kaas']
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
          <div className={styles.logoAndTitle}>
            <h1 className={styles.logo}>Chef<span className={styles.highlight}>Social</span></h1>
          </div>

          {/* NAVIGATION BUTTONS */}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
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

              {error && <div className={styles.error}>{error}</div>}

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
                                <b>{ing.amount} {ing.unit}</b> {ing.item}
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

              {/* Grid View */}
              <div className={styles.cookbookGrid}>
                {filteredRecipes.map((r, idx) => (
                  <div key={idx} className={styles.cookbookItem} onClick={() => { setRecipe(r); setView('details'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <div className={styles.cookbookImage} style={{ backgroundImage: r.image_url ? `url(${r.image_url})` : 'none' }}>
                      {!r.image_url && <span>🍳</span>}
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
                {filteredRecipes.length === 0 && (
                  <p style={{ opacity: 0.6, width: '100%', textAlign: 'center', padding: '2rem' }}>
                    No recipes found.
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
