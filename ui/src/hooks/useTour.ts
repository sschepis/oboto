import { useState, useCallback } from 'react';
import { tours, type Tour, type TourStep } from '../data/helpContent';

export interface TourState {
  activeTourId: string | null;
  activeTour: Tour | null;
  currentStepIndex: number;
  currentStep: TourStep | null;
  isActive: boolean;
  totalSteps: number;
}

export function useTour() {
  const [state, setState] = useState<TourState>({
    activeTourId: null,
    activeTour: null,
    currentStepIndex: 0,
    currentStep: null,
    isActive: false,
    totalSteps: 0,
  });

  const startTour = useCallback((tourId: string) => {
    const tour = tours.find(t => t.id === tourId);
    if (!tour || tour.steps.length === 0) return;

    setState({
      activeTourId: tourId,
      activeTour: tour,
      currentStepIndex: 0,
      currentStep: tour.steps[0],
      isActive: true,
      totalSteps: tour.steps.length,
    });
  }, []);

  const nextStep = useCallback(() => {
    setState(prev => {
      if (!prev.activeTour) return prev;
      const nextIndex = prev.currentStepIndex + 1;
      if (nextIndex >= prev.activeTour.steps.length) {
        // Tour complete
        return {
          activeTourId: null,
          activeTour: null,
          currentStepIndex: 0,
          currentStep: null,
          isActive: false,
          totalSteps: 0,
        };
      }
      return {
        ...prev,
        currentStepIndex: nextIndex,
        currentStep: prev.activeTour.steps[nextIndex],
      };
    });
  }, []);

  const prevStep = useCallback(() => {
    setState(prev => {
      if (!prev.activeTour || prev.currentStepIndex === 0) return prev;
      const prevIndex = prev.currentStepIndex - 1;
      return {
        ...prev,
        currentStepIndex: prevIndex,
        currentStep: prev.activeTour.steps[prevIndex],
      };
    });
  }, []);

  const endTour = useCallback(() => {
    setState({
      activeTourId: null,
      activeTour: null,
      currentStepIndex: 0,
      currentStep: null,
      isActive: false,
      totalSteps: 0,
    });
  }, []);

  const isLastStep = state.activeTour
    ? state.currentStepIndex === state.activeTour.steps.length - 1
    : false;

  return {
    ...state,
    isLastStep,
    startTour,
    nextStep,
    prevStep,
    endTour,
    availableTours: tours,
  };
}
