import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY = 'oboto:help-tracking';

export interface HelpTracking {
  viewedArticles: string[];
  dismissedTooltips: string[];
  dismissedInlineHelp: string[];
  completedTours: string[];
  shownSpotlights: string[];
  helpfulRatings: Record<string, boolean>;
  firstSeen: string;
  interactionCount: number;
}

const defaultTracking: HelpTracking = {
  viewedArticles: [],
  dismissedTooltips: [],
  dismissedInlineHelp: [],
  completedTours: [],
  shownSpotlights: [],
  helpfulRatings: {},
  firstSeen: new Date().toISOString(),
  interactionCount: 0,
};

function loadTracking(): HelpTracking {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultTracking, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...defaultTracking };
}

function saveTracking(data: HelpTracking) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded — non-critical */ }
}

export function useHelpTracking() {
  const [tracking, setTracking] = useState<HelpTracking>(loadTracking);
  const trackingRef = useRef(tracking);

  useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  const update = useCallback((updater: (prev: HelpTracking) => HelpTracking) => {
    setTracking(prev => {
      const next = updater(prev);
      saveTracking(next);
      return next;
    });
  }, []);

  const markArticleViewed = useCallback((articleId: string) => {
    update(prev => {
      if (prev.viewedArticles.includes(articleId)) return prev;
      return { ...prev, viewedArticles: [...prev.viewedArticles, articleId] };
    });
  }, [update]);

  const dismissTooltip = useCallback((tooltipId: string) => {
    update(prev => {
      if (prev.dismissedTooltips.includes(tooltipId)) return prev;
      return { ...prev, dismissedTooltips: [...prev.dismissedTooltips, tooltipId] };
    });
  }, [update]);

  const dismissInlineHelp = useCallback((helpId: string) => {
    update(prev => {
      if (prev.dismissedInlineHelp.includes(helpId)) return prev;
      return { ...prev, dismissedInlineHelp: [...prev.dismissedInlineHelp, helpId] };
    });
  }, [update]);

  const completeTour = useCallback((tourId: string) => {
    update(prev => {
      if (prev.completedTours.includes(tourId)) return prev;
      return { ...prev, completedTours: [...prev.completedTours, tourId] };
    });
  }, [update]);

  const markSpotlightShown = useCallback((spotlightId: string) => {
    update(prev => {
      if (prev.shownSpotlights.includes(spotlightId)) return prev;
      return { ...prev, shownSpotlights: [...prev.shownSpotlights, spotlightId] };
    });
  }, [update]);

  const rateArticle = useCallback((articleId: string, helpful: boolean) => {
    update(prev => ({
      ...prev,
      helpfulRatings: { ...prev.helpfulRatings, [articleId]: helpful },
    }));
  }, [update]);

  const incrementInteractions = useCallback(() => {
    update(prev => ({
      ...prev,
      interactionCount: prev.interactionCount + 1,
    }));
  }, [update]);

  const isArticleViewed = useCallback((articleId: string) => {
    return trackingRef.current.viewedArticles.includes(articleId);
  }, []);

  const isTooltipDismissed = useCallback((tooltipId: string) => {
    return trackingRef.current.dismissedTooltips.includes(tooltipId);
  }, []);

  const isInlineHelpDismissed = useCallback((helpId: string) => {
    return trackingRef.current.dismissedInlineHelp.includes(helpId);
  }, []);

  const isTourCompleted = useCallback((tourId: string) => {
    return trackingRef.current.completedTours.includes(tourId);
  }, []);

  const isSpotlightShown = useCallback((spotlightId: string) => {
    return trackingRef.current.shownSpotlights.includes(spotlightId);
  }, []);

  const resetAll = useCallback(() => {
    const fresh = { ...defaultTracking, firstSeen: new Date().toISOString() };
    setTracking(fresh);
    saveTracking(fresh);
  }, []);

  return {
    tracking,
    markArticleViewed,
    dismissTooltip,
    dismissInlineHelp,
    completeTour,
    markSpotlightShown,
    rateArticle,
    incrementInteractions,
    isArticleViewed,
    isTooltipDismissed,
    isInlineHelpDismissed,
    isTourCompleted,
    isSpotlightShown,
    resetAll,
  };
}
