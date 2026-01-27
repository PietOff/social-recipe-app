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
          url,
          api_key: undefined // Optional, handled on backend via env var
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
          <div className="cookbook-container" style={{ paddingBottom: '2rem' }}>
            {savedRecipes.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#888', marginTop: '2rem' }}>
                No recipes saved yet. Go find some tasty videos!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {Array.from(new Set(savedRecipes.map(r => r.category || 'Uncategorized'))).map(category => (
                  <div key={category}>
                    <h3 style={{ marginLeft: '0.5rem', marginBottom: '1rem', color: '#444', borderLeft: '4px solid #FF6B6B', paddingLeft: '10px' }}>
                      {category}
                    </h3>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                      gap: '1rem'
                    }}>
                      {savedRecipes.filter(r => (r.category || 'Uncategorized') === category).map((r, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setRecipe(r);
                            setActiveTab('new'); // Switch to view/edit mode to see full card
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          style={{
                            background: 'white',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                            transition: 'transform 0.2s',
                            aspectRatio: '0.8'
                          }}
                        >
                          <div style={{
                            height: '65%',
                            background: '#eee',
                            backgroundImage: `url(${r.image_url || ''})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center'
                          }} />
                          <div style={{ padding: '0.8rem' }}>
                            <h4 style={{
                              margin: 0,
                              fontSize: '0.9rem',
                              fontWeight: '600',
                              color: '#333', // Explicit color to fix white-on-white issue
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden'
                            }}>
                              {r.title}
                            </h4>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
