import React from 'react';
import { Recipe } from '../types';
import styles from './RecipeCard.module.css';

interface RecipeCardProps {
    recipe: Recipe;
    onSave?: (recipe: Recipe) => void;
    isSaved?: boolean;
}

export default function RecipeCard({ recipe, onSave, isSaved }: RecipeCardProps) {
    return (
        <div className={`glass-panel ${styles.card} animate-fade-in`}>
            {recipe.image_url && (
                <div className={styles.imageContainer}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={recipe.image_url} alt={recipe.title} className={styles.image} />
                </div>
            )}

            <div className={styles.header}>
                <h2 className={styles.title}>{recipe.title}</h2>
                {onSave && (
                    <button
                        onClick={() => onSave(recipe)}
                        className={`${styles.saveButton} ${isSaved ? styles.saved : ''}`}
                    >
                        {isSaved ? '❤️ Saved' : '🤍 Save'}
                    </button>
                )}
            </div>

            <p className={styles.description}>{recipe.description}</p>

            <div className={styles.metaGrid}>
                {recipe.prep_time && (
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Prep</span>
                        <span className={styles.metaValue}>{recipe.prep_time}</span>
                    </div>
                )}
                {recipe.cook_time && (
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Cook</span>
                        <span className={styles.metaValue}>{recipe.cook_time}</span>
                    </div>
                )}
                {recipe.servings && (
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Servings</span>
                        <span className={styles.metaValue}>{recipe.servings}</span>
                    </div>
                )}
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Ingredients</h3>
                <ul className={styles.ingredientList}>
                    {recipe.ingredients.map((ing, idx) => (
                        <li key={idx} className={styles.ingredientItem}>
                            <span className={styles.amount}>
                                {ing.amount} {ing.unit}
                            </span>
                            <span className={styles.name}>{ing.item}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Instructions</h3>
                <div className={styles.steps}>
                    {recipe.instructions.map((step, idx) => (
                        <div key={idx} className={styles.step}>
                            <div className={styles.stepNumber}>{idx + 1}</div>
                            <p className={styles.stepText}>{step}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
