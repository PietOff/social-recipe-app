import React, { useState } from 'react';
import { Recipe } from '../types';
import styles from './page.module.css'; // Reusing styles

interface Props {
    title: string;
    recipes: Recipe[];
    onSelect: (recipe: Recipe) => void;
}

export const CategoryAccordion: React.FC<Props> = ({ title, recipes, onSelect }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="glass-panel" style={{ margin: '0 1rem', overflow: 'hidden', padding: 0 }}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    padding: '1rem',
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    color: '#333',
                    cursor: 'pointer'
                }}
            >
                <span>{title} <span style={{ color: '#888', fontSize: '0.9rem' }}>({recipes.length})</span></span>
                <span style={{
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s'
                }}>▼</span>
            </button>

            {isOpen && (
                <div style={{ padding: '0 1rem 1rem 1rem' }}>
                    <div className={styles.cookbookGrid}>
                        {recipes.map((r, idx) => (
                            <div
                                key={idx}
                                className={styles.cookbookItem}
                                onClick={() => onSelect(r)}
                            >
                                <div
                                    className={styles.cookbookImage}
                                    style={{ backgroundImage: `url(${r.image_url || '/placeholder-food.jpg'})` }}
                                ></div>
                                <div className={styles.cookbookContent}>
                                    <h4 style={{ color: '#333' }}>{r.title}</h4>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
