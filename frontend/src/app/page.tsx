'use client';

import React, { useState } from 'react';
import RecipeCard from '../components/RecipeCard';
import { Recipe } from '../types';
import styles from './page.module.css';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null); // Re-added state
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'saved'>('new');

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
      // Use environment variable for backend URL if available (production),
      // otherwise fallback to dynamic localhost for local dev.
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
        ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/extract-recipe`
        : `http://${window.location.hostname}:8000/extract-recipe`;

      const res = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url
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
                  placeholder="Paste TikTok or Instagram URL..."
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
          <div className="cookbook-grid" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {savedRecipes.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#888', marginTop: '2rem' }}>
                No recipes saved yet. Go find some tasty videos!
              </p>
            ) : (
              savedRecipes.map((r, idx) => (
                <RecipeCard
                  key={idx}
                  recipe={r}
                  onSave={saveRecipe}
                  isSaved={true}
                />
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
