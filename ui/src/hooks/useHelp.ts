import { useState, useCallback } from 'react';

export interface HelpState {
  isPanelOpen: boolean;
  currentArticleId: string | null;
  searchQuery: string;
  navigationStack: string[];
  isWhatIsThisMode: boolean;
}

export function useHelp() {
  const [state, setState] = useState<HelpState>({
    isPanelOpen: false,
    currentArticleId: null,
    searchQuery: '',
    navigationStack: [],
    isWhatIsThisMode: false,
  });

  const openPanel = useCallback((articleId?: string) => {
    setState(prev => ({
      ...prev,
      isPanelOpen: true,
      currentArticleId: articleId || null,
      navigationStack: articleId ? [] : prev.navigationStack,
    }));
  }, []);

  const closePanel = useCallback(() => {
    setState(prev => ({
      ...prev,
      isPanelOpen: false,
      searchQuery: '',
    }));
  }, []);

  const togglePanel = useCallback(() => {
    setState(prev => {
      if (prev.isPanelOpen) {
        return { ...prev, isPanelOpen: false, searchQuery: '' };
      }
      return { ...prev, isPanelOpen: true };
    });
  }, []);

  const navigateToArticle = useCallback((articleId: string) => {
    setState(prev => ({
      ...prev,
      currentArticleId: articleId,
      searchQuery: '',
      navigationStack: prev.currentArticleId
        ? [...prev.navigationStack, prev.currentArticleId]
        : prev.navigationStack,
    }));
  }, []);

  const goBack = useCallback(() => {
    setState(prev => {
      if (prev.navigationStack.length === 0) {
        return { ...prev, currentArticleId: null };
      }
      const stack = [...prev.navigationStack];
      const prevArticle = stack.pop()!;
      return { ...prev, currentArticleId: prevArticle, navigationStack: stack };
    });
  }, []);

  const goHome = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentArticleId: null,
      navigationStack: [],
      searchQuery: '',
    }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }));
  }, []);

  const toggleWhatIsThis = useCallback(() => {
    setState(prev => ({
      ...prev,
      isWhatIsThisMode: !prev.isWhatIsThisMode,
    }));
  }, []);

  const exitWhatIsThis = useCallback(() => {
    setState(prev => ({
      ...prev,
      isWhatIsThisMode: false,
    }));
  }, []);

  return {
    ...state,
    openPanel,
    closePanel,
    togglePanel,
    navigateToArticle,
    goBack,
    goHome,
    setSearchQuery,
    toggleWhatIsThis,
    exitWhatIsThis,
  };
}
