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

  // --- FILTERING LOGIC ---
  const [selectedCategory, setSelectedCategory] = useState("All");

  const MEAL_TYPES = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack', 'Dessert'];
  const DISH_TYPES = ['Burger', 'Pizza', 'Pasta', 'Sandwich', 'Wrap', 'Tacos', 'Bowl', 'Salad', 'Soup', 'Rice', 'Stew', 'Curry', 'Roast', 'Bake', 'Meat', 'Fish', 'Vegetarian', 'Vegan'];

  // Combine categories
  const filteredRecipes = savedRecipes.filter(r => {
    // 1. Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const inTitle = r.title?.toLowerCase().includes(q);
      const inDesc = r.description?.toLowerCase().includes(q);
      const inTags = (r.tags || []).some(t => t.toLowerCase().includes(q)) || (r.category && r.category.toLowerCase().includes(q));
      if (!inTitle && !inDesc && !inTags) return false;
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
          <p className={styles.subtitle}>Turn TikToks into tasty texts.</p>
        </header>

        <div className={styles.mainContent}>
          {/* 1. EXTRACTION FORM */}
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

          {error && <div className={styles.error}>{error}</div>}

          {/* 2. NEW RECIPE CARD (Inline) */}
          {recipe && (
            <div className={styles.recipeCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <h2 className={styles.recipeTitle}>{recipe.title}</h2>
                <button onClick={() => setRecipe(null)} style={{ background: 'none', border: 'none', color: '#fff', opacity: 0.5, cursor: 'pointer', fontSize: '1.5rem' }}>×</button>
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
                  <ul>
                    {recipe.ingredients.map((ing, i) => (
                      <li key={i}>
                        <b>{ing.amount} {ing.unit}</b> {ing.item} {ing.group && <span style={{ opacity: 0.6 }}>({ing.group})</span>}
                      </li>
                    ))}
                  </ul>
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

          {/* 3. MY COOKBOOK SECTION */}
          <div className={styles.cookbookSection}>
            <div className={styles.cookbookHeader}>
              <h2>My Cookbook ({savedRecipes.length})</h2>
              <input
                type="text"
                placeholder="Search recipes..."
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
                <div key={idx} className={styles.cookbookItem} onClick={() => { setRecipe(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
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
                  No recipes found. Try adjusting the search or filter.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
