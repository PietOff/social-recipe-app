'use client';

import React, { useState, useEffect, use } from 'react';
import { Recipe } from '../../../types';

const API_URL = '/api';

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Loading shared recipes...');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (attempt = 1) => {
      try {
        const res = await fetch(`${API_URL}/share/${token}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (cancelled) return;
        if (res.status === 404) { setError('This share link was not found or has expired.'); setLoading(false); return; }
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        const data = await res.json();
        setRecipes(Array.isArray(data.recipes) ? data.recipes : [data.recipes]);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        if (attempt < 3) {
          setLoadingMsg(`Server is waking up… retrying (${attempt}/3)`);
          await new Promise(r => setTimeout(r, 5000 * attempt));
          return load(attempt + 1);
        }
        setError('Could not load the shared recipes. The server may be temporarily unavailable — try again in a moment.');
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [token]);

  const saveRecipe = async (recipe: Recipe) => {
    const userRaw = localStorage.getItem('chefSocial_user');
    if (!userRaw) { window.location.href = '/'; return; }
    const { token: authToken } = JSON.parse(userRaw);
    setSaving(recipe.title);
    try {
      const res = await fetch(`${API_URL}/recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(recipe),
      });
      if (res.ok) setSaved(prev => new Set([...prev, recipe.title]));
      else if (res.status === 401) { window.location.href = '/'; }
      else alert('Failed to save. Please try again.');
    } catch {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    for (const recipe of recipes) {
      if (!saved.has(recipe.title)) await saveRecipe(recipe);
    }
  };

  if (loading) return (
    <main style={styles.main}>
      <div style={styles.card}>
        <p style={{ opacity: 0.6, textAlign: 'center' }}>{loadingMsg}</p>
      </div>
    </main>
  );

  if (error) return (
    <main style={styles.main}>
      <div style={styles.card}>
        <h2 style={{ marginBottom: '0.5rem' }}>Couldn't load recipes</h2>
        <p style={{ opacity: 0.6 }}>{error}</p>
        <a href="/" style={styles.link}>Go to ChefSocial →</a>
      </div>
    </main>
  );

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <a href="/" style={{ textDecoration: 'none' }}>
          <h1 style={styles.logo}>Chef<span style={styles.highlight}>Social</span></h1>
        </a>
        <p style={{ opacity: 0.6, margin: '0.25rem 0 0' }}>
          {recipes.length === 1 ? 'A recipe was shared with you' : `${recipes.length} recipes were shared with you`}
        </p>
      </header>

      {recipes.length > 1 && (
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <button onClick={saveAll} style={styles.saveAllBtn}>
            Save all to my Cookbook
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 680, margin: '0 auto' }}>
        {recipes.map((recipe, i) => (
          <div key={i} style={styles.recipeCard}>
            {recipe.image_url && (
              <img src={recipe.image_url} alt={recipe.title} referrerPolicy="no-referrer" style={styles.image} onError={e => (e.currentTarget.style.display = 'none')} />
            )}
            <div style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.3rem' }}>{recipe.title}</h2>
                <button
                  onClick={() => saveRecipe(recipe)}
                  disabled={saved.has(recipe.title) || saving === recipe.title}
                  style={{ ...styles.saveBtn, ...(saved.has(recipe.title) ? styles.savedBtn : {}) }}
                >
                  {saved.has(recipe.title) ? 'Saved!' : saving === recipe.title ? '...' : 'Save to Cookbook'}
                </button>
              </div>

              <p style={{ opacity: 0.7, margin: '0.5rem 0 0.75rem', fontSize: '0.9rem' }}>{recipe.description}</p>

              <div style={styles.meta}>
                {recipe.prep_time && <span>⏱ {recipe.prep_time}</span>}
                {recipe.cook_time && <span>🔥 {recipe.cook_time}</span>}
                {recipe.servings && <span>👥 {recipe.servings}</span>}
              </div>

              {(recipe.tags || []).length > 0 && (
                <div style={styles.tags}>
                  {(recipe.tags || []).map(t => <span key={t} style={styles.tag}>{t}</span>)}
                </div>
              )}

              <div style={styles.split}>
                <div>
                  <h3 style={styles.sectionTitle}>Ingredients</h3>
                  <ul style={styles.list}>
                    {recipe.ingredients.map((ing, j) => (
                      <li key={j}><b>{ing.amount} {ing.unit}</b> {ing.item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 style={styles.sectionTitle}>Instructions</h3>
                  <ol style={styles.list}>
                    {recipe.instructions.map((step, j) => <li key={j}>{step}</li>)}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <footer style={styles.footer}>
        <a href="/" style={styles.link}>Make your own cookbook at ChefSocial →</a>
      </footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%)', color: '#fff', padding: '1.5rem 1rem 3rem', fontFamily: 'system-ui, sans-serif' },
  header: { textAlign: 'center', marginBottom: '2rem' },
  logo: { fontSize: '2rem', fontWeight: 800, margin: 0, color: '#fff' },
  highlight: { background: 'linear-gradient(90deg, #FF6B35, #FF8E53)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  card: { maxWidth: 480, margin: '4rem auto', background: 'rgba(255,255,255,0.06)', borderRadius: '16px', padding: '2rem', textAlign: 'center' },
  recipeCard: { background: 'rgba(255,255,255,0.06)', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' },
  image: { width: '100%', height: '200px', objectFit: 'cover' },
  meta: { display: 'flex', gap: '1rem', fontSize: '0.85rem', opacity: 0.7, margin: '0.25rem 0 0.75rem', flexWrap: 'wrap' },
  tags: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem' },
  tag: { background: 'rgba(255,255,255,0.15)', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem' },
  split: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' },
  sectionTitle: { margin: '0 0 0.5rem', fontSize: '1rem', opacity: 0.9 },
  list: { paddingLeft: '1.2rem', margin: 0, lineHeight: 1.7, fontSize: '0.88rem' },
  saveBtn: { flexShrink: 0, padding: '0.4rem 1rem', borderRadius: '20px', border: 'none', background: 'linear-gradient(90deg, #FF6B35, #FF8E53)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' },
  savedBtn: { background: 'rgba(255,255,255,0.15)', cursor: 'default' },
  saveAllBtn: { padding: '0.6rem 1.5rem', borderRadius: '24px', border: 'none', background: 'linear-gradient(90deg, #FF6B35, #FF8E53)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' },
  footer: { textAlign: 'center', marginTop: '3rem' },
  link: { color: '#FF8E53', textDecoration: 'none', fontSize: '0.9rem' },
};
