'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Recipe } from '../types';
import { apiPost, ApiError } from '../lib/api';
import { saveRecipeToCloud, recipeExistsInCloud, videoIdFromUrl } from '../lib/recipes';

export type CollectionVideo = {
  url: string;
  title?: string;
  thumbnail?: string;
  video_id?: string;
};

export type ImportProgress = {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  currentTitle: string | null;
  status: 'idle' | 'running' | 'paused' | 'finished' | 'cancelled';
  errors: { title: string; reason: string }[];
};

const JOB_KEY = 'chefSocial_import_job';
const CONCURRENCY = 2;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 20000;
const MAX_ATTEMPTS = 3;

type PersistedJob = {
  uid: string;
  videos: CollectionVideo[];
  remaining: string[];
  done: number;
  failed: number;
  skipped: number;
  startedAt: number;
};

const idOf = (v: CollectionVideo) => v.video_id ?? v.url;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

const emptyProgress: ImportProgress = {
  total: 0, done: 0, failed: 0, skipped: 0,
  currentTitle: null, status: 'idle', errors: [],
};

/**
 * Browser-driven collection import.
 *
 * Replaces the previous fire-and-forget server-side BackgroundTasks job, which
 * could not finish on Render's free plan: the instance sleeps after ~15 minutes
 * without inbound traffic, so a ~80 minute import died around video 60 with no
 * retry, no resumption and no error surfaced to the user.
 *
 * Driving the loop from the tab means every extraction is an inbound request
 * (so the instance stays awake), progress is real, Cancel works, and an
 * interrupted run resumes from where it stopped.
 */
export function useCollectionImport() {
  const [progress, setProgress] = useState<ImportProgress>(emptyProgress);
  const [resumable, setResumable] = useState<PersistedJob | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Adaptive pacing: backs off on 429 so we respect whatever Gemini tier the
  // key is on, then gradually speeds back up.
  const delayRef = useRef(BASE_DELAY_MS);
  const jobRef = useRef<PersistedJob | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_KEY);
      if (!raw) return;
      const job: PersistedJob = JSON.parse(raw);
      if (job?.remaining?.length) setResumable(job);
      else localStorage.removeItem(JOB_KEY);
    } catch {
      localStorage.removeItem(JOB_KEY);
    }
  }, []);

  const persist = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    try {
      if (job.remaining.length === 0) localStorage.removeItem(JOB_KEY);
      else localStorage.setItem(JOB_KEY, JSON.stringify(job));
    } catch {
      /* quota - non-fatal */
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setProgress(p => ({ ...p, status: 'cancelled', currentTitle: null }));
  }, []);

  const dismiss = useCallback(() => {
    setProgress(emptyProgress);
    setResumable(null);
    jobRef.current = null;
    localStorage.removeItem(JOB_KEY);
  }, []);

  const run = useCallback(async (
    job: PersistedJob,
    onSaved: (recipe: Recipe) => void,
  ) => {
    jobRef.current = job;
    const controller = new AbortController();
    abortRef.current = controller;
    delayRef.current = BASE_DELAY_MS;

    const byId = new Map(job.videos.map(v => [idOf(v), v]));
    const queue = [...job.remaining];

    setProgress({
      total: job.videos.length,
      done: job.done,
      failed: job.failed,
      skipped: job.skipped,
      currentTitle: null,
      status: 'running',
      errors: [],
    });

    let consecutiveOk = 0;

    const finish = (id: string, outcome: 'done' | 'failed' | 'skipped', title: string, reason?: string) => {
      const j = jobRef.current!;
      j.remaining = j.remaining.filter(x => x !== id);
      j[outcome] += 1;
      persist();
      setProgress(p => ({
        ...p,
        [outcome]: p[outcome] + 1,
        errors: reason ? [...p.errors, { title, reason }].slice(-20) : p.errors,
      }));
    };

    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        const video = byId.get(id);
        if (!video) continue;
        const label = video.title || 'Untitled';
        setProgress(p => ({ ...p, currentTitle: label }));

        let attempt = 0;
        while (attempt < MAX_ATTEMPTS && !controller.signal.aborted) {
          attempt += 1;
          try {
            if (await recipeExistsInCloud(job.uid, { video_id: video.video_id, source_url: video.url })) {
              finish(id, 'skipped', label);
              break;
            }

            const recipe = await apiPost<Recipe>('/extract-recipe', { url: video.url }, controller.signal);
            recipe.source_url = recipe.source_url || video.url;
            recipe.video_id = recipe.video_id || video.video_id || videoIdFromUrl(video.url) || undefined;

            if (!recipe.ingredients?.length) {
              finish(id, 'failed', label, 'No ingredients could be extracted');
              break;
            }

            const saved = await saveRecipeToCloud(job.uid, recipe);
            onSaved(saved);
            finish(id, 'done', label);

            consecutiveOk += 1;
            if (consecutiveOk >= 8 && delayRef.current > BASE_DELAY_MS) {
              delayRef.current = Math.max(BASE_DELAY_MS, delayRef.current * 0.8);
              consecutiveOk = 0;
            }
            break;
          } catch (e) {
            if (controller.signal.aborted) return;
            const err = e as ApiError;
            consecutiveOk = 0;

            if (err instanceof ApiError && err.status === 429) {
              delayRef.current = Math.min(MAX_DELAY_MS, delayRef.current * 1.8);
            }
            const canRetry = !(err instanceof ApiError) || err.retryable;
            if (!canRetry || attempt >= MAX_ATTEMPTS) {
              finish(id, 'failed', label, err.message || 'Extraction failed');
              break;
            }
            try {
              await sleep(delayRef.current * attempt, controller.signal);
            } catch {
              return;
            }
          }
        }

        if (controller.signal.aborted) return;
        try {
          await sleep(delayRef.current, controller.signal);
        } catch {
          return;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      abortRef.current = null;
    }

    if (controller.signal.aborted) {
      setProgress(p => ({ ...p, status: 'cancelled', currentTitle: null }));
      persist();
    } else {
      setProgress(p => ({ ...p, status: 'finished', currentTitle: null }));
      jobRef.current!.remaining = [];
      localStorage.removeItem(JOB_KEY);
      setResumable(null);
    }
  }, [persist]);

  const start = useCallback((
    uid: string,
    videos: CollectionVideo[],
    onSaved: (recipe: Recipe) => void,
  ) => {
    const job: PersistedJob = {
      uid,
      videos,
      remaining: videos.map(idOf),
      done: 0,
      failed: 0,
      skipped: 0,
      startedAt: Date.now(),
    };
    setResumable(null);
    return run(job, onSaved);
  }, [run]);

  const resume = useCallback((onSaved: (recipe: Recipe) => void) => {
    if (!resumable) return;
    setResumable(null);
    return run(resumable, onSaved);
  }, [resumable, run]);

  return { progress, start, cancel, resume, dismiss, resumable };
}
