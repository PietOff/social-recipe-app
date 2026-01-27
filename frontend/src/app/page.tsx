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
  const [activeTab, setActiveTab] = useState<'new' | 'saved'>('new');
  const [searchQuery, setSearchQuery] = useState('');

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
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
        ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/extract-recipe`
        : `http://${window.location.hostname}:8000/extract-recipe`;

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

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.logo}>Chef<span className={styles.highlight}>Social</span></h1>
          <p className={styles.subtitle}>Turn TikToks into tasty texts.</p>

          <div className={styles.tabs} style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button
              onClick={() => setActiveTab('new')}
              className={activeTab === 'new' ? styles.activeTab : styles.tab}
              style={{
                background: activeTab === 'new' ? '#FF6B6B' : 'transparent',
                border: '1px solid #FF6B6B',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '20px',
                cursor: 'pointer'
              }}
            >
              New Recipe
            </button>
            <button
              onClick={() => setActiveTab('saved')}
              className={activeTab === 'saved' ? styles.activeTab : styles.tab}
              style={{
                background: activeTab === 'saved' ? '#FF6B6B' : 'transparent',
                border: '1px solid #FF6B6B',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '20px',
                cursor: 'pointer'
              }}
            >
              My Cookbook ({savedRecipes.length})
            </button>
          </div>
        </header>

        {activeTab === 'new' ? (
          <>
            <form onSubmit={handleExtract} className={`${styles.form} glass-panel`}>
              <div className={styles.inputGroup}>
                <input
                  type="url"
                  placeholder="Paste TikTok, Instagram or YouTube URL..."
                  className="input-field"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="primary-button" disabled={loading}>
                {loading ? 'Cooking...' : 'Get Recipe'}
              </button>
            </form>

            {error && (
              <div className={styles.error}>
                {error}
              </div>
            )}

            {recipe && (
              <RecipeCard
                recipe={recipe}
                onSave={saveRecipe}
                isSaved={savedRecipes.some(r => r.title === recipe!.title)}
              />
            )}
          </>
        ) : (
          <div style={{ paddingBottom: '80px' }}>
            <div style={{ padding: '0 1rem', marginBottom: '1rem' }}>
              <h2 className="section-title">My Cookbook</h2>
              <input
                type="text"
                placeholder="Search (e.g. 'Kip', 'Pasta', 'Dinner')..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  border: '1px solid #ddd',
                  fontSize: '1rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  outline: 'none',
                  background: '#f8f9fa'
                }}
              />
            </div>

            {savedRecipes.length === 0 ? (
              <p style={{ padding: '0 1rem', color: '#666' }}>No recipes saved yet.</p>
            ) : (
              (() => {
                // Filter recipes based on search query
                const filteredRecipes = savedRecipes.filter(r => {
                  if (!searchQuery) return true;
                  const q = searchQuery.toLowerCase();
                  // Search in title, tags, and keywords (EN/NL)
                  const inTitle = r.title.toLowerCase().includes(q);
                  const inTags = r.tags?.some(t => t.toLowerCase().includes(q));
                  const inKeywords = r.keywords?.some(k => k.toLowerCase().includes(q));
                  return inTitle || inTags || inKeywords;
                });

                if (filteredRecipes.length === 0) {
                  return <p style={{ padding: '0 1rem', color: '#666' }}>No recipes found for "{searchQuery}".</p>;
                }

                // Grouping Logic for "Cookbook Structure"
                const MEAL_TYPES = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack', 'Dessert'];
                const DISH_TYPES = ['Sandwich', 'Pasta', 'Pizza', 'Salad', 'Soup', 'Rice', 'Meat', 'Fish', 'Vegetarian', 'Vegan'];

                const sections: { title: string, recipes: Recipe[] }[] = [];

                // 1. Add Sections for MEAL TYPES
                MEAL_TYPES.forEach(meal => {
                  const matching = filteredRecipes.filter(r => {
                    const tags = r.tags || (r.category ? [r.category] : []);
                    return tags.some(t => t.toLowerCase() === meal.toLowerCase());
                  });
                  if (matching.length > 0) sections.push({ title: meal, recipes: matching });
                });

                // 2. Add Sections for DISH TYPES
                DISH_TYPES.forEach(dish => {
                  const matching = filteredRecipes.filter(r => {
                    const tags = r.tags || (r.category ? [r.category] : []);
                    // Check if tag matches dish type
                    return tags.some(t => t.toLowerCase() === dish.toLowerCase());
                  });
                  if (matching.length > 0) sections.push({ title: dish, recipes: matching });
                });

                // 3. Catch-all for Other/Uncategorized
                const known = [...MEAL_TYPES, ...DISH_TYPES];
                const other = filteredRecipes.filter(r => {
                  const tags = r.tags || (r.category ? [r.category] : []);
                  // Include if NO tags match ANY known category
                  return !tags.some(t => known.some(k => k.toLowerCase() === t.toLowerCase()));
                });
                if (other.length > 0) sections.push({ title: 'Other Discovers', recipes: other });

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sections.map(section => (
                      <CategoryAccordion
                        key={section.title}
                        title={section.title}
                        recipes={section.recipes}
                        onSelect={(r) => { setRecipe(r); setActiveTab('new'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      />
                    ))}
                  </div>
                );
              })()
            )}
          </div>
        )}
      </div>
    </main>
  );
}
