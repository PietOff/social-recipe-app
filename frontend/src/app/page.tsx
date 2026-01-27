'use client';

import React, { useState } from 'react';
import RecipeCard from '../components/RecipeCard';
import { Recipe } from '../types';
import styles from './page.module.css';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setRecipe(null);

    try {
      // Determine the backend URL dynamically. 
      // This allows the phone to connect to the computer's IP (e.g., 192.168.x.x:8000) instead of its own localhost.
      const backendHost = window.location.hostname;
      const res = await fetch(`http://${backendHost}:8000/extract-recipe`, {
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
        </header>

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

        {recipe && <RecipeCard recipe={recipe} />}
      </div>
    </main>
  );
}
